import { Renderer } from './renderer';
import { decodeFull, downscale } from './decode';
import { applyRetouch } from './spots';
import { packMasks, maskDims, type SrcImage } from './masks';
import { computeGeom } from './geometry';
import { airLight } from './auto';
import type { Settings } from './settings';

export const PREVIEW_MAX = 2560;

interface Decoded { full: SrcImage; preview: SrcImage; air: [number, number, number] }
const cache = new Map<string, Promise<Decoded>>();

export function loadDecoded(key: string, getBlob: () => Promise<Blob | undefined>, name: string, maxTex = 16384): Promise<Decoded> {
  let p = cache.get(key);
  if (p) { cache.delete(key); cache.set(key, p); return p; }
  p = (async () => {
    const blob = await getBlob();
    if (!blob) throw new Error('The original file for this photo is missing from the catalog.');
    let full = await decodeFull(blob, name);
    if (Math.max(full.w, full.h) > maxTex) full = downscale(full, maxTex);
    const preview = downscale(full, PREVIEW_MAX);
    return { full, preview, air: airLight(preview) };
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  while (cache.size > 3) cache.delete(cache.keys().next().value!);
  return p;
}

export function forget(key: string) { cache.delete(key); }

/**
 * Keeps a renderer's textures in sync with one photo's source, retouching and masks,
 * re-uploading only what changed.
 */
export class Binding {
  r: Renderer;
  key = '';
  dec: Decoded | null = null;
  retouchKey: Record<string, string> = {};
  maskKey = '';
  focal35?: number;
  constructor(r: Renderer) { this.r = r; }

  bind(key: string, dec: Decoded, focal35?: number) {
    if (this.key === key && this.dec === dec) return;
    this.key = key; this.dec = dec; this.focal35 = focal35;
    this.retouchKey = {}; this.maskKey = '';
    this.r.dropSource('full');
    this.r.setAir(dec.air);
  }

  sync(s: Settings, level: 'preview' | 'full') {
    if (!this.dec) return;
    const rk = JSON.stringify([s.spots, s.redeye]);
    if (this.retouchKey[level] !== rk || !this.r.hasSource(level)) {
      const img = level === 'full' ? this.dec.full : this.dec.preview;
      const rt = applyRetouch(img, s.spots, s.redeye);
      this.r.setSource(level, rt.w, rt.h, rt.data);
      this.retouchKey[level] = rk;
    }
    const mk = JSON.stringify(s.masks.map((m) => [m.visible, m.invert, m.comps]));
    if (mk !== this.maskKey) {
      const [w, h] = maskDims(this.dec.full.w, this.dec.full.h);
      const packed = packMasks(s.masks, w, h, this.dec.preview, this.key);
      this.r.setMasks(w, h, packed?.A || null, packed?.B || null);
      this.maskKey = mk;
    }
  }

  geom(s: Settings) {
    if (!this.dec) throw new Error('nothing bound');
    return computeGeom(s, this.dec.full.w, this.dec.full.h, this.focal35);
  }
}

/** Render the whole photo to RGBA8. Size is the output size (defaults to full resolution). */
export function renderImage(b: Binding, s: Settings, outW?: number, outH?: number, opts: { neutral?: boolean } = {}): { w: number; h: number; data: Uint8Array } {
  const g = b.geom(s);
  const W = Math.max(1, Math.round(outW || g.outW)), H = Math.max(1, Math.round(outH || g.outH));
  const scaleToSrc = W / g.outW; // output px per source px
  const usePreview = b.dec && scaleToSrc * Math.max(g.OW, g.OH) <= PREVIEW_MAX * 1.05;
  const level = usePreview ? 'preview' : 'full';
  b.sync(s, level);
  const T = 2048;
  if (W <= T * 2 && H <= T * 2 && W * H <= 12e6) {
    const px = b.r.render(s, g, { outW: W, outH: H, target: 'read', level, neutral: opts.neutral })!;
    if (level === 'full') b.r.dropSource('full');
    return { w: W, h: H, data: px };
  }
  // tiled render with overlap so wide blurs (clarity, dehaze) have context at tile edges
  const out = new Uint8Array(W * H * 4);
  const L = Math.max(g.OW, g.OH) * scaleToSrc;
  const M = Math.min(1024, Math.ceil(L * 0.06));
  for (let ty = 0; ty < H; ty += T) for (let tx = 0; tx < W; tx += T) {
    const tw = Math.min(T, W - tx), th = Math.min(T, H - ty);
    const x0 = Math.max(0, tx - M), y0 = Math.max(0, ty - M), x1 = Math.min(W, tx + tw + M), y1 = Math.min(H, ty + th + M);
    const rw = x1 - x0, rh = y1 - y0;
    const px = b.r.render(s, g, { outW: rw, outH: rh, win: [x0 / W, y0 / H, rw / W, rh / H], target: 'read', level, neutral: opts.neutral })!;
    for (let y = 0; y < th; y++) {
      const srcRow = ((ty - y0 + y) * rw + (tx - x0)) * 4;
      out.set(px.subarray(srcRow, srcRow + tw * 4), ((ty + y) * W + tx) * 4);
    }
  }
  if (level === 'full') b.r.dropSource('full');
  return { w: W, h: H, data: out };
}

export function rgbaToCanvas(img: { w: number; h: number; data: Uint8Array }): OffscreenCanvas {
  const c = new OffscreenCanvas(img.w, img.h);
  const x = c.getContext('2d')!;
  const d = new ImageData(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength), img.w, img.h);
  x.putImageData(d, 0, 0);
  return c;
}

/** High quality downscale with the browser's resampler, in halving steps. */
export function resizeCanvas(c: OffscreenCanvas, w: number, h: number): OffscreenCanvas {
  let cur = c;
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const n = new OffscreenCanvas(Math.round(cur.width / 2), Math.round(cur.height / 2));
    const x = n.getContext('2d')!; x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, n.width, n.height); cur = n;
  }
  if (cur.width === w && cur.height === h) return cur;
  const n = new OffscreenCanvas(w, h);
  const x = n.getContext('2d')!; x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, w, h);
  return n;
}

let bgRenderer: Renderer | null = null;
let bgBinding: Binding | null = null;
/** A second, offscreen renderer for thumbnails and export, so the editor view is never disturbed. */
export function background(): Binding {
  if (!bgRenderer) { bgRenderer = new Renderer(new OffscreenCanvas(16, 16)); bgBinding = new Binding(bgRenderer); }
  return bgBinding!;
}
