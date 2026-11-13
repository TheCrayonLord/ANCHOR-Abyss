import type { SrcImage } from './masks';
import type { Settings } from './settings';

const dec = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const enc = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

export interface Histo { r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array; max: number; clipHi: number; clipLo: number }

export function histogram(px: Uint8Array | Uint8ClampedArray): Histo {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
  let hi = 0, lo = 0;
  for (let i = 0; i < px.length; i += 4) {
    r[px[i]]++; g[px[i + 1]]++; b[px[i + 2]]++;
    l[Math.round(px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722)]++;
    if (px[i] >= 254 || px[i + 1] >= 254 || px[i + 2] >= 254) hi++;
    if (px[i] <= 1 && px[i + 1] <= 1 && px[i + 2] <= 1) lo++;
  }
  let max = 1;
  for (let i = 2; i < 254; i++) max = Math.max(max, r[i], g[i], b[i]);
  const n = px.length / 4 || 1;
  return { r, g, b, l, max, clipHi: hi / n, clipLo: lo / n };
}

function sample(img: SrcImage, step: number, fn: (r: number, g: number, b: number) => void) {
  const n = img.w * img.h;
  for (let i = 0; i < n; i += step) fn(img.data[i * 3] / 65535, img.data[i * 3 + 1] / 65535, img.data[i * 3 + 2] / 65535);
}

export function autoTone(img: SrcImage): Partial<Settings> {
  const lum: number[] = [];
  const step = Math.max(1, Math.floor((img.w * img.h) / 120000));
  sample(img, step, (r, g, b) => lum.push(0.2126 * r + 0.7152 * g + 0.0722 * b));
  lum.sort((a, b) => a - b);
  const q = (p: number) => lum[Math.min(lum.length - 1, Math.max(0, Math.floor(p * lum.length)))];
  const med = Math.max(0.01, q(0.5));
  const exposure = Math.max(-3, Math.min(3, Math.log2(dec(0.44) / dec(med)) * 0.85));
  const k = Math.pow(2, exposure);
  const after = (v: number) => enc(Math.min(4, dec(v) * k));
  const p995 = after(q(0.995)), p005 = after(q(0.005)), p95 = after(q(0.95)), p10 = after(q(0.1));
  const clipped = lum.filter((v) => after(v) >= 0.98).length / lum.length;
  const whites = Math.round(Math.max(-60, Math.min(60, (0.97 - p995) * 160)));
  const blacks = Math.round(Math.max(-60, Math.min(40, (0.02 - p005) * 260)));
  const highlights = Math.round(Math.max(-80, Math.min(0, -clipped * 900 - Math.max(0, p95 - 0.9) * 200)));
  const shadows = Math.round(Math.max(0, Math.min(60, (0.18 - p10) * 220)));
  const spread = p95 - p10;
  const contrast = Math.round(Math.max(-20, Math.min(25, (0.62 - spread) * 60)));
  return { exposure: Math.round(exposure * 100) / 100, contrast, highlights, shadows, whites, blacks, vibrance: 10, saturation: 0 };
}

export function autoWB(img: SrcImage): { temp: number; tint: number } {
  let R = 0, G = 0, B = 0, n = 0;
  const step = Math.max(1, Math.floor((img.w * img.h) / 100000));
  sample(img, step, (r, g, b) => {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (l < 0.08 || l > 0.95) return;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx > 0 && (mx - mn) / mx > 0.6) return; // skip strongly coloured pixels
    R += dec(r); G += dec(g); B += dec(b); n++;
  });
  if (!n) return { temp: 0, tint: 0 };
  R /= n; G /= n; B /= n;
  const t = Math.log(B / R) / 0.84;
  const rb = Math.sqrt(R * Math.exp(0.42 * t) * B * Math.exp(-0.42 * t));
  const tint = Math.log(G / rb) / 0.28;
  return { temp: Math.round(Math.max(-100, Math.min(100, t * 100))), tint: Math.round(Math.max(-100, Math.min(100, tint * 100))) };
}

