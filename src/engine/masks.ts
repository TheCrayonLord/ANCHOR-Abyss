import type { Mask, MaskComp, BrushStroke } from './settings';

// Masks are rasterised on the CPU in source-image space (before crop/transform), then uploaded as
// two RGBA8 textures (up to 8 masks). The GPU warps them with the image and applies the colour and
// luminance range refinements per pixel, so those stay sharp at any resolution.

export interface SrcImage { w: number; h: number; data: Uint16Array } // RGB 16-bit gamma

function smooth(t: number) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }

function combine(dst: Float32Array, src: Float32Array, mode: MaskComp['mode'], first: boolean) {
  if (first && mode !== 'subtract') { dst.set(src); return; }
  for (let i = 0; i < dst.length; i++) {
    if (mode === 'add') dst[i] = Math.max(dst[i], src[i]);
    else if (mode === 'subtract') dst[i] = dst[i] * (1 - src[i]);
    else dst[i] = dst[i] * src[i];
  }
}

export function rasterLinear(w: number, h: number, c: Extract<MaskComp, { kind: 'linear' }>, out = new Float32Array(w * h)) {
  // full effect at (x1,y1), none at (x2,y2)
  const dx = (c.x2 - c.x1) * w, dy = (c.y2 - c.y1) * h;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = ((x - c.x1 * w) * dx + (y - c.y1 * h) * dy) / len2;
    out[y * w + x] = 1 - smooth(t);
  }
  return out;
}

export function rasterRadial(w: number, h: number, c: Extract<MaskComp, { kind: 'radial' }>, out = new Float32Array(w * h)) {
  const cs = Math.cos((c.angle * Math.PI) / 180), sn = Math.sin((c.angle * Math.PI) / 180);
  const rx = Math.max(1e-4, c.rx * w), ry = Math.max(1e-4, c.ry * h);
  const f = Math.max(0.01, c.feather / 100);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = x - c.cx * w, py = y - c.cy * h;
    const u = (px * cs + py * sn) / rx, v = (-px * sn + py * cs) / ry;
    const r = Math.sqrt(u * u + v * v);
    let m = 1 - smooth((r - (1 - f)) / f);
    if (c.invert) m = 1 - m;
    out[y * w + x] = m;
  }
  return out;
}

function lum16(img: SrcImage, x: number, y: number) {
  const i = (y * img.w + x) * 3;
  return [img.data[i] / 65535, img.data[i + 1] / 65535, img.data[i + 2] / 65535];
}

export function rasterBrush(w: number, h: number, strokes: BrushStroke[], img?: SrcImage, out = new Float32Array(w * h)) {
  for (const s of strokes) {
    const rad = Math.max(1, s.size * w);
    const feather = Math.max(0.02, s.feather / 100);
    const flow = s.flow / 100, dens = s.density / 100;
    const pts = s.pts;
    // stamp along the path, spacing a fraction of the radius
    const stamps: [number, number][] = [];
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i] * w, y = pts[i + 1] * h;
      if (stamps.length) {
        const [px, py] = stamps[stamps.length - 1];
        const d = Math.hypot(x - px, y - py), step = Math.max(1, rad * 0.25);
        for (let t = step; t < d; t += step) stamps.push([px + ((x - px) * t) / d, py + ((y - py) * t) / d]);
      }
      stamps.push([x, y]);
    }
    for (const [cx, cy] of stamps) {
      let ref: number[] | null = null;
      if (s.autoMask && img) {
        const sx = Math.min(img.w - 1, Math.max(0, Math.round((cx / w) * img.w))), sy = Math.min(img.h - 1, Math.max(0, Math.round((cy / h) * img.h)));
        ref = lum16(img, sx, sy);
      }
      const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(w - 1, Math.ceil(cx + rad));
      const y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(h - 1, Math.ceil(cy + rad));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const r = Math.hypot(x - cx, y - cy) / rad;
        if (r >= 1) continue;
        let a = (1 - smooth((r - (1 - feather)) / feather)) * flow;
        if (ref && img) {
          const c = lum16(img, Math.min(img.w - 1, Math.round((x / w) * img.w)), Math.min(img.h - 1, Math.round((y / h) * img.h)));
          const d = Math.hypot(c[0] - ref[0], c[1] - ref[1], c[2] - ref[2]);
          a *= 1 - smooth((d - 0.06) / 0.1);
        }
        const i = y * w + x;
        if (s.erase) out[i] = Math.max(0, out[i] - a);
        else out[i] = Math.max(out[i], Math.min(dens, out[i] + a * (1 - out[i])));
      }
    }
  }
  return out;
}

