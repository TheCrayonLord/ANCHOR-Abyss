import type { Settings } from './settings';

// Coordinate spaces
//  source uv  : 0..1 over the decoded image, before orientation
//  frame      : oriented image, x in [-A/2, A/2], y in [-1/2, 1/2] (A = oriented aspect)
//  output uv  : 0..1 over the cropped result
// The renderer works backwards (output -> source) per pixel; this file is the single source of truth
// for that mapping and the shader receives exactly these numbers.

export interface Geom {
  A: number; // oriented aspect
  W: number; H: number; // source pixels
  OW: number; OH: number; // oriented pixels
  cropC: [number, number]; axisU: [number, number]; axisV: [number, number];
  Hinv: number[]; // 3x3 row-major, transformed frame -> undistorted frame
  k: number; rnorm: number; // lens distortion
  caR: number; caB: number;
  orient: number[]; // 2x3 affine: oriented uv -> source uv (includes flips)
  outW: number; outH: number; // full-resolution output size in pixels
}

export function orientedDims(W: number, H: number, orient: number): [number, number] {
  return orient % 2 ? [H, W] : [W, H];
}

export function mat3mul(a: number[], b: number[]): number[] {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
}

export function mat3inv(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-12;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

/** Forward transform (undistorted frame -> transformed frame) from the Transform panel. */
export function transformMatrix(t: Settings['transform'], A: number): number[] {
  const P = [1, 0, 0, 0, 1, 0, (t.horizontal / 100) * 0.55, (t.vertical / 100) * 0.7, 1];
  const th = (t.rotate * Math.PI) / 180;
  const R = [Math.cos(th), -Math.sin(th), 0, Math.sin(th), Math.cos(th), 0, 0, 0, 1];
  const ax = Math.pow(2, (t.aspect / 100) * 0.4);
  const As = [ax, 0, 0, 0, 1 / ax, 0, 0, 0, 1];
  const s = t.scale / 100;
  const S = [s, 0, 0, 0, s, 0, 0, 0, 1];
  const T = [1, 0, (t.x / 100) * A * 0.5, 0, 1, (t.y / 100) * 0.5, 0, 0, 1];
  return mat3mul(T, mat3mul(S, mat3mul(As, mat3mul(R, P))));
}

export function orientMatrix(orient: number, flipH: boolean, flipV: boolean): number[] {
  // oriented uv (after flips are undone) -> source uv, as 2x3 [a b c; d e f]
  let fu = [1, 0, 0], fv = [0, 1, 0];
  if (flipH) fu = [-1, 0, 1];
  if (flipV) fv = [0, -1, 1];
  // rotation part maps (ou, ov) -> (su, sv)
  const rot: number[][] = [
    [1, 0, 0, 0, 1, 0],
    [0, 1, 0, -1, 0, 1],
    [-1, 0, 1, 0, -1, 1],
    [0, -1, 1, 1, 0, 0],
  ];
  const r = rot[((orient % 4) + 4) % 4];
  // compose: s = r * f(o)
  const comp = (row: number[]) => [
    row[0] * fu[0] + row[1] * fv[0],
    row[0] * fu[1] + row[1] * fv[1],
    row[0] * fu[2] + row[1] * fv[2] + row[2],
  ];
  return [...comp(r.slice(0, 3)), ...comp(r.slice(3, 6))];
}

export function lensK(l: Settings['lens'], focal35?: number): number {
  let k = -(l.distortion / 100) * 0.3;
  if (l.profile && focal35) {
    // Generic estimate: wide lenses show barrel distortion, long lenses slight pincushion.
    const est = focal35 < 50 ? -0.12 * Math.pow((50 - focal35) / 34, 1.4) : 0.02 * Math.min(1, (focal35 - 50) / 150);
    k += -est;
  }
  return k;
}

export function computeGeom(s: Settings, W: number, H: number, focal35?: number): Geom {
  const [OW, OH] = orientedDims(W, H, s.orient);
  const A = OW / OH;
  const c = s.crop;
  const th = (c.angle * Math.PI) / 180;
  const cw = c.w * A, ch = c.h;
  const axisU: [number, number] = [cw * Math.cos(th), cw * Math.sin(th)];
  const axisV: [number, number] = [-ch * Math.sin(th), ch * Math.cos(th)];
  const cropC: [number, number] = [(c.cx - 0.5) * A, c.cy - 0.5];
  const Hinv = mat3inv(transformMatrix(s.transform, A));
  return {
    A, W, H, OW, OH, cropC, axisU, axisV, Hinv,
    k: lensK(s.lens, focal35), rnorm: 0.5 * Math.sqrt(A * A + 1),
    caR: (s.lens.caRed / 100) * 0.006, caB: (s.lens.caBlue / 100) * 0.006,
    orient: orientMatrix(s.orient, s.flipH, s.flipV),
    outW: Math.max(1, Math.round(c.w * OW)), outH: Math.max(1, Math.round(c.h * OH)),
  };
}

/** Output uv -> frame point (in the transformed frame). */
export function outToFrame(g: Geom, u: number, v: number): [number, number] {
  return [g.cropC[0] + (u - 0.5) * g.axisU[0] + (v - 0.5) * g.axisV[0], g.cropC[1] + (u - 0.5) * g.axisU[1] + (v - 0.5) * g.axisV[1]];
}

/** Transformed frame point -> source uv. */
export function frameToSrc(g: Geom, x: number, y: number, ch = 0): [number, number] {
  const m = g.Hinv;
  const w = m[6] * x + m[7] * y + m[8];
  let px = (m[0] * x + m[1] * y + m[2]) / w, py = (m[3] * x + m[4] * y + m[5]) / w;
  const rn2 = (px * px + py * py) / (g.rnorm * g.rnorm);
  const f = 1 + g.k * rn2 + (ch === 1 ? g.caR : ch === 2 ? g.caB : 0);
  px *= f; py *= f;
  const ou = px / g.A + 0.5, ov = py + 0.5;
  const o = g.orient;
  return [o[0] * ou + o[1] * ov + o[2], o[3] * ou + o[4] * ov + o[5]];
}

export function outToSrc(g: Geom, u: number, v: number): [number, number] {
  const [x, y] = outToFrame(g, u, v);
  return frameToSrc(g, x, y);
}

/** Source uv -> output uv (numerical inverse, used for drawing overlays). */
export function srcToOut(g: Geom, su: number, sv: number): [number, number] {
  let u = 0.5, v = 0.5;
  // initial guess ignoring perspective: try a coarse grid
  let best = 1e9;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
    const uu = -0.5 + (i / 8) * 2, vv = -0.5 + (j / 8) * 2;
    const [a, b] = outToSrc(g, uu, vv);
    const d = (a - su) ** 2 + (b - sv) ** 2;
    if (d < best) { best = d; u = uu; v = vv; }
  }
  for (let it = 0; it < 30; it++) {
    const [a, b] = outToSrc(g, u, v);
    const ex = a - su, ey = b - sv;
    if (ex * ex + ey * ey < 1e-14) break;
    const h = 1e-4;
    const [a1, b1] = outToSrc(g, u + h, v);
    const [a2, b2] = outToSrc(g, u, v + h);
    const j00 = (a1 - a) / h, j10 = (b1 - b) / h, j01 = (a2 - a) / h, j11 = (b2 - b) / h;
    const det = j00 * j11 - j01 * j10 || 1e-12;
    u -= (j11 * ex - j01 * ey) / det;
    v -= (-j10 * ex + j00 * ey) / det;
  }
  return [u, v];
}