/** White balance from a neutral pixel picked with the eyedropper (values 0..1 encoded). */
export function wbFromPixel(r: number, g: number, b: number, cur: { temp: number; tint: number }): { temp: number; tint: number } {
  // remove the current correction first
  const t0 = cur.temp / 100, n0 = cur.tint / 100;
  const m = [Math.exp(0.42 * t0), Math.exp(-0.28 * n0), Math.exp(-0.42 * t0)];
  const R = dec(r) / m[0], G = dec(g) / m[1], B = dec(b) / m[2];
  const t = Math.log(B / R) / 0.84;
  const rb = Math.sqrt(R * Math.exp(0.42 * t) * B * Math.exp(-0.42 * t));
  const n = Math.log(G / rb) / 0.28;
  return { temp: Math.round(Math.max(-100, Math.min(100, t * 100))), tint: Math.round(Math.max(-100, Math.min(100, n * 100))) };
}

export const WB_PRESETS: Record<string, { temp: number; tint: number }> = {
  asShot: { temp: 0, tint: 0 }, daylight: { temp: 4, tint: 2 }, cloudy: { temp: 14, tint: 4 }, shade: { temp: 26, tint: 6 },
  tungsten: { temp: -55, tint: 4 }, fluorescent: { temp: -30, tint: 22 }, flash: { temp: 10, tint: 2 },
};

/** Atmospheric light for dehaze: average of the brightest 0.2% in the dark channel. */
export function airLight(img: SrcImage): [number, number, number] {
  const vals: [number, number, number, number][] = [];
  const step = Math.max(1, Math.floor((img.w * img.h) / 80000));
  sample(img, step, (r, g, b) => vals.push([Math.min(r, g, b), dec(r), dec(g), dec(b)]));
  vals.sort((a, b) => b[0] - a[0]);
  const n = Math.max(1, Math.floor(vals.length * 0.002));
  let R = 0, G = 0, B = 0;
  for (let i = 0; i < n; i++) { R += vals[i][1]; G += vals[i][2]; B += vals[i][3]; }
  return [Math.max(0.2, R / n), Math.max(0.2, G / n), Math.max(0.2, B / n)];
}

/** Estimate lateral chromatic aberration (red and blue radial scale vs green). */
export function estimateCA(img: SrcImage): { caRed: number; caBlue: number } {
  const w = img.w, h = img.h, cx = w / 2, cy = h / 2;
  const ch = (c: number, x: number, y: number) => {
    const xi = Math.min(w - 2, Math.max(0, x | 0)), yi = Math.min(h - 2, Math.max(0, y | 0));
    const fx = x - xi, fy = y - yi, i = (yi * w + xi) * 3 + c;
    const d = img.data;
    return ((d[i] * (1 - fx) + d[i + 3] * fx) * (1 - fy) + (d[i + w * 3] * (1 - fx) + d[i + w * 3 + 3] * fx) * fy) / 65535;
  };
  // collect strong radial edges in the outer half of the frame
  const pts: [number, number][] = [];
  for (let k = 0; k < 6000 && pts.length < 1500; k++) {
    const x = 2 + Math.random() * (w - 4), y = 2 + Math.random() * (h - 4);
    const rr = Math.hypot(x - cx, y - cy) / Math.hypot(cx, cy);
    if (rr < 0.45) continue;
    const gx = ch(1, x + 1, y) - ch(1, x - 1, y), gy = ch(1, x, y + 1) - ch(1, x, y - 1);
    if (Math.hypot(gx, gy) > 0.12) pts.push([x, y]);
  }
  if (pts.length < 40) return { caRed: 0, caBlue: 0 };
  const err = (c: number, s: number) => {
    let e = 0;
    for (const [x, y] of pts) {
      const sx = cx + (x - cx) * (1 + s), sy = cy + (y - cy) * (1 + s);
      const d = ch(c, sx, sy) - ch(1, x, y); e += d * d;
    }
    return e;
  };
  const best = (c: number) => {
    let bs = 0, be = Infinity;
    for (let s = -0.004; s <= 0.0041; s += 0.0004) { const e = err(c, s); if (e < be) { be = e; bs = s; } }
    return Math.round((bs / 0.006) * 100);
  };
  return { caRed: best(0), caBlue: best(2) };
}
