import { background, loadDecoded, renderImage, rgbaToCanvas, resizeCanvas } from './pipeline';
import { settingsToXmp } from './xmp';
import type { Photo } from '../catalog/store';
import { store, photoTitle } from '../catalog/store';

export interface ExportOpts {
  format: 'jpeg' | 'png' | 'webp' | 'avif' | 'tiff' | 'original';
  quality: number; // 1..100
  resize: 'none' | 'long' | 'short' | 'wh' | 'mp' | 'percent';
  long: number; short: number; width: number; height: number; mp: number; percent: number; noEnlarge: boolean;
  sharpen: 'none' | 'screen' | 'matte' | 'glossy'; sharpenAmount: 'low' | 'standard' | 'high';
  metadata: 'all' | 'copyright' | 'allButLocation' | 'none';
  watermark: { on: boolean; text: string; size: number; opacity: number; pos: string; color: string };
  naming: string; start: number;
  sidecar: boolean;
  dest: 'download' | 'zip' | 'folder';
  limitKB: number;
}

export const defaultExport = (): ExportOpts => ({
  format: 'jpeg', quality: 90, resize: 'none', long: 2048, short: 1080, width: 1920, height: 1080, mp: 12, percent: 50, noEnlarge: true,
  sharpen: 'none', sharpenAmount: 'standard', metadata: 'all',
  watermark: { on: false, text: '© ', size: 4, opacity: 60, pos: 'br', color: '#ffffff' },
  naming: '{name}', start: 1, sidecar: false, dest: 'download', limitKB: 0,
});

export function targetSize(w: number, h: number, o: ExportOpts): [number, number] {
  let s = 1;
  const L = Math.max(w, h), S = Math.min(w, h);
  if (o.resize === 'long') s = o.long / L;
  else if (o.resize === 'short') s = o.short / S;
  else if (o.resize === 'wh') s = Math.min(o.width / w, o.height / h);
  else if (o.resize === 'mp') s = Math.sqrt((o.mp * 1e6) / (w * h));
  else if (o.resize === 'percent') s = o.percent / 100;
  if (o.noEnlarge) s = Math.min(1, s);
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

function unsharp(c: OffscreenCanvas, amount: number, radius: number) {
  const x = c.getContext('2d')!;
  const d = x.getImageData(0, 0, c.width, c.height);
  const w = c.width, h = c.height, src = new Uint8ClampedArray(d.data);
  const r = Math.max(1, Math.round(radius));
  const tmp = new Float32Array(w * h * 3), blur = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) for (let ch = 0; ch < 3; ch++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const sx = Math.min(w - 1, Math.max(0, xx + k)); s += src[(y * w + sx) * 4 + ch]; n++; }
    tmp[(y * w + xx) * 3 + ch] = s / n;
  }
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) for (let ch = 0; ch < 3; ch++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const sy = Math.min(h - 1, Math.max(0, y + k)); s += tmp[(sy * w + xx) * 3 + ch]; n++; }
    blur[(y * w + xx) * 3 + ch] = s / n;
  }
  for (let i = 0; i < w * h; i++) for (let ch = 0; ch < 3; ch++) {
    const v = src[i * 4 + ch];
    d.data[i * 4 + ch] = v + (v - blur[i * 3 + ch]) * amount;
  }
  x.putImageData(d, 0, 0);
}

function watermark(c: OffscreenCanvas, wm: ExportOpts['watermark']) {
  const x = c.getContext('2d')!;
  const size = Math.max(8, (Math.min(c.width, c.height) * wm.size) / 100);
  x.font = `600 ${size}px system-ui, sans-serif`;
  x.globalAlpha = wm.opacity / 100;
  x.fillStyle = wm.color;
  x.shadowColor = 'rgba(0,0,0,0.4)'; x.shadowBlur = size * 0.15;
  const m = x.measureText(wm.text);
  const pad = size * 0.8;
  const pos = wm.pos;
  const X = pos.includes('l') ? pad : pos.includes('r') ? c.width - m.width - pad : (c.width - m.width) / 2;
  const Y = pos.includes('t') ? pad + size : pos.includes('b') ? c.height - pad : (c.height + size) / 2;
  x.fillText(wm.text, X, Y);
  x.globalAlpha = 1; x.shadowBlur = 0;
}

