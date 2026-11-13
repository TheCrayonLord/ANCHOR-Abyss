import type { Spot, RedEye } from './settings';
import type { SrcImage } from './masks';

function smooth(t: number) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }

function at(img: SrcImage, x: number, y: number, c: number) {
  x = Math.min(img.w - 1, Math.max(0, Math.round(x)));
  y = Math.min(img.h - 1, Math.max(0, Math.round(y)));
  return img.data[(y * img.w + x) * 3 + c];
}

/** Apply heal/clone spots and red-eye fixes. Returns a new image (input unchanged). */
export function applyRetouch(img: SrcImage, spots: Spot[], redeye: RedEye[]): SrcImage {
  if (!spots.length && !redeye.length) return img;
  const out: SrcImage = { w: img.w, h: img.h, data: new Uint16Array(img.data) };
  for (const s of spots) healOne(out, s);
  for (const r of redeye) redEyeOne(out, r);
  return out;
}

function healOne(img: SrcImage, s: Spot) {
  const R = Math.max(1.5, s.r * img.w);
  const cx = s.x * img.w, cy = s.y * img.h, ox = (s.sx - s.x) * img.w, oy = (s.sy - s.y) * img.h;
  const f = Math.max(0.02, s.feather / 100), op = s.opacity / 100;
  const ref = new Uint16Array(img.data); // read from a snapshot so overlapping spots behave
  const src: SrcImage = { w: img.w, h: img.h, data: ref };
  // boundary differences for healing (destination ring minus source ring)
  const N = 48;
  const bd: number[][] = [], bp: number[][] = [];
  if (s.mode === 'heal') {
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const bx = cx + Math.cos(a) * R * 1.02, by = cy + Math.sin(a) * R * 1.02;
      const d = [0, 0, 0];
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        for (let c = 0; c < 3; c++) d[c] += at(src, bx + dx, by + dy, c) - at(src, bx + dx + ox, by + dy + oy, c);
        n++;
      }
      bd.push(d.map((v) => v / n));
      bp.push([bx, by]);
    }
  }
  const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(img.w - 1, Math.ceil(cx + R));
  const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(img.h - 1, Math.ceil(cy + R));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const r = Math.hypot(x - cx, y - cy) / R;
    if (r >= 1) continue;
    const a = (1 - smooth((r - (1 - f)) / f)) * op;
    const i = (y * img.w + x) * 3;
    let D = [0, 0, 0];
    if (s.mode === 'heal') {
      let ws = 0;
      for (let k = 0; k < N; k++) {
        const w = 1 / ((x - bp[k][0]) ** 2 + (y - bp[k][1]) ** 2 + 1);
        ws += w;
        for (let c = 0; c < 3; c++) D[c] += w * bd[k][c];
      }
      D = D.map((v) => v / ws);
    }
    for (let c = 0; c < 3; c++) {
      const v = at(src, x + ox, y + oy, c) + D[c];
      img.data[i + c] = Math.min(65535, Math.max(0, Math.round(ref[i + c] * (1 - a) + v * a)));
    }
  }
}

function redEyeOne(img: SrcImage, e: RedEye) {
  const R = Math.max(1.5, e.r * img.w);
  const cx = e.x * img.w, cy = e.y * img.h;
  const pupil = e.pupil / 100, dark = e.darken / 100;
  const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(img.w - 1, Math.ceil(cx + R));
  const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(img.h - 1, Math.ceil(cy + R));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const r = Math.hypot(x - cx, y - cy) / R;
    if (r >= 1) continue;
    const i = (y * img.w + x) * 3;
    const R0 = img.data[i] / 65535, G = img.data[i + 1] / 65535, B = img.data[i + 2] / 65535;
    const fall = 1 - smooth((r - pupil * 0.9) / 0.25);
    if (e.pet) {
      const l = Math.max(R0, G, B);
      const glow = l > 0.55 ? smooth((l - 0.55) / 0.3) : 0;
      const k = glow * fall;
      const v = 0.06 + (1 - dark) * 0.12;
      for (let c = 0; c < 3; c++) img.data[i + c] = Math.round(65535 * (img.data[i + c] / 65535 * (1 - k) + v * k));
      continue;
    }
    const redness = R0 - (G + B) / 2;
    const k = smooth((redness - 0.08) / 0.15) * fall;
    if (k <= 0) continue;
    const nr = ((G + B) / 2) * (1 - dark * 0.6);
    img.data[i] = Math.round(65535 * (R0 * (1 - k) + nr * k));
    img.data[i + 1] = Math.round(65535 * (G * (1 - k * dark * 0.5) ));
    img.data[i + 2] = Math.round(65535 * (B * (1 - k * dark * 0.5)));
  }
}

/** Pick a source for a new heal spot: the nearby patch whose surroundings best match. */
export function autoSource(img: SrcImage, x: number, y: number, r: number): [number, number] {
  const R = Math.max(2, r * img.w), cx = x * img.w, cy = y * img.h;
  const ring: [number, number][] = [];
  for (let k = 0; k < 32; k++) { const a = (k / 32) * Math.PI * 2; ring.push([Math.cos(a) * R * 1.15, Math.sin(a) * R * 1.15]); ring.push([Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5]); }
  let best: [number, number] = [x + r * 2.5, y], bv = Infinity;
  for (const dist of [2.4, 3.2, 4.2, 5.5]) for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const ox = Math.cos(a) * R * dist, oy = Math.sin(a) * R * dist;
    const tx = cx + ox, ty = cy + oy;
    if (tx - R < 0 || ty - R < 0 || tx + R >= img.w || ty + R >= img.h) continue;
    let ssd = 0;
    for (let j = 0; j < ring.length; j += 2) {
      const [px, py] = ring[j];
      for (let c = 0; c < 3; c++) { const d = (at(img, cx + px, cy + py, c) - at(img, tx + px, ty + py, c)) / 65535; ssd += d * d; }
    }
    // also prefer smooth interiors (avoid cloning detail into the spot)
    let tex = 0;
    for (let j = 1; j < ring.length; j += 2) {
      const [px, py] = ring[j];
      const d = (at(img, tx + px, ty + py, 1) - at(img, tx, ty, 1)) / 65535; tex += d * d;
    }
    const v = ssd + tex * 0.5 + dist * 0.002;
    if (v < bv) { bv = v; best = [tx / img.w, ty / img.h]; }
  }
  return best;
}
