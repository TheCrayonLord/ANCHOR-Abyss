import type { Pt, Settings } from './settings';

/** Monotone cubic (Fritsch–Carlson) interpolation through sorted points. */
export function spline(pts: Pt[]): (x: number) => number {
  const p = [...pts].sort((a, b) => a[0] - b[0]);
  const n = p.length;
  if (n < 2) return (x) => x;
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/** Parametric region curve: four zones split at s1/s2/s3, each pushes its band up or down. */
export function parametric(c: Settings['curve']): (x: number) => number {
  const s1 = c.s1 / 100, s2 = c.s2 / 100, s3 = c.s3 / 100;
  const bump = (x: number, lo: number, hi: number) => {
    if (x <= lo || x >= hi) return 0;
    const t = (x - lo) / (hi - lo);
    return Math.sin(Math.PI * t) ** 2;
  };
  return (x: number) => {
    const y = x
      + (c.shadows / 100) * 0.16 * bump(x, 0, Math.max(s1 * 2, 0.05))
      + (c.darks / 100) * 0.14 * bump(x, s1 * 0.5, s2 + (s2 - s1) * 0.5)
      + (c.lights / 100) * 0.14 * bump(x, s2 - (s3 - s2) * 0.5, s3 + (1 - s3) * 0.5)
      + (c.highlights / 100) * 0.16 * bump(x, Math.min(1 - (1 - s3) * 2, 0.95), 1);
    return Math.min(1, Math.max(0, y));
  };
}

export const LUT_SIZE = 1024;

/** Bake master (parametric then point curve) and per-channel curves into an RGBA LUT. */
export function bakeCurveLUT(c: Settings['curve'], fade = 0): Float32Array {
  const par = parametric(c), m = spline(c.master), r = spline(c.red), g = spline(c.green), b = spline(c.blue);
  const out = new Float32Array(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i++) {
    const x = i / (LUT_SIZE - 1);
    let y = m(par(x));
    if (fade) y = fade + y * (1 - fade * 1.5);
    out[i * 4] = r(x); out[i * 4 + 1] = g(x); out[i * 4 + 2] = b(x); out[i * 4 + 3] = y;
  }
  return out;
}

export function isIdentity(c: Settings['curve']): boolean {
  const lin = (p: Pt[]) => p.length === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 1 && p[1][1] === 1;
  return !c.highlights && !c.lights && !c.darks && !c.shadows && lin(c.master) && lin(c.red) && lin(c.green) && lin(c.blue);
}