function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export function xmpPacket(p: Photo, o: ExportOpts): string {
  if (o.metadata === 'none') return '';
  const kw = p.keywords.map((k) => `<rdf:li>${esc(k)}</rdf:li>`).join('');
  const parts = [
    o.metadata !== 'copyright' && p.title ? `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(p.title)}</rdf:li></rdf:Alt></dc:title>` : '',
    o.metadata !== 'copyright' && p.caption ? `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${esc(p.caption)}</rdf:li></rdf:Alt></dc:description>` : '',
    o.metadata !== 'copyright' && kw ? `<dc:subject><rdf:Bag>${kw}</rdf:Bag></dc:subject>` : '',
    p.creator ? `<dc:creator><rdf:Seq><rdf:li>${esc(p.creator)}</rdf:li></rdf:Seq></dc:creator>` : '',
    p.copyright ? `<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${esc(p.copyright)}</rdf:li></rdf:Alt></dc:rights>` : '',
  ].join('');
  const attrs = o.metadata === 'copyright' ? '' : ` xmp:Rating="${p.rating}"${p.label ? ` xmp:Label="${p.label[0].toUpperCase() + p.label.slice(1)}"` : ''} xmp:CreatorTool="ANCHOR Abyss"`;
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"${attrs}>${parts}</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
}

