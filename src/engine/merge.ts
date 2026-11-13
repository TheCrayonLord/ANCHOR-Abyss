import type { SrcImage } from './masks';
import { downscale } from './decode';

// Photo Merge: HDR (exposure fusion of bracketed shots) and panorama (left-to-right sequences).

type F3 = { w: number; h: number; d: Float32Array };

function toF(img: SrcImage): F3 {
  const d = new Float32Array(img.w * img.h * 3);
  for (let i = 0; i < d.length; i++) d[i] = img.data[i] / 65535;
  return { w: img.w, h: img.h, d };
}
function toSrc(f: F3): SrcImage {
  const data = new Uint16Array(f.d.length);
  for (let i = 0; i < f.d.length; i++) data[i] = Math.round(Math.min(1, Math.max(0, f.d[i])) * 65535);
  return { w: f.w, h: f.h, data };
}
function gray(img: SrcImage, max: number) {
  const s = downscale(img, max);
  const g = new Float32Array(s.w * s.h);
  for (let i = 0; i < g.length; i++) g[i] = (s.data[i * 3] * 0.3 + s.data[i * 3 + 1] * 0.59 + s.data[i * 3 + 2] * 0.11) / 65535;
  return { w: s.w, h: s.h, g, scale: s.w / img.w };
}

/** Translation between two images via gradient correlation on small copies. Returns pixel offset in b's frame. */
function align(a: SrcImage, b: SrcImage): [number, number] {
  const A = gray(a, 384), B = gray(b, 384);
  const grad = (G: typeof A) => {
    const o = new Float32Array(G.g.length);
    for (let y = 1; y < G.h - 1; y++) for (let x = 1; x < G.w - 1; x++) { const i = y * G.w + x; o[i] = Math.abs(G.g[i + 1] - G.g[i - 1]) + Math.abs(G.g[i + G.w] - G.g[i - G.w]); }
    // normalise for exposure differences
    let m = 0; for (const v of o) m += v; m /= o.length || 1;
    for (let i = 0; i < o.length; i++) o[i] /= m || 1;
    return o;
  };
  const ga = grad(A), gb = grad(B);
  const R = Math.round(A.w * 0.04);
  let best = [0, 0], bv = -Infinity;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    let s = 0;
    for (let y = R; y < A.h - R; y += 2) for (let x = R; x < A.w - R; x += 2) s += ga[y * A.w + x] * gb[(y + dy) * B.w + x + dx];
    if (s > bv) { bv = s; best = [dx, dy]; }
  }
  return [best[0] / A.scale, best[1] / A.scale];
}

function shift(img: F3, dx: number, dy: number): F3 {
  const o = new Float32Array(img.d.length);
  const ix = Math.round(dx), iy = Math.round(dy);
  for (let y = 0; y < img.h; y++) {
    const sy = Math.min(img.h - 1, Math.max(0, y + iy));
    for (let x = 0; x < img.w; x++) {
      const sx = Math.min(img.w - 1, Math.max(0, x + ix));
      const i = (y * img.w + x) * 3, j = (sy * img.w + sx) * 3;
      o[i] = img.d[j]; o[i + 1] = img.d[j + 1]; o[i + 2] = img.d[j + 2];
    }
  }
  return { w: img.w, h: img.h, d: o };
}

// ---- pyramids ----
function down(f: F3, ch: number): F3 {
  const w = Math.max(1, Math.ceil(f.w / 2)), h = Math.max(1, Math.ceil(f.h / 2));
  const o = new Float32Array(w * h * ch);
  const k = [1, 4, 6, 4, 1];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) {
    let s = 0, ws = 0;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      const sx = Math.min(f.w - 1, Math.max(0, x * 2 + i)), sy = Math.min(f.h - 1, Math.max(0, y * 2 + j));
      const wgt = k[i + 2] * k[j + 2];
      s += f.d[(sy * f.w + sx) * ch + c] * wgt; ws += wgt;
    }
    o[(y * w + x) * ch + c] = s / ws;
  }
  return { w, h, d: o };
}
function up(f: F3, w: number, h: number, ch: number): F3 {
  const o = new Float32Array(w * h * ch);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = Math.min(f.w - 1, Math.max(0, (x - 0.5) / 2)), fy = Math.min(f.h - 1, Math.max(0, (y - 0.5) / 2));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(f.w - 1, x0 + 1), y1 = Math.min(f.h - 1, y0 + 1);
    const ax = fx - x0, ay = fy - y0;
    for (let c = 0; c < ch; c++) {
      const v = (f.d[(y0 * f.w + x0) * ch + c] * (1 - ax) + f.d[(y0 * f.w + x1) * ch + c] * ax) * (1 - ay) + (f.d[(y1 * f.w + x0) * ch + c] * (1 - ax) + f.d[(y1 * f.w + x1) * ch + c] * ax) * ay;
      o[(y * w + x) * ch + c] = v;
    }
  }
  return { w, h, d: o };
}
function gaussPyr(f: F3, n: number, ch: number) { const p = [f]; for (let i = 1; i < n; i++) p.push(down(p[i - 1], ch)); return p; }
function lapPyr(f: F3, n: number) {
  const g = gaussPyr(f, n, 3), l: F3[] = [];
  for (let i = 0; i < n - 1; i++) { const u = up(g[i + 1], g[i].w, g[i].h, 3); const d = new Float32Array(g[i].d.length); for (let k = 0; k < d.length; k++) d[k] = g[i].d[k] - u.d[k]; l.push({ w: g[i].w, h: g[i].h, d }); }
  l.push(g[n - 1]);
  return l;
}

