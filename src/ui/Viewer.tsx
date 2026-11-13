import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Renderer } from '../engine/renderer';
import { Binding, loadDecoded, PREVIEW_MAX } from '../engine/pipeline';
import { computeGeom, outToSrc, srcToOut, constrainCrop, ASPECTS, type Geom } from '../engine/geometry';
import { histogram, type Histo } from '../engine/auto';
import { autoSource } from '../engine/spots';
import { clone, uid, type Settings, type Mask, type MaskComp } from '../engine/settings';
import { store, type Photo } from '../catalog/store';

export type Tool = 'none' | 'crop' | 'spot' | 'redeye' | 'mask' | 'wb';
export interface BrushOpts { size: number; feather: number; flow: number; density: number; erase: boolean; autoMask: boolean }
export interface SpotOpts { mode: 'heal' | 'clone'; size: number; feather: number; opacity: number }

export interface ViewerProps {
  photo: Photo;
  settings: Settings;
  tool: Tool;
  zoom: 'fit' | number;
  setZoom: (z: 'fit' | number) => void;
  before: 'off' | 'split' | 'side' | 'hold';
  clip: boolean;
  showOverlay: boolean;
  activeMask: string | null;
  draw: 'brush' | 'linear' | 'radial' | null;
  drawMode: MaskComp['mode'];
  brush: BrushOpts;
  spot: SpotOpts;
  selSpot: string | null;
  setSelSpot: (id: string | null) => void;
  onLive: (s: Settings) => void;
  onCommit: (s: Settings, label?: string) => void;
  onHisto: (h: Histo) => void;
  onPickWB: (rgb: [number, number, number]) => void;
  onInfo: (txt: string) => void;
  onDrawDone?: () => void;
}

const dpr = () => Math.min(2, window.devicePixelRatio || 1);