async function addJpegMetadata(blob: Blob, p: Photo, o: ExportOpts): Promise<Blob> {
  if (o.metadata === 'none') return blob;
  const piexif: any = (await import('piexifjs')).default || (await import('piexifjs'));
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const e = p.exif;
  const zeroth: any = {}, exif: any = {}, gps: any = {};
  zeroth[piexif.ImageIFD.Software] = 'ANCHOR Abyss';
  if (p.copyright) zeroth[piexif.ImageIFD.Copyright] = p.copyright;
  if (p.creator) zeroth[piexif.ImageIFD.Artist] = p.creator;
  if (o.metadata !== 'copyright') {
    if (e.make) zeroth[piexif.ImageIFD.Make] = e.make;
    if (e.model) zeroth[piexif.ImageIFD.Model] = e.model;
    if (p.caption) zeroth[piexif.ImageIFD.ImageDescription] = p.caption;
    const d = new Date(p.captureTime);
    const pad = (n: number) => String(n).padStart(2, '0');
    exif[piexif.ExifIFD.DateTimeOriginal] = `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    if (e.iso) exif[piexif.ExifIFD.ISOSpeedRatings] = e.iso;
    if (e.fnumber) exif[piexif.ExifIFD.FNumber] = [Math.round(e.fnumber * 10), 10];
    if (e.exposure) exif[piexif.ExifIFD.ExposureTime] = e.exposure >= 1 ? [Math.round(e.exposure), 1] : [1, Math.round(1 / e.exposure)];
    if (e.focal) exif[piexif.ExifIFD.FocalLength] = [Math.round(e.focal * 10), 10];
    if (e.lens) exif[piexif.ExifIFD.LensModel] = e.lens;
    if (o.metadata === 'all' && p.lat !== undefined && p.lon !== undefined) {
      const dms = (v: number) => { v = Math.abs(v); const dd = Math.floor(v), mm = Math.floor((v - dd) * 60), ss = Math.round(((v - dd) * 60 - mm) * 60 * 100); return [[dd, 1], [mm, 1], [ss, 100]]; };
      gps[piexif.GPSIFD.GPSLatitudeRef] = p.lat >= 0 ? 'N' : 'S'; gps[piexif.GPSIFD.GPSLatitude] = dms(p.lat);
      gps[piexif.GPSIFD.GPSLongitudeRef] = p.lon >= 0 ? 'E' : 'W'; gps[piexif.GPSIFD.GPSLongitude] = dms(p.lon);
    }
  }
  let out = piexif.insert(piexif.dump({ '0th': zeroth, Exif: exif, GPS: gps }), bin);
  // XMP packet (keywords, title, rating) as an APP1 segment after the EXIF segment
  const x = xmpPacket(p, o);
  if (x) {
    const head = 'http://ns.adobe.com/xap/1.0/\0';
    const payload = unescape(encodeURIComponent(head + x));
    const len = payload.length + 2;
    const seg = '\xFF\xE1' + String.fromCharCode(len >> 8, len & 255) + payload;
    // insert after SOI + EXIF APP1
    let pos = 2;
    if (out.charCodeAt(2) === 0xff && out.charCodeAt(3) === 0xe1) pos = 4 + ((out.charCodeAt(4) << 8) | out.charCodeAt(5));
    out = out.slice(0, pos) + seg + out.slice(pos);
  }
  const arr = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) arr[i] = out.charCodeAt(i);
  return new Blob([arr], { type: 'image/jpeg' });
}

export function fileName(p: Photo, o: ExportOpts, seq: number, extn: string) {
  const base = p.name.replace(/\.[^.]+$/, '');
  const d = new Date(p.captureTime);
  const name = o.naming
    .replace(/\{name\}/g, base)
    .replace(/\{seq\}/g, String(seq).padStart(4, '0'))
    .replace(/\{date\}/g, d.toISOString().slice(0, 10))
    .replace(/\{time\}/g, d.toTimeString().slice(0, 8).replace(/:/g, ''))
    .replace(/\{title\}/g, p.title || base)
    .replace(/\{rating\}/g, String(p.rating))
    .replace(/\{copy\}/g, p.virtual ? p.copyName.replace(/\s+/g, '') : '')
    .replace(/[\\/:*?"<>|]+/g, '-');
  return `${name || base}.${extn}`;
}

/** Render one photo with its edits and encode it. */
export async function exportOne(p: Photo, o: ExportOpts, seq: number): Promise<{ name: string; blob: Blob }[]> {
  const out: { name: string; blob: Blob }[] = [];
  if (o.format === 'original') {
    const b = await store.original(p);
    if (b) out.push({ name: fileName(p, o, seq, p.ext), blob: b });
    if (o.sidecar) out.push({ name: fileName(p, o, seq, 'xmp'), blob: new Blob([settingsToXmp(p.settings)], { type: 'application/rdf+xml' }) });
    return out;
  }
  const b = background();
  const dec = await loadDecoded(p.originalId, () => store.original(p), p.name, b.r.maxTex);
  b.bind(p.originalId, dec, p.exif.focal35);
  const g = b.geom(p.settings);
  const [tw, th] = targetSize(g.outW, g.outH, o);
  // render at up to 2x target then resample, to avoid aliasing on large reductions
  const rw = Math.min(g.outW, tw * 2), rh = Math.round((rw / g.outW) * g.outH);
  const img = renderImage(b, p.settings, rw, rh);
  let c = rgbaToCanvas(img);
  if (c.width !== tw || c.height !== th) c = resizeCanvas(c, tw, th);
  if (o.sharpen !== 'none') {
    const amt = { low: 0.35, standard: 0.6, high: 0.95 }[o.sharpenAmount] * (o.sharpen === 'matte' ? 1.3 : o.sharpen === 'glossy' ? 1.0 : 0.8);
    unsharp(c, amt, o.sharpen === 'screen' ? 1 : Math.max(1, Math.round(Math.max(tw, th) / 2400)));
  }
  if (o.watermark.on && o.watermark.text.trim()) watermark(c, o.watermark);
  let blob: Blob;
  let extn = o.format === 'jpeg' ? 'jpg' : o.format;
  if (o.format === 'tiff') {
    const UTIF: any = (await import('utif')).default || (await import('utif'));
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    blob = new Blob([UTIF.encodeImage(d.data.buffer, c.width, c.height)], { type: 'image/tiff' });
    extn = 'tif';
  } else {
    const type = `image/${o.format}`;
    let q = o.quality / 100;
    blob = await c.convertToBlob({ type, quality: q });
    if (blob.type !== type) { blob = await c.convertToBlob({ type: 'image/jpeg', quality: q }); extn = 'jpg'; }
    if (o.limitKB > 0 && (extn === 'jpg' || extn === 'webp')) {
      let lo = 0.05, hi = q;
      for (let i = 0; i < 8 && blob.size > o.limitKB * 1024; i++) { q = (lo + hi) / 2; const b2 = await c.convertToBlob({ type: blob.type, quality: q }); if (b2.size > o.limitKB * 1024) hi = q; else { lo = q; blob = b2; } }
      if (blob.size > o.limitKB * 1024) blob = await c.convertToBlob({ type: blob.type, quality: 0.05 });
    }
    if (extn === 'jpg') blob = await addJpegMetadata(blob, p, o);
  }
  out.push({ name: fileName(p, o, seq, extn), blob });
  if (o.sidecar) out.push({ name: fileName(p, o, seq, 'xmp'), blob: new Blob([settingsToXmp(p.settings)], { type: 'application/rdf+xml' }) });
  return out;
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

export async function exportMany(photos: Photo[], o: ExportOpts, onProgress: (done: number, total: number) => void): Promise<number> {
  let dir: any = null;
  if (o.dest === 'folder' && 'showDirectoryPicker' in window) dir = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
  const files: { name: string; blob: Blob }[] = [];
  const used = new Set<string>();
  let n = 0;
  for (let i = 0; i < photos.length; i++) {
    const res = await exportOne(photos[i], o, o.start + i);
    for (let f of res) {
      let nm = f.name, k = 1;
      while (used.has(nm)) nm = f.name.replace(/(\.[^.]+)$/, `-${k++}$1`);
      used.add(nm); f = { ...f, name: nm };
      if (dir) { const fh = await dir.getFileHandle(nm, { create: true }); const w = await fh.createWritable(); await w.write(f.blob); await w.close(); }
      else files.push(f);
      n++;
    }
    onProgress(i + 1, photos.length);
  }
  if (!dir) {
    if (o.dest === 'zip' || files.length > 3) {
      const JSZip = (await import('jszip')).default;
      const z = new JSZip();
      for (const f of files) z.file(f.name, f.blob);
      download(await z.generateAsync({ type: 'blob', compression: 'STORE' }), `ANCHOR Abyss export ${new Date().toISOString().slice(0, 10)}.zip`);
    } else for (const f of files) download(f.blob, f.name);
  }
  return n;
}

/** Render a photo for display elsewhere (slideshow, print, book, web) as a canvas. */
export async function renderForDisplay(p: Photo, maxSide: number): Promise<OffscreenCanvas> {
  const b = background();
  const dec = await loadDecoded(p.originalId, () => store.original(p), p.name, b.r.maxTex);
  b.bind(p.originalId, dec, p.exif.focal35);
  const g = b.geom(p.settings);
  const s = Math.min(1, maxSide / Math.max(g.outW, g.outH));
  const tw = Math.max(1, Math.round(g.outW * s)), th = Math.max(1, Math.round(g.outH * s));
  const rw = Math.min(g.outW, tw * 2), rh = Math.round((rw / g.outW) * g.outH);
  let c = rgbaToCanvas(renderImage(b, p.settings, rw, rh));
  if (c.width !== tw) c = resizeCanvas(c, tw, th);
  return c;
}

export async function refreshThumb(p: Photo) {
  try {
    const c = await renderForDisplay(p, 512);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    await store.setThumb(p.id, blob);
  } catch (e) { console.warn('thumbnail failed', photoTitle(p), e); }
}