function inside(g: Geom, u: number, v: number) {
  const [a, b] = outToSrc(g, u, v);
  return a >= -1e-4 && a <= 1 + 1e-4 && b >= -1e-4 && b <= 1 + 1e-4;
}

function cropValid(s: Settings, W: number, H: number) {
  const g = computeGeom(s, W, H);
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    if (!inside(g, t, 0) || !inside(g, t, 1) || !inside(g, 0, t) || !inside(g, 1, t)) return false;
  }
  return true;
}

/** Shrink the crop (same centre and aspect) until it lies inside the image. */
export function constrainCrop(s: Settings, W: number, H: number): Settings['crop'] {
  if (cropValid(s, W, H)) return s.crop;
  const base = s.crop;
  let lo = 0.02, hi = 1;
  const test = (k: number) => cropValid({ ...s, crop: { ...base, w: base.w * k, h: base.h * k } }, W, H);
  if (!test(lo)) {
    // centre is outside: recentre
    const c2 = { ...base, cx: 0.5, cy: 0.5 };
    s = { ...s, crop: c2 };
    return constrainCrop(s, W, H);
  }
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (test(m)) lo = m; else hi = m;
  }
  return { ...base, w: base.w * lo, h: base.h * lo };
}

export const ASPECTS: Record<string, number | null> = {
  original: -1, free: null, '1:1': 1, '4:5': 4 / 5, '5:4': 5 / 4, '3:2': 3 / 2, '2:3': 2 / 3, '4:3': 4 / 3, '3:4': 3 / 4,
  '16:9': 16 / 9, '9:16': 9 / 16, '5:7': 5 / 7, '7:5': 7 / 5, '8.5:11': 8.5 / 11, '2:1': 2, '1.91:1': 1.91,
};