function boxBlur(src: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  r = Math.max(1, Math.round(r));
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / (2 * r + 1);
      acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function sampled(img: SrcImage, w: number, h: number) {
  // nearest-neighbour resample of the source into w x h float RGB
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.h - 1, Math.floor(((y + 0.5) / h) * img.h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.w - 1, Math.floor(((x + 0.5) / w) * img.w));
      const i = (sy * img.w + sx) * 3, o = (y * w + x) * 3;
      out[o] = img.data[i] / 65535; out[o + 1] = img.data[i + 1] / 65535; out[o + 2] = img.data[i + 2] / 65535;
    }
  }
  return out;
}

/**
 * Sky selection: blue-ish or bright low-saturation pixels connected to the top edge, with smooth edges.
 * A heuristic, not a trained model, so it works best on clear horizons.
 */
export function detectSky(img: SrcImage, w: number, h: number): Float32Array {
  const px = sampled(img, w, h);
  const score = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
    const blue = b >= r && b >= g * 0.92 ? smooth((b - r) / 0.25) : 0;
    const bright = smooth((mx - 0.55) / 0.3) * (1 - smooth((sat - 0.25) / 0.2));
    const y = Math.floor(i / w) / h;
    score[i] = Math.max(blue * smooth((mx - 0.25) / 0.3), bright) * (1 - smooth((y - 0.75) / 0.25));
  }
  // texture penalty: sky is smooth
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = px[i * 3] * 0.3 + px[i * 3 + 1] * 0.59 + px[i * 3 + 2] * 0.11;
  const lb = boxBlur(lum, w, h, 2);
  for (let i = 0; i < w * h; i++) score[i] *= 1 - smooth((Math.abs(lum[i] - lb[i]) - 0.03) / 0.06);
  // flood fill from the top row through pixels with a decent score
  const seen = new Uint8Array(w * h), stack: number[] = [];
  for (let x = 0; x < w; x++) if (score[x] > 0.35) { stack.push(x); seen[x] = 1; }
  while (stack.length) {
    const i = stack.pop()!, x = i % w, y = (i / w) | 0;
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const n of nb) if (n >= 0 && !seen[n] && score[n] > 0.3) { seen[n] = 1; stack.push(n); }
  }
  const m = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = seen[i] ? Math.min(1, score[i] * 1.6) : 0;
  return boxBlur(m, w, h, Math.max(1, w / 300));
}

/**
 * Subject selection: pixels whose colour stands out from the border colours, weighted to the centre,
 * keeping the largest connected region. A heuristic that works on clean backgrounds.
 */