/** Mertens exposure fusion. */
export function mergeHDR(imgs: SrcImage[], maxSize = 3600, onProgress?: (p: number) => void): SrcImage {
  if (imgs.length < 2) throw new Error('Select at least two bracketed photos.');
  const base = imgs.map((i) => downscale(i, maxSize));
  const W = Math.min(...base.map((b) => b.w)), H = Math.min(...base.map((b) => b.h));
  const fs = base.map((b) => { const f = toF(b); if (b.w === W && b.h === H) return f; const o = new Float32Array(W * H * 3); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) o[(y * W + x) * 3 + c] = f.d[(y * b.w + x) * 3 + c]; return { w: W, h: H, d: o }; });
  // align everything to the middle exposure
  const ref = Math.floor(fs.length / 2);
  for (let i = 0; i < fs.length; i++) if (i !== ref) { const [dx, dy] = align(base[ref], base[i]); fs[i] = shift(fs[i], dx, dy); }
  onProgress?.(0.2);
  const n = Math.max(2, Math.min(8, Math.floor(Math.log2(Math.min(W, H))) - 3));
  const weights = fs.map((f) => {
    const w = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, r = f.d[i * 3], g = f.d[i * 3 + 1], b = f.d[i * 3 + 2];
      const l = 0.3 * r + 0.59 * g + 0.11 * b;
      const xm = Math.max(0, x - 1), xp = Math.min(W - 1, x + 1), ym = Math.max(0, y - 1), yp = Math.min(H - 1, y + 1);
      const lap = Math.abs(4 * l - (f.d[(y * W + xm) * 3 + 1] + f.d[(y * W + xp) * 3 + 1] + f.d[(ym * W + x) * 3 + 1] + f.d[(yp * W + x) * 3 + 1]));
      const mu = (r + g + b) / 3, sat = Math.sqrt(((r - mu) ** 2 + (g - mu) ** 2 + (b - mu) ** 2) / 3);
      const ex = Math.exp(-((r - 0.5) ** 2) / 0.08) * Math.exp(-((g - 0.5) ** 2) / 0.08) * Math.exp(-((b - 0.5) ** 2) / 0.08);
      w[i] = (lap + 0.01) * (sat + 0.05) * (ex + 1e-4);
    }
    return w;
  });
  for (let i = 0; i < W * H; i++) { let s = 0; for (const w of weights) s += w[i]; for (const w of weights) w[i] /= s || 1; }
  onProgress?.(0.4);
  let out: F3[] | null = null;
  fs.forEach((f, k) => {
    const lp = lapPyr(f, n);
    const gp = gaussPyr({ w: W, h: H, d: weights[k] }, n, 1);
    if (!out) out = lp.map((l) => ({ w: l.w, h: l.h, d: new Float32Array(l.d.length) }));
    for (let lv = 0; lv < n; lv++) { const o = out[lv], l = lp[lv], g = gp[lv]; for (let i = 0; i < l.w * l.h; i++) for (let c = 0; c < 3; c++) o.d[i * 3 + c] += l.d[i * 3 + c] * g.d[i]; }
    onProgress?.(0.4 + (0.5 * (k + 1)) / fs.length);
  });
  // collapse
  const pyr = out as unknown as F3[];
  let cur = pyr[n - 1];
  for (let lv = n - 2; lv >= 0; lv--) { const u = up(cur, pyr[lv].w, pyr[lv].h, 3); for (let i = 0; i < u.d.length; i++) u.d[i] += pyr[lv].d[i]; cur = u; }
  onProgress?.(1);
  return toSrc(cur);
}

