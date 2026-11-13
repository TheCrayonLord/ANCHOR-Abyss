import type { SrcImage } from './masks';

export const RAW_EXT = ['dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'rwl', 'pef', 'srw', 'x3f', '3fr', 'iiq', 'mrw', 'erf', 'kdc', 'dcr', 'mos', 'mef', 'raw'];
export const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'tif', 'tiff', 'heic', 'heif', 'jfif'];
export const ACCEPT = [...RAW_EXT, ...IMG_EXT].map((e) => '.' + e).join(',');

export function ext(name: string) { return (name.split('.').pop() || '').toLowerCase(); }
export function isRaw(name: string) { return RAW_EXT.includes(ext(name)); }
export function isSupported(name: string) { return RAW_EXT.includes(ext(name)) || IMG_EXT.includes(ext(name)); }

export interface Exif {
  make?: string; model?: string; lens?: string; fnumber?: number; exposure?: number; iso?: number; focal?: number; focal35?: number;
  date?: string; lat?: number; lon?: number; alt?: number; artist?: string; copyright?: string; description?: string; software?: string;
  width?: number; height?: number; flash?: string;
}

export async function readExif(blob: Blob): Promise<Exif> {
  try {
    const exifr = (await import('exifr')).default;
    const t: any = await exifr.parse(blob, { tiff: true, exif: true, gps: true, xmp: false, icc: false, iptc: true, mergeOutput: true, translateValues: true, reviveValues: true });
    if (!t) return {};
    const d = t.DateTimeOriginal || t.CreateDate || t.ModifyDate;
    return {
      make: t.Make, model: t.Model, lens: t.LensModel || t.Lens, fnumber: t.FNumber, exposure: t.ExposureTime, iso: t.ISO || t.ISOSpeedRatings,
      focal: t.FocalLength, focal35: t.FocalLengthIn35mmFormat, date: d instanceof Date ? d.toISOString() : d ? String(d) : undefined,
      lat: t.latitude, lon: t.longitude, alt: t.GPSAltitude, artist: t.Artist, copyright: t.Copyright, description: t.ImageDescription || t.Caption,
      software: t.Software, width: t.ExifImageWidth || t.ImageWidth, height: t.ExifImageHeight || t.ImageHeight, flash: typeof t.Flash === 'string' ? t.Flash : undefined,
    };
  } catch {
    return {};
  }
}

function fromRGBA8(w: number, h: number, rgba: Uint8ClampedArray | Uint8Array): SrcImage {
  const data = new Uint16Array(w * h * 3);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    data[i * 3] = rgba[j] * 257; data[i * 3 + 1] = rgba[j + 1] * 257; data[i * 3 + 2] = rgba[j + 2] * 257;
  }
  return { w, h, data };
}

async function bitmapToSrc(bmp: ImageBitmap): Promise<SrcImage> {
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const x = c.getContext('2d')!;
  x.drawImage(bmp, 0, 0);
  const d = x.getImageData(0, 0, bmp.width, bmp.height);
  return fromRGBA8(bmp.width, bmp.height, d.data);
}

let librawMod: any = null;
async function libraw() {
  if (!librawMod) librawMod = (await import('libraw-wasm')).default;
  return new librawMod();
}

export async function decodeRaw(buf: ArrayBuffer): Promise<SrcImage> {
  const raw = await libraw();
  try {
    await raw.open(new Uint8Array(buf), { outputBps: 16, useCameraWb: true, outputColor: 1, userQual: 3, highlight: 0 });
    const im = await raw.imageData();
    if (!im) throw new Error('This RAW file could not be decoded.');
    const { width: w, height: h, colors, bits } = im;
    const src = im.data as Uint8Array | Uint16Array;
    const data = new Uint16Array(w * h * 3);
    if (bits === 16 || src instanceof Uint16Array) {
      const s16 = src instanceof Uint16Array ? src : new Uint16Array(src.buffer, src.byteOffset, src.byteLength / 2);
      if (colors === 3) data.set(s16.subarray(0, w * h * 3));
      else for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) data[i * 3 + c] = s16[i * colors + Math.min(c, colors - 1)];
    } else {
      for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) data[i * 3 + c] = src[i * colors + Math.min(c, colors - 1)] * 257;
    }
    return { w, h, data };
  } finally {
    try { raw.dispose(); } catch { /* ignore */ }
  }
}