export function detectSubject(img: SrcImage, w: number, h: number): Float32Array {
  const px = sampled(img, w, h);
  // border colour samples
  const border: number[][] = [];
  const step = Math.max(1, Math.floor((w + h) / 120));
  for (let x = 0; x < w; x += step) { border.push([x, 0]); border.push([x, h - 1]); }
  for (let y = 0; y < h; y += step) { border.push([0, y]); border.push([w - 1, y]); }
  const bc = border.map(([x, y]) => { const i = (y * w + x) * 3; return [px[i], px[i + 1], px[i + 2]]; });
  const sal = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const c = [px[i * 3], px[i * 3 + 1], px[i * 3 + 2]];
    let dmin = 1e9;
    for (let k = 0; k < bc.length; k += 2) { const b = bc[k]; const d = (c[0] - b[0]) ** 2 + (c[1] - b[1]) ** 2 + (c[2] - b[2]) ** 2; if (d < dmin) dmin = d; }
    const cx = x / w - 0.5, cy = y / h - 0.5;
    const centre = Math.exp(-(cx * cx + cy * cy) / 0.18);
    sal[i] = smooth((Math.sqrt(dmin) - 0.05) / 0.2) * (0.35 + 0.65 * centre);
  }
  const sb = boxBlur(sal, w, h, Math.max(1, w / 150));
  // largest component above threshold
  const lab = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0, cur = 0;
  for (let i = 0; i < w * h; i++) {
    if (lab[i] >= 0 || sb[i] < 0.35) continue;
    const st = [i]; lab[i] = cur; let size = 0;
    while (st.length) {
      const j = st.pop()!; size++;
      const x = j % w, y = (j / w) | 0;
      for (const n of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1]) if (n >= 0 && lab[n] < 0 && sb[n] >= 0.35) { lab[n] = cur; st.push(n); }
    }
    if (size > bestSize) { bestSize = size; best = cur; }
    cur++;
  }
  const m = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = lab[i] === best ? Math.min(1, sb[i] * 1.5) : 0;
  return boxBlur(m, w, h, Math.max(1, w / 400));
}

const aiCache = new Map<string, Float32Array>();

export function rasterMask(mask: Mask, w: number, h: number, img?: SrcImage, cacheKey = ''): Float32Array {
  const acc = new Float32Array(w * h);
  let first = true;
  for (const c of mask.comps) {
    let m: Float32Array;
    if (c.kind === 'linear') m = rasterLinear(w, h, c);
    else if (c.kind === 'radial') m = rasterRadial(w, h, c);
    else if (c.kind === 'brush') m = rasterBrush(w, h, c.strokes, img);
    else if (c.kind === 'all') m = new Float32Array(w * h).fill(1);
    else {
      const key = `${cacheKey}:${c.kind}:${w}x${h}`;
      let base = aiCache.get(key);
      if (!base && img) { base = c.kind === 'sky' ? detectSky(img, w, h) : detectSubject(img, w, h); aiCache.set(key, base); if (aiCache.size > 12) aiCache.delete(aiCache.keys().next().value!); }
      m = new Float32Array(w * h);
      if (base) { const k = c.strength / 100; for (let i = 0; i < m.length; i++) m[i] = Math.min(1, base[i] * k); }
    }
    combine(acc, m, c.mode, first);
    first = false;
  }
  if (mask.invert) for (let i = 0; i < acc.length; i++) acc[i] = 1 - acc[i];
  return acc;
}

/** Pack up to 8 masks into two RGBA8 buffers. */
export function packMasks(masks: Mask[], w: number, h: number, img?: SrcImage, cacheKey = ''): { A: Uint8Array; B: Uint8Array } | null {
  const vis = masks.filter((m) => m.visible).slice(0, 8);
  if (!vis.length) return null;
  const A = new Uint8Array(w * h * 4), B = new Uint8Array(w * h * 4);
  vis.forEach((mk, k) => {
    const m = rasterMask(mk, w, h, img, cacheKey);
    const buf = k < 4 ? A : B, ch = k % 4;
    for (let i = 0; i < w * h; i++) buf[i * 4 + ch] = Math.round(Math.min(1, Math.max(0, m[i])) * 255);
  });
  return { A, B };
}

/** Mask raster size for a source image: long edge capped for interactivity. */
export function maskDims(W: number, H: number, cap = 1600): [number, number] {
  const s = Math.min(1, cap / Math.max(W, H));
  return [Math.max(1, Math.round(W * s)), Math.max(1, Math.round(H * s))];
}