/** Largest centred crop with the given aspect ratio (pixel aspect, width/height). */
export function cropForAspect(aspect: string, OW: number, OH: number, cur?: Settings['crop']): Settings['crop'] {
  const A = OW / OH;
  let r = ASPECTS[aspect];
  if (r === undefined) r = null;
  if (r === -1) r = A;
  const base = cur || { cx: 0.5, cy: 0.5, w: 1, h: 1, angle: 0, aspect, constrain: true };
  if (r == null) return { ...base, aspect };
  // w*A / h = r  -> w = r*h/A
  let h = 1, w = (r * h) / A;
  if (w > 1) { w = 1; h = A / r; }
  return { ...base, cx: 0.5, cy: 0.5, w, h, aspect };
}

/**
 * Find the angle (degrees) that levels the image, from the dominant near-horizontal / near-vertical edges.
 * gray: luminance 0..1, w x h.
 */
export function autoLevelAngle(gray: Float32Array, w: number, h: number, range = 12): number {
  const bins = 241; // -12..12 in 0.1 deg
  const hist = new Float64Array(bins);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = gray[i + 1] - gray[i - 1] + 0.5 * (gray[i + 1 - w] - gray[i - 1 - w] + gray[i + 1 + w] - gray[i - 1 + w]);
    const gy = gray[i + w] - gray[i - w] + 0.5 * (gray[i + w - 1] - gray[i - w - 1] + gray[i + w + 1] - gray[i - w + 1]);
    const mag = Math.hypot(gx, gy);
    if (mag < 0.08) continue;
    // edge direction is perpendicular to gradient
    let a = (Math.atan2(gy, gx) * 180) / Math.PI; // gradient angle
    a = ((a % 90) + 90) % 90; // fold to 0..90
    if (a > 45) a -= 90; // deviation from axis
    if (Math.abs(a) > range) continue;
    const b = Math.round((a + range) * 10);
    hist[b] += mag;
  }
  // smooth
  let best = (bins - 1) / 2, bv = -1;
  for (let i = 2; i < bins - 2; i++) {
    const v = hist[i - 2] * 0.1 + hist[i - 1] * 0.2 + hist[i] * 0.4 + hist[i + 1] * 0.2 + hist[i + 2] * 0.1;
    if (v > bv) { bv = v; best = i; }
  }
  const dev = best / 10 - range;
  // The gradient deviates by `dev`; rotating the crop by the same amount levels the lines.
  return Math.round(dev * 10) / 10;
}