export default function Viewer(p: ViewerProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const beforeCv = useRef<HTMLCanvasElement>(null);
  const rRef = useRef<{ r: Renderer; b: Binding } | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [size, setSize] = useState<[number, number]>([800, 600]);
  const [pan, setPan] = useState<[number, number]>([0.5, 0.5]);
  const [split, setSplit] = useState(0.5);
  const [holdBefore, setHoldBefore] = useState(false);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const histTimer = useRef<any>(null);
  const frame = useRef(0);
  const live = useRef(p);
  live.current = p;

  // renderer lifetime
  useEffect(() => {
    try {
      const r = new Renderer(canvas.current!);
      rRef.current = { r, b: new Binding(r) };
    } catch (e: any) { setErr(e.message); }
    return () => { rRef.current?.r.purge(); rRef.current = null; };
  }, []);

  // size tracking
  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    setSize([el.clientWidth, el.clientHeight]);
    return () => ro.disconnect();
  }, []);

  // load photo
  useEffect(() => {
    setReady(false); setErr(null);
    const ph = p.photo;
    let live2 = true;
    const rr = rRef.current;
    if (!rr) return;
    p.onInfo(ph.raw ? 'Decoding RAW…' : 'Loading…');
    loadDecoded(ph.originalId, () => store.original(ph), ph.name, rr.r.maxTex).then((dec) => {
      if (!live2 || !rRef.current) return;
      rRef.current.b.bind(ph.originalId, dec, ph.exif.focal35);
      if (!ph.w || ph.w !== dec.full.w) store.update(ph.id, { w: dec.full.w, h: dec.full.h }, true);
      setReady(true);
      p.onInfo('');
    }).catch((e) => { if (live2) { setErr(String(e.message || e)); p.onInfo(''); } });
    setPan([0.5, 0.5]);
    return () => { live2 = false; };
  }, [p.photo.originalId]);

  const cropMode = p.tool === 'crop';
  // In crop mode the whole frame is shown and the crop box is drawn on top of it.
  const viewSettings = (): Settings => {
    const s = p.settings;
    if (!cropMode) return s;
    return { ...s, crop: { ...s.crop, cx: 0.5, cy: 0.5, w: 1, h: 1, angle: 0 } };
  };

  const layout = () => {
    const rr = rRef.current;
    if (!rr || !rr.b.dec) return null;
    const s = viewSettings();
    const g = rr.b.geom(s);
    const D = dpr();
    const Cw = Math.max(1, size[0] * D), Ch = Math.max(1, size[1] * D);
    const side = p.before === 'side' && !cropMode;
    const availW = side ? Cw / 2 - 8 * D : Cw;
    const fitZ = Math.min((availW - 24 * D) / g.outW, (Ch - 24 * D) / g.outH);
    const z = p.zoom === 'fit' ? fitZ : p.zoom * D;
    const Dw = g.outW * z, Dh = g.outH * z;
    const cu = p.zoom === 'fit' ? 0.5 : pan[0], cv = p.zoom === 'fit' ? 0.5 : pan[1];
    const cx = side ? Cw * 0.75 : Cw / 2;
    const ox = cx - cu * Dw, oy = Ch / 2 - cv * Dh;
    const regionL = side ? Cw / 2 : 0;
    const vx = Math.round(Math.max(regionL, ox)), vy = Math.round(Math.max(0, oy)), vx2 = Math.round(Math.min(Cw, ox + Dw)), vy2 = Math.round(Math.min(Ch, oy + Dh));
    return { g, s, z, fitZ, Dw, Dh, ox, oy, vx, vy, vw: Math.max(1, vx2 - vx), vh: Math.max(1, vy2 - vy), D, Cw, Ch, side };
  };

  // render
  useEffect(() => {
    if (!ready) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const rr = rRef.current;
      const L = layout();
      if (!rr || !L) return;
      const { g, s, vx, vy, vw, vh, Dw, Dh, ox, oy, D, z } = L;
      const level = z * 1.0 > PREVIEW_MAX / Math.max(g.OW, g.OH) * 1.05 ? 'full' : 'preview';
      rr.b.sync(s, level);
      const win: [number, number, number, number] = [(vx - ox) / Dw, (vy - oy) / Dh, vw / Dw, vh / Dh];
      const showBefore = p.before === 'hold' || holdBefore;
      const maskIdx = p.activeMask && (p.showOverlay || p.draw === 'brush') ? s.masks.filter((m) => m.visible).findIndex((m) => m.id === p.activeMask) : -1;
      const cv = canvas.current!;
      cv.style.left = vx / D + 'px'; cv.style.top = vy / D + 'px';
      cv.style.width = vw / D + 'px'; cv.style.height = vh / D + 'px';
      rr.r.render(s, g, { outW: vw, outH: vh, win, target: 'screen', level, clip: p.clip && !showBefore, overlayMask: showBefore ? -1 : maskIdx, neutral: showBefore });
      // before image for split / side-by-side
      const bc = beforeCv.current;
      if (bc && (p.before === 'split' || p.before === 'side') && !cropMode) {
        let bx = vx; const bw = Math.round(vw);
        if (L.side) { bx = vx - L.Cw / 2; }
        const px = rr.r.render(s, g, { outW: bw, outH: vh, win, target: 'read', level, neutral: true });
        if (px) {
          bc.width = bw; bc.height = vh;
          bc.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.buffer), bw, Math.round(vh)), 0, 0);
          bc.style.left = bx / D + 'px'; bc.style.top = vy / D + 'px'; bc.style.width = bw / D + 'px'; bc.style.height = vh / D + 'px';
          const splitX = (L.ox + split * Dw - vx) / vw;
          bc.style.clipPath = p.before === 'split' ? `inset(0 ${Math.max(0, (1 - splitX) * 100)}% 0 0)` : 'none';
        }
      }
      if (level === 'full') p.onInfo('');
      // histogram (throttled, small render)
      clearTimeout(histTimer.current);
      histTimer.current = setTimeout(() => {
        const r2 = rRef.current; if (!r2 || !r2.b.dec) return;
        const s2 = live.current.settings;
        const g2 = r2.b.geom(s2);
        const k = 256 / Math.max(g2.outW, g2.outH);
        r2.b.sync(s2, 'preview');
        const px = r2.r.render(s2, g2, { outW: Math.max(8, g2.outW * k), outH: Math.max(8, g2.outH * k), target: 'read', level: 'preview' });
        if (px) live.current.onHisto(histogram(px));
      }, 120);
    });
  }, [ready, p.settings, size, p.zoom, pan, p.before, p.clip, holdBefore, p.activeMask, p.showOverlay, p.draw, cropMode, split]);

  // ---------- coordinate helpers ----------
  const toUV = (e: { clientX: number; clientY: number }) => {
    const L = layout()!;
    const b = wrap.current!.getBoundingClientRect();
    const mx = (e.clientX - b.left) * L.D, my = (e.clientY - b.top) * L.D;
    return [(mx - L.ox) / L.Dw, (my - L.oy) / L.Dh] as [number, number];
  };
  const uvToCss = (u: number, v: number) => {
    const L = layout()!;
    return [(L.ox + u * L.Dw) / L.D, (L.oy + v * L.Dh) / L.D] as [number, number];
  };
  const geomNow = (): Geom | null => { const L = layout(); return L ? L.g : null; };
  const srcCss = (sx: number, sy: number) => { const g = geomNow()!; const [u, v] = srcToOut(g, sx, sy); return uvToCss(u, v); };
  const uvToSrc = (u: number, v: number) => outToSrc(geomNow()!, u, v);

  // ---------- keyboard: hold \ for before ----------
  useEffect(() => {
    const d = (e: KeyboardEvent) => { if (e.key === '\\' && !(e.target as HTMLElement).closest('input,textarea')) setHoldBefore(true); };
    const u = (e: KeyboardEvent) => { if (e.key === '\\') setHoldBefore(false); };
    window.addEventListener('keydown', d); window.addEventListener('keyup', u);
    return () => { window.removeEventListener('keydown', d); window.removeEventListener('keyup', u); };
  }, []);

  // ---------- pointer interactions ----------
  const dragPan = (e: React.PointerEvent) => {
    const L = layout(); if (!L) return;
    const sx = e.clientX, sy = e.clientY, p0 = pan;
    const mv = (ev: PointerEvent) => setPan([p0[0] - ((ev.clientX - sx) * L.D) / L.Dw, p0[1] - ((ev.clientY - sy) * L.D) / L.Dh]);
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };

  const s = p.settings;
  const mask = s.masks.find((m) => m.id === p.activeMask) || null;

  const updateMask = (fn: (m: Mask) => Mask, commit?: string) => {
    const ns = { ...s, masks: s.masks.map((m) => (m.id === p.activeMask ? fn(clone(m)) : m)) };
    if (commit) p.onCommit(ns, commit); else p.onLive(ns);
    return ns;
  };

  const onDown = (e: React.PointerEvent) => {
    if (!ready || e.button === 1 || e.button === 2) return;
    const [u, v] = toUV(e);
    const spaceHeld = (window as any).__spaceHeld;
    if (spaceHeld || (p.tool === 'none' && p.zoom !== 'fit')) { dragPan(e); return; }
    if (p.tool === 'none' && p.zoom === 'fit') {
      // click to zoom to 100% at that point
      setPan([Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))]);
      p.setZoom(1);
      return;
    }
    if (p.tool === 'wb') {
      const rr = rRef.current!; const dec = rr.b.dec!;
      const [sx, sy] = uvToSrc(u, v);
      const img = dec.preview;
      const x0 = Math.round(sx * img.w), y0 = Math.round(sy * img.h);
      let R = 0, G = 0, B = 0, n = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = Math.min(img.w - 1, Math.max(0, x0 + dx)), y = Math.min(img.h - 1, Math.max(0, y0 + dy));
        const i = (y * img.w + x) * 3; R += img.data[i]; G += img.data[i + 1]; B += img.data[i + 2]; n++;
      }
      p.onPickWB([R / n / 65535, G / n / 65535, B / n / 65535]);
      return;
    }
    if (p.tool === 'spot' || p.tool === 'redeye') {
      if (u < 0 || v < 0 || u > 1 || v > 1) return;
      const [sx, sy] = uvToSrc(u, v);
      const g = geomNow()!;
      const rr = rRef.current!;
      if (p.tool === 'spot') {
        const r = (p.spot.size / 100) * 0.12 * (g.outW / g.W);
        const [ax, ay] = autoSource(rr.b.dec!.preview, sx, sy, r);
        const sp = { id: uid(), mode: p.spot.mode, x: sx, y: sy, sx: ax, sy: ay, r, feather: p.spot.feather, opacity: p.spot.opacity };
        p.onCommit({ ...s, spots: [...s.spots, sp] }, p.spot.mode === 'heal' ? 'Heal spot' : 'Clone spot');
        p.setSelSpot(sp.id);
      } else {
        const id = uid();
        let cur = { ...s, redeye: [...s.redeye, { id, x: sx, y: sy, r: 0.01, pupil: 50, darken: 50, pet: false }] };
        const start = [e.clientX, e.clientY];
        const mv = (ev: PointerEvent) => {
          const d = Math.hypot(ev.clientX - start[0], ev.clientY - start[1]);
          const L = layout()!;
          const rr2 = Math.max(0.003, (d * L.D) / L.Dw * (g.outW / g.W));
          cur = { ...cur, redeye: cur.redeye.map((r) => (r.id === id ? { ...r, r: rr2 } : r)) };
          p.onLive(cur);
        };
        const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); p.onCommit(cur, 'Red eye'); };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
        p.onLive(cur);
      }
      return;
    }
    if (p.tool === 'mask' && mask && p.draw) {
      const [sx, sy] = uvToSrc(u, v);
      if (p.draw === 'brush') {
        const g = geomNow()!;
        const b = p.brush;
        const stroke = { pts: [sx, sy], size: (b.size / 100) * 0.08 * (g.outW / g.W), feather: b.feather, flow: b.flow, density: b.density, erase: b.erase, autoMask: b.autoMask };
        // brush strokes go into the mask's last brush component (or a new one)
        let ci = mask.comps.length - 1;
        let m0 = clone(mask);
        const last = m0.comps[ci];
        if (!last || last.kind !== 'brush' || (last.mode !== p.drawMode && !b.erase)) { m0.comps.push({ kind: 'brush', mode: b.erase ? 'add' : p.drawMode, strokes: [] }); ci = m0.comps.length - 1; }
        (m0.comps[ci] as any).strokes.push(stroke);
        let ns = { ...s, masks: s.masks.map((m) => (m.id === mask.id ? m0 : m)) };
        p.onLive(ns);
        let pending = false;
        const mv = (ev: PointerEvent) => {
          const [uu, vv] = toUV(ev); const [x, y] = uvToSrc(uu, vv);
          stroke.pts.push(x, y);
          if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; m0 = clone(m0); (m0.comps[ci] as any).strokes[(m0.comps[ci] as any).strokes.length - 1] = { ...stroke, pts: [...stroke.pts] }; ns = { ...s, masks: s.masks.map((m) => (m.id === mask.id ? m0 : m)) }; p.onLive(ns); }); }
        };
        const up = () => {
          window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
          m0 = clone(m0); (m0.comps[ci] as any).strokes[(m0.comps[ci] as any).strokes.length - 1] = { ...stroke, pts: [...stroke.pts] };
          p.onCommit({ ...s, masks: s.masks.map((m) => (m.id === mask.id ? m0 : m)) }, b.erase ? 'Brush erase' : 'Brush stroke');
        };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
        return;
      }
      // linear / radial: drag to create
      const comp: MaskComp = p.draw === 'linear'
        ? { kind: 'linear', mode: p.drawMode, x1: sx, y1: sy, x2: sx, y2: sy + 0.001 }
        : { kind: 'radial', mode: p.drawMode, cx: sx, cy: sy, rx: 0.01, ry: 0.01, angle: 0, feather: 50, invert: false };
      const m0 = clone(mask); m0.comps.push(comp); const ci = m0.comps.length - 1;
      const g = geomNow()!;
      let ns = { ...s, masks: s.masks.map((m) => (m.id === mask.id ? m0 : m)) };
      p.onLive(ns);
      const mv = (ev: PointerEvent) => {
        const [uu, vv] = toUV(ev); const [x, y] = uvToSrc(uu, vv);
        const m1 = clone(m0); const c = m1.comps[ci] as any;
        if (c.kind === 'linear') { c.x2 = x; c.y2 = y; }
        else { c.rx = Math.max(0.005, Math.abs(x - sx)); c.ry = Math.max(0.005, Math.abs(y - sy)); if (ev.shiftKey) { const r = Math.max(c.rx, c.ry * g.H / g.W); c.rx = r; c.ry = r * g.W / g.H; } }
        ns = { ...s, masks: s.masks.map((m) => (m.id === mask.id ? m1 : m)) };
        p.onLive(ns);
      };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); p.onCommit(ns, p.draw === 'linear' ? 'Linear gradient' : 'Radial gradient'); p.onDrawDone?.(); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      return;
    }
    if (p.tool === 'crop') { cropDrag(e, 'rotate'); return; }
    dragPan(e);
  };

  // ---------- crop interactions ----------
  const cropDrag = (e: React.PointerEvent, part: string) => {
    e.stopPropagation();
    const L = layout(); if (!L) return;
    const g = L.g; const A = g.A;
    const c0 = { ...s.crop };
    const th0 = (c0.angle * Math.PI) / 180;
    const start = toUV(e);
    const fx = (u: number) => (u - 0.5) * A, fy = (v: number) => v - 0.5; // uv -> frame (uncropped view)
    const C0 = [fx(c0.cx), fy(c0.cy)];
    const ratio = ASPECTS[c0.aspect] === -1 ? A : ASPECTS[c0.aspect];
    let ns = s;
    const mv = (ev: PointerEvent) => {
      const [u, v] = toUV(ev);
      const c = { ...c0 };
      if (part === 'move') {
        c.cx = c0.cx + (u - start[0]); c.cy = c0.cy + (v - start[1]);
      } else if (part === 'rotate') {
        const a0 = Math.atan2(fy(start[1]) - C0[1], fx(start[0]) - C0[0]);
        const a1 = Math.atan2(fy(v) - C0[1], fx(u) - C0[0]);
        c.angle = Math.max(-45, Math.min(45, c0.angle + ((a1 - a0) * 180) / Math.PI));
      } else {
        // resize from a corner/edge; opposite side stays put (in the crop's rotated axes)
        const cs = Math.cos(th0), sn = Math.sin(th0);
        const toLocal = (x: number, y: number) => [(x - C0[0]) * cs + (y - C0[1]) * sn, -(x - C0[0]) * sn + (y - C0[1]) * cs];
        const [lx, ly] = toLocal(fx(u), fy(v));
        let hw = (c0.w * A) / 2, hh = c0.h / 2;
        let x0 = -hw, x1 = hw, y0 = -hh, y1 = hh;
        if (part.includes('l')) x0 = Math.min(lx, x1 - 0.02);
        if (part.includes('r')) x1 = Math.max(lx, x0 + 0.02);
        if (part.includes('t')) y0 = Math.min(ly, y1 - 0.02);
        if (part.includes('b')) y1 = Math.max(ly, y0 + 0.02);
        let w = x1 - x0, h = y1 - y0;
        if (ratio) {
          if (part === 't' || part === 'b') w = h * ratio; else if (part === 'l' || part === 'r') h = w / ratio; else { if (w / h > ratio) h = w / ratio; else w = h * ratio; }
          if (!part.includes('l') && !part.includes('r')) { const m = (x0 + x1) / 2; x0 = m - w / 2; x1 = m + w / 2; }
          else if (part.includes('l')) x0 = x1 - w; else x1 = x0 + w;
          if (!part.includes('t') && !part.includes('b')) { const m = (y0 + y1) / 2; y0 = m - h / 2; y1 = m + h / 2; }
          else if (part.includes('t')) y0 = y1 - h; else y1 = y0 + h;
        }
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const Cx = C0[0] + mx * cs - my * sn, Cy = C0[1] + mx * sn + my * cs;
        c.cx = Cx / A + 0.5; c.cy = Cy + 0.5; c.w = w / A; c.h = h;
      }
      let crop = c;
      if (c.constrain) {
        const W = rRef.current!.b.dec!.full.w, H = rRef.current!.b.dec!.full.h;
        crop = constrainCrop({ ...s, crop: c }, W, H);
      }
      ns = { ...s, crop };
      p.onLive(ns);
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); p.onCommit(ns, part === 'rotate' ? 'Straighten' : 'Crop'); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };

  const wheel = (e: React.WheelEvent) => {
    if (!ready) return;
    const L = layout(); if (!L) return;
    const cur = p.zoom === 'fit' ? L.fitZ / L.D : p.zoom;
    const nz = Math.min(8, Math.max(L.fitZ / L.D * 0.5, cur * Math.exp(-e.deltaY * 0.0015)));
    const [u, v] = toUV(e);
    if (p.zoom === 'fit') setPan([Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))]);
    p.setZoom(nz);
  };

  // ---------- overlays ----------
  const overlay: React.ReactNode[] = [];
  const L = ready ? layout() : null;
  if (L && cropMode) {
    const g = L.g, A = g.A, c = s.crop;
    const th = (c.angle * Math.PI) / 180;
    const C = [(c.cx - 0.5) * A, c.cy - 0.5];
    const hu = [(c.w * A) / 2 * Math.cos(th), (c.w * A) / 2 * Math.sin(th)], hv = [-(c.h / 2) * Math.sin(th), (c.h / 2) * Math.cos(th)];
    const pt = (a: number, b: number) => { const x = C[0] + a * hu[0] + b * hv[0], y = C[1] + a * hu[1] + b * hv[1]; return uvToCss(x / A + 0.5, y + 0.5); };
    const corners = [pt(-1, -1), pt(1, -1), pt(1, 1), pt(-1, 1)];
    const poly = corners.map((q) => q.join(',')).join(' ');
    const [W, H] = size;
    overlay.push(<path key="shade" d={`M0,0H${W}V${H}H0Z M${corners.map((q) => q.join(',')).join(' L')}Z`} fillRule="evenodd" className="crop-shade" />);
    overlay.push(<polygon key="box" points={poly} className="crop-box" onPointerDown={(e) => cropDrag(e, 'move')} />);
    for (const t of [1 / 3, 2 / 3]) {
      const a = pt(-1 + 2 * t, -1), b = pt(-1 + 2 * t, 1), c2 = pt(-1, -1 + 2 * t), d = pt(1, -1 + 2 * t);
      overlay.push(<line key={'g' + t} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="crop-grid" />);
      overlay.push(<line key={'h' + t} x1={c2[0]} y1={c2[1]} x2={d[0]} y2={d[1]} className="crop-grid" />);
    }
    const handles: [string, number, number][] = [['tl', -1, -1], ['t', 0, -1], ['tr', 1, -1], ['r', 1, 0], ['br', 1, 1], ['b', 0, 1], ['bl', -1, 1], ['l', -1, 0]];
    for (const [k, a, b] of handles) { const q = pt(a, b); overlay.push(<rect key={k} x={q[0] - 6} y={q[1] - 6} width={12} height={12} className="crop-handle" style={{ cursor: k.length === 2 ? 'nwse-resize' : k === 't' || k === 'b' ? 'ns-resize' : 'ew-resize' }} onPointerDown={(e) => cropDrag(e, k)} />); }
  }
  if (L && p.tool === 'spot') {
    s.spots.forEach((sp) => {
      const [dx, dy] = srcCss(sp.x, sp.y), [sx2, sy2] = srcCss(sp.sx, sp.sy);
      const r = (sp.r * L.g.W * L.z) / L.D / (L.g.outW / L.g.W) * (L.g.outW / L.g.W);
      const sel = sp.id === p.selSpot;
      const drag = (which: 'dst' | 'src') => (e: React.PointerEvent) => {
        e.stopPropagation(); p.setSelSpot(sp.id);
        const start = toUV(e); const st = uvToSrc(start[0], start[1]);
        let ns = s;
        const mv = (ev: PointerEvent) => {
          const [u, v] = toUV(ev); const [x, y] = uvToSrc(u, v);
          const ddx = x - st[0], ddy = y - st[1];
          ns = { ...s, spots: s.spots.map((q) => q.id !== sp.id ? q : which === 'dst' ? { ...q, x: sp.x + ddx, y: sp.y + ddy } : { ...q, sx: sp.sx + ddx, sy: sp.sy + ddy }) };
          p.onLive(ns);
        };
        const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (ns !== s) p.onCommit(ns, 'Move spot'); };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      };
      overlay.push(<g key={sp.id} className={'spot' + (sel ? ' sel' : '')}>
        {sel && <line x1={dx} y1={dy} x2={sx2} y2={sy2} className="spot-link" />}
        {sel && <circle cx={sx2} cy={sy2} r={r} className="spot-src" onPointerDown={drag('src')} />}
        <circle cx={dx} cy={dy} r={r} className="spot-dst" onPointerDown={drag('dst')} />
      </g>);
    });
    if (cursor) { const r = ((p.spot.size / 100) * 0.12 * L.g.outW * L.z) / L.D; overlay.push(<circle key="cur" cx={cursor[0]} cy={cursor[1]} r={r} className="brush-cursor" />); }
  }
  if (L && p.tool === 'redeye') {
    s.redeye.forEach((re) => { const [x, y] = srcCss(re.x, re.y); const r = (re.r * L.g.W * L.z) / L.D; overlay.push(<circle key={re.id} cx={x} cy={y} r={r} className="spot-dst" />); });
  }
  if (L && p.tool === 'mask' && mask) {
    mask.comps.forEach((c, ci) => {
      if (c.kind === 'linear') {
        const a = srcCss(c.x1, c.y1), b = srcCss(c.x2, c.y2);
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len * 2000, ny = dx / len * 2000;
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const handle = (which: 'a' | 'b' | 'm') => (e: React.PointerEvent) => {
          e.stopPropagation();
          const st = uvToSrc(...toUV(e));
          let ns = s;
          const mv = (ev: PointerEvent) => {
            const [x, y] = uvToSrc(...toUV(ev)); const ddx = x - st[0], ddy = y - st[1];
            ns = updateMask((mm) => { const cc = mm.comps[ci] as any; if (which !== 'b') { cc.x1 = c.x1 + ddx; cc.y1 = c.y1 + ddy; } if (which !== 'a') { cc.x2 = c.x2 + ddx; cc.y2 = c.y2 + ddy; } return mm; });
          };
          const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); p.onCommit(ns, 'Edit gradient'); };
          window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
        };
        overlay.push(<g key={'l' + ci} className="mask-gizmo">
          <line x1={a[0] - nx} y1={a[1] - ny} x2={a[0] + nx} y2={a[1] + ny} />
          <line x1={m[0] - nx} y1={m[1] - ny} x2={m[0] + nx} y2={m[1] + ny} className="dash" />
          <line x1={b[0] - nx} y1={b[1] - ny} x2={b[0] + nx} y2={b[1] + ny} />
          <circle cx={a[0]} cy={a[1]} r={6} onPointerDown={handle('a')} />
          <circle cx={b[0]} cy={b[1]} r={6} onPointerDown={handle('b')} />
          <circle cx={m[0]} cy={m[1]} r={8} className="pin" onPointerDown={handle('m')} />
        </g>);
      }
      if (c.kind === 'radial') {
        const ctr = srcCss(c.cx, c.cy);
        const pts: string[] = [];
        for (let k = 0; k <= 48; k++) {
          const t = (k / 48) * Math.PI * 2, cs = Math.cos((c.angle * Math.PI) / 180), sn = Math.sin((c.angle * Math.PI) / 180);
          const ex = Math.cos(t) * c.rx, ey = Math.sin(t) * c.ry;
          const q = srcCss(c.cx + ex * cs - ey * sn * (L.g.H / L.g.W), c.cy + ex * sn * (L.g.W / L.g.H) + ey * cs);
          pts.push(q.join(','));
        }
        const edge = (which: 'x' | 'y' | 'm') => (e: React.PointerEvent) => {
          e.stopPropagation();
          const st = uvToSrc(...toUV(e));
          let ns = s;
          const mv = (ev: PointerEvent) => {
            const [x, y] = uvToSrc(...toUV(ev));
            ns = updateMask((mm) => { const cc = mm.comps[ci] as any; if (which === 'm') { cc.cx = c.cx + x - st[0]; cc.cy = c.cy + y - st[1]; } else if (which === 'x') cc.rx = Math.max(0.005, Math.abs(x - c.cx)); else cc.ry = Math.max(0.005, Math.abs(y - c.cy)); return mm; });
          };
          const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); p.onCommit(ns, 'Edit radial'); };
          window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
        };
        const ex = srcCss(c.cx + c.rx, c.cy), ey = srcCss(c.cx, c.cy - c.ry);
        overlay.push(<g key={'r' + ci} className="mask-gizmo">
          <polyline points={pts.join(' ')} fill="none" />
          <circle cx={ctr[0]} cy={ctr[1]} r={8} className="pin" onPointerDown={edge('m')} />
          <circle cx={ex[0]} cy={ex[1]} r={6} onPointerDown={edge('x')} />
          <circle cx={ey[0]} cy={ey[1]} r={6} onPointerDown={edge('y')} />
        </g>);
      }
    });
    if (p.draw === 'brush' && cursor) {
      const r = ((p.brush.size / 100) * 0.08 * L.g.outW * L.z) / L.D;
      overlay.push(<g key="bc"><circle cx={cursor[0]} cy={cursor[1]} r={r} className="brush-cursor" /><circle cx={cursor[0]} cy={cursor[1]} r={r * (1 - p.brush.feather / 100)} className="brush-cursor inner" /></g>);
    }
  }
  if (L && p.before === 'split' && !cropMode) {
    const x = (L.ox + split * L.Dw) / L.D;
    overlay.push(<g key="split"><line x1={x} y1={0} x2={x} y2={size[1]} className="split-line" />
      <rect x={x - 8} y={size[1] / 2 - 20} width={16} height={40} rx={4} className="split-handle" onPointerDown={(e) => {
        e.stopPropagation();
        const mv = (ev: PointerEvent) => { const [u] = toUV(ev); setSplit(Math.min(1, Math.max(0, u))); };
        const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      }} /></g>);
  }

  const cursorStyle = p.tool === 'wb' ? 'crosshair' : p.tool === 'spot' || (p.tool === 'mask' && p.draw === 'brush') ? 'none' : p.tool === 'mask' && p.draw ? 'crosshair' : p.tool === 'crop' ? 'alias' : p.zoom === 'fit' ? 'zoom-in' : 'grab';

  return (
    <div className="viewer" ref={wrap} onPointerDown={onDown} onWheel={wheel} style={{ cursor: cursorStyle }}
      onPointerMove={(e) => { const b = wrap.current!.getBoundingClientRect(); setCursor([e.clientX - b.left, e.clientY - b.top]); }}
      onPointerLeave={() => setCursor(null)} onContextMenu={(e) => e.preventDefault()}>
      <canvas ref={canvas} className="gl" />
      <canvas ref={beforeCv} className="before" style={{ display: (p.before === 'split' || p.before === 'side') && !cropMode && ready ? 'block' : 'none' }} />
      <svg className="overlay" width={size[0]} height={size[1]}>{overlay}</svg>
      {(p.before === 'side' || p.before === 'split') && ready && !cropMode && <><div className="ba-label left">Before</div><div className="ba-label right">After</div></>}
      {(holdBefore || p.before === 'hold') && ready && <div className="ba-label left">Before</div>}
      {!ready && !err && <div className="viewer-msg"><div className="spinner" />{p.photo.raw ? 'Decoding RAW file…' : 'Loading photo…'}</div>}
      {err && <div className="viewer-msg error">{err}</div>}
    </div>
  );
}

export function useSpaceKey() {
  useEffect(() => {
    const d = (e: KeyboardEvent) => { if (e.code === 'Space' && !(e.target as HTMLElement).closest('input,textarea,select,button')) { (window as any).__spaceHeld = true; } };
    const u = (e: KeyboardEvent) => { if (e.code === 'Space') (window as any).__spaceHeld = false; };
    window.addEventListener('keydown', d); window.addEventListener('keyup', u);
    return () => { window.removeEventListener('keydown', d); window.removeEventListener('keyup', u); };
  }, []);
}

export { computeGeom };