export async function rawThumbnail(buf: ArrayBuffer): Promise<{ blob: Blob | null; w: number; h: number }> {
  const raw = await libraw();
  try {
    await raw.open(new Uint8Array(buf.slice(0)), {});
    const meta = await raw.metadata();
    let blob: Blob | null = null;
    try {
      const t: any = await raw.thumbnailData();
      const bytes = t?.data || t;
      if (bytes && bytes.length > 100 && (meta?.thumb_format === 'jpeg' || (bytes[0] === 0xff && bytes[1] === 0xd8))) blob = new Blob([bytes], { type: 'image/jpeg' });
    } catch { /* no thumbnail */ }
    return { blob, w: meta?.width || 0, h: meta?.height || 0 };
  } catch {
    return { blob: null, w: 0, h: 0 };
  } finally {
    try { raw.dispose(); } catch { /* ignore */ }
  }
}

export async function decodeTiff(buf: ArrayBuffer): Promise<SrcImage> {
  const UTIF: any = (await import('utif')).default || (await import('utif'));
  const ifds = UTIF.decode(buf);
  const page = ifds.find((i: any) => i.width && i.height) || ifds[0];
  UTIF.decodeImage(buf, page);
  const rgba = UTIF.toRGBA8(page);
  return fromRGBA8(page.width, page.height, rgba);
}

async function heicToBlob(blob: Blob): Promise<Blob> {
  const heic2any: any = (await import('heic2any')).default;
  const r = await heic2any({ blob, toType: 'image/jpeg', quality: 0.95 });
  return Array.isArray(r) ? r[0] : r;
}

/** Decode any supported file to 16-bit RGB at full resolution. */
export async function decodeFull(blob: Blob, name: string): Promise<SrcImage> {
  const e = ext(name);
  if (RAW_EXT.includes(e)) return decodeRaw(await blob.arrayBuffer());
  if (e === 'tif' || e === 'tiff') {
    try { return await decodeTiff(await blob.arrayBuffer()); } catch { /* fall through to browser */ }
  }
  if (e === 'heic' || e === 'heif') blob = await heicToBlob(blob);
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' } as any);
  try { return await bitmapToSrc(bmp); } finally { bmp.close(); }
}

/** Box-filter downscale so the long edge is at most `max`. */
export function downscale(img: SrcImage, max: number): SrcImage {
  const s = max / Math.max(img.w, img.h);
  if (s >= 1) return img;
  const w = Math.max(1, Math.round(img.w * s)), h = Math.max(1, Math.round(img.h * s));
  const out = new Uint16Array(w * h * 3);
  const fx = img.w / w, fy = img.h / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy += y1 - y0 > 4 ? 2 : 1) for (let xx = x0; xx < x1; xx += x1 - x0 > 4 ? 2 : 1) {
        const i = (yy * img.w + xx) * 3;
        r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
      }
      const o = (y * w + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return { w, h, data: out };
}

/** 8-bit RGBA canvas from a source image (for thumbnails of unedited photos). */
export function srcToCanvas(img: SrcImage): OffscreenCanvas {
  const c = new OffscreenCanvas(img.w, img.h);
  const x = c.getContext('2d')!;
  const d = x.createImageData(img.w, img.h);
  for (let i = 0; i < img.w * img.h; i++) {
    d.data[i * 4] = img.data[i * 3] >> 8; d.data[i * 4 + 1] = img.data[i * 3 + 1] >> 8; d.data[i * 4 + 2] = img.data[i * 3 + 2] >> 8; d.data[i * 4 + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  return c;
}

/** Quick thumbnail for import: uses the browser decoder (or the embedded RAW preview). */
export async function quickThumb(blob: Blob, name: string, size = 512): Promise<{ thumb: Blob | null; w: number; h: number }> {
  try {
    const e = ext(name);
    let b: Blob | null = blob;
    let w = 0, h = 0;
    if (RAW_EXT.includes(e)) {
      const t = await rawThumbnail(await blob.arrayBuffer());
      b = t.blob; w = t.w; h = t.h;
      if (!b) {
        const full = await decodeFull(blob, name);
        const sm = downscale(full, size);
        const c = srcToCanvas(sm);
        return { thumb: await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 }), w: full.w, h: full.h };
      }
    } else if (e === 'heic' || e === 'heif') b = await heicToBlob(blob);
    else if (e === 'tif' || e === 'tiff') {
      const src = await decodeFull(blob, name);
      const c = srcToCanvas(downscale(src, size));
      return { thumb: await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 }), w: src.w, h: src.h };
    }
    const bmp = await createImageBitmap(b!, { imageOrientation: 'from-image' } as any);
    if (!w) { w = bmp.width; h = bmp.height; }
    const s = Math.min(1, size / Math.max(bmp.width, bmp.height));
    const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * s)), Math.max(1, Math.round(bmp.height * s)));
    const x = c.getContext('2d')!;
    x.imageSmoothingQuality = 'high';
    x.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return { thumb: await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 }), w, h };
  } catch (err) {
    console.warn('thumb failed', name, err);
    return { thumb: null, w: 0, h: 0 };
  }
}