/** Simple panorama: images ordered left to right, offsets found by correlation, seams feathered. */
export function mergePanorama(imgs: SrcImage[], maxHeight = 2400, cylindrical = true, focal35 = 28): SrcImage {
  if (imgs.length < 2) throw new Error('Select at least two overlapping photos, left to right.');
  const H0 = Math.min(maxHeight, ...imgs.map((i) => i.h));
  let ims = imgs.map((i) => downscale(i, Math.round(H0 * Math.max(i.w, i.h) / i.h)));
  if (cylindrical) ims = ims.map((im) => cylinder(im, focal35));
  const offs: [number, number][] = [[0, 0]];
  for (let i = 1; i < ims.length; i++) {
    const a = gray(ims[i - 1], 320), b = gray(ims[i], 320);
    let best = [a.w / 2, 0], bv = -Infinity;
    for (let dx = Math.round(a.w * 0.25); dx <= Math.round(a.w * 0.92); dx += 1) for (let dy = -Math.round(a.h * 0.06); dy <= Math.round(a.h * 0.06); dy += 1) {
      let sab = 0, saa = 0, sbb = 0, sa = 0, sb = 0, n = 0;
      for (let y = Math.max(0, -dy); y < Math.min(a.h, b.h - dy); y += 2) for (let x = dx; x < a.w; x += 2) {
        const va = a.g[y * a.w + x], vb = b.g[(y + dy) * b.w + (x - dx)];
        sab += va * vb; saa += va * va; sbb += vb * vb; sa += va; sb += vb; n++;
      }
      if (n < 50) continue;
      const cov = sab / n - (sa / n) * (sb / n), va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
      const ncc = cov / Math.sqrt(va * vb + 1e-9);
      if (ncc > bv) { bv = ncc; best = [dx, dy]; }
    }
    const sc = ims[i - 1].w / a.w;
    offs.push([offs[i - 1][0] + best[0] * sc, offs[i - 1][1] - best[1] * sc]);
  }
  const minY = Math.min(...offs.map((o) => o[1])), maxY = Math.max(...offs.map((o, i) => o[1] + ims[i].h));
  const W = Math.round(offs[offs.length - 1][0] + ims[ims.length - 1].w), H = Math.round(maxY - minY);
  const acc = new Float32Array(W * H * 3), ws = new Float32Array(W * H);
  ims.forEach((im, k) => {
    const ox = Math.round(offs[k][0]), oy = Math.round(offs[k][1] - minY);
    for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
      const i = (y * im.w + x) * 3;
      if (im.data[i] === 0 && im.data[i + 1] === 0 && im.data[i + 2] === 0 && cylindrical) continue;
      const X = x + ox, Y = y + oy;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const w = Math.min(x + 1, im.w - x) * Math.min(y + 1, im.h - y);
      const j = Y * W + X;
      acc[j * 3] += im.data[i] * w; acc[j * 3 + 1] += im.data[i + 1] * w; acc[j * 3 + 2] += im.data[i + 2] * w; ws[j] += w;
    }
  });
  const data = new Uint16Array(W * H * 3);
  for (let j = 0; j < W * H; j++) if (ws[j]) for (let c = 0; c < 3; c++) data[j * 3 + c] = acc[j * 3 + c] / ws[j];
  return autoCropBlack({ w: W, h: H, data });
}

function cylinder(im: SrcImage, focal35: number): SrcImage {
  const f = (focal35 / 36) * im.w;
  const out = new Uint16Array(im.data.length);
  const cx = im.w / 2, cy = im.h / 2;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    const th = (x - cx) / f, hh = (y - cy) / f;
    const X = Math.tan(th) * f + cx, Y = (hh / Math.cos(th)) * f + cy;
    if (X < 0 || Y < 0 || X >= im.w - 1 || Y >= im.h - 1) continue;
    const i = (Math.round(Y) * im.w + Math.round(X)) * 3, o = (y * im.w + x) * 3;
    out[o] = im.data[i]; out[o + 1] = im.data[i + 1]; out[o + 2] = im.data[i + 2];
  }
  return { w: im.w, h: im.h, data: out };
}

function autoCropBlack(im: SrcImage): SrcImage {
  const filled = (x: number, y: number) => { const i = (y * im.w + x) * 3; return im.data[i] + im.data[i + 1] + im.data[i + 2] > 0; };
  let top = 0, bot = im.h - 1;
  const fill = (y: number) => { let n = 0, t = 0; for (let x = 0; x < im.w; x += 4) { t++; if (filled(x, y)) n++; } return n / t; };
  // rows as full as the fullest row (allowing a little slack) are kept
  let best = 0; for (let y = 0; y < im.h; y += 2) best = Math.max(best, fill(y));
  const need = best - 0.015;
  while (top < bot && fill(top) < need) top++;
  while (bot > top && fill(bot) < need) bot--;
  if (bot - top < im.h * 0.4) return im;
  const h = bot - top + 1;
  const data = new Uint16Array(im.w * h * 3);
  data.set(im.data.subarray(top * im.w * 3, (bot + 1) * im.w * 3));
  return { w: im.w, h, data };
}
