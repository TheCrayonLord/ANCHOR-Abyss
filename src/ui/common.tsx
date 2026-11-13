import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Star, Flag, X } from 'lucide-react';
import { store, type Photo, type Label } from '../catalog/store';
import type { Histo } from '../engine/auto';
import { spline } from '../engine/curve';
import type { Pt } from '../engine/settings';

export function Section(props: { title: string; children: React.ReactNode; open?: boolean; right?: React.ReactNode; id?: string; onReset?: () => void }) {
  const key = 'sec:' + (props.id || props.title);
  const [open, setOpen] = useState(() => { try { const v = localStorage.getItem(key); return v === null ? props.open !== false : v === '1'; } catch { return props.open !== false; } });
  const toggle = () => { setOpen(!open); try { localStorage.setItem(key, open ? '0' : '1'); } catch { /* ignore */ } };
  return (
    <div className="section">
      <div className="section-head" onClick={toggle} onDoubleClick={(e) => { if (props.onReset) { e.stopPropagation(); props.onReset(); } }}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{props.title}</span>
        <div className="grow" />
        <div onClick={(e) => e.stopPropagation()}>{props.right}</div>
      </div>
      {open && <div className="section-body">{props.children}</div>}
    </div>
  );
}

export interface SliderProps {
  label: string; value: number; min: number; max: number; step?: number; def?: number;
  onChange: (v: number) => void; onCommit?: (v: number) => void;
  fmt?: (v: number) => string; track?: string; disabled?: boolean; title?: string;
}

/** Slider with a gradient track, double-click to reset, editable number, arrow keys to nudge. */
export function Slider(p: SliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const step = p.step ?? 1;
  const def = p.def ?? (p.min < 0 ? 0 : p.min);
  const clamp = (v: number) => Math.min(p.max, Math.max(p.min, Math.round(v / step) * step));
  const frac = (p.value - p.min) / (p.max - p.min);
  const zf = (Math.min(p.max, Math.max(p.min, 0)) - p.min) / (p.max - p.min);
  const drag = (e: React.PointerEvent) => {
    if (p.disabled) return;
    const el = ref.current!;
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const startX = e.clientX, startV = p.value;
    const fine = e.shiftKey ? 0.2 : 1;
    let moved = false;
    let last = p.value;
    const at = (x: number) => clamp(p.min + ((x - r.left) / r.width) * (p.max - p.min));
    const mv = (ev: PointerEvent) => {
      moved = true;
      const v = fine < 1 ? clamp(startV + ((ev.clientX - startX) / r.width) * (p.max - p.min) * fine) : at(ev.clientX);
      last = v; p.onChange(v);
    };
    const up = () => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
      if (!moved) { last = at(startX); p.onChange(last); }
      p.onCommit?.(last);
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  };
  const key = (e: React.KeyboardEvent) => {
    let d = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') d = step * (e.shiftKey ? 10 : 1);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') d = -step * (e.shiftKey ? 10 : 1);
    if (d) { e.preventDefault(); const v = clamp(p.value + d); p.onChange(v); p.onCommit?.(v); }
  };
  const text = p.fmt ? p.fmt(p.value) : step < 1 ? (p.value > 0 && p.min < 0 ? '+' : '') + p.value.toFixed(step < 0.1 ? 2 : 1) : (p.value > 0 && p.min < 0 ? '+' : '') + Math.round(p.value);
  return (
    <div className={'slider' + (p.disabled ? ' disabled' : '')} title={p.title}>
      <div className="slider-top">
        <label onDoubleClick={() => { p.onChange(def); p.onCommit?.(def); }}>{p.label}</label>
        {edit === null ? (
          <span className={'slider-val' + (p.value !== def ? ' changed' : '')} onClick={() => setEdit(String(p.value))}>{text}</span>
        ) : (
          <input className="slider-input" autoFocus value={edit} onChange={(e) => setEdit(e.target.value)}
            onBlur={() => { const v = parseFloat(edit); if (!isNaN(v)) { const c = clamp(v); p.onChange(c); p.onCommit?.(c); } setEdit(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEdit(null); }} />
        )}
      </div>
      <div className="slider-track" ref={ref} tabIndex={0} onPointerDown={drag} onKeyDown={key} onDoubleClick={() => { p.onChange(def); p.onCommit?.(def); }}
        style={p.track ? { background: p.track } : undefined}>
        {!p.track && <div className="slider-fill" style={{ left: `${Math.min(zf, frac) * 100}%`, width: `${Math.abs(frac - zf) * 100}%` }} />}
        <div className="slider-thumb" style={{ left: `${frac * 100}%` }} />
      </div>
    </div>
  );
}

export function Stars({ value, onChange, size = 12 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  return (
    <span className="stars">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} className={i <= value ? 'on' : ''} fill={i <= value ? 'currentColor' : 'none'}
          onClick={(e) => { e.stopPropagation(); onChange?.(value === i ? 0 : i); }} />
      ))}
    </span>
  );
}

export function FlagMark({ flag, size = 12 }: { flag: number; size?: number }) {
  if (!flag) return null;
  return <Flag size={size} className={flag > 0 ? 'flag-pick' : 'flag-reject'} fill={flag > 0 ? 'currentColor' : 'none'} />;
}

export const LABEL_COLORS: Record<string, string> = { red: '#e5484d', yellow: '#f5c518', green: '#30a46c', blue: '#3e8ef7', purple: '#a35bdf' };

export function LabelDot({ label }: { label: Label }) {
  if (!label) return null;
  return <span className="label-dot" style={{ background: LABEL_COLORS[label] }} />;
}

export function useThumb(p: Photo | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (p) store.thumbUrl(p).then((u) => live && setUrl(u));
    return () => { live = false; };
  }, [p?.id, p?.thumbV]);
  return url;
}

export function Thumb({ p, className, style }: { p: Photo; className?: string; style?: React.CSSProperties }) {
  const url = useThumb(p);
  return url ? <img className={className} src={url} style={style} draggable={false} alt="" /> : <div className={'thumb-ph ' + (className || '')} style={style}>{p.ext.toUpperCase()}</div>;
}

export function Modal(props: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className={'modal' + (props.wide ? ' wide' : '')} role="dialog" aria-label={props.title}>
        <div className="modal-head"><span>{props.title}</span><button className="icon" onClick={props.onClose} aria-label="Close"><X size={16} /></button></div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

export function HistogramView({ h, onDrag, clip, onClip }: { h: Histo | null; onDrag?: (zone: string, d: number) => void; clip?: boolean; onClip?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const x = c.getContext('2d')!;
    const W = c.width, H = c.height;
    x.clearRect(0, 0, W, H);
    if (!h) return;
    x.globalCompositeOperation = 'lighter';
    const draw = (a: Uint32Array, col: string) => {
      x.fillStyle = col;
      x.beginPath(); x.moveTo(0, H);
      for (let i = 0; i < 256; i++) x.lineTo((i / 255) * W, H - Math.min(1, Math.sqrt(a[i] / h.max)) * (H - 4));
      x.lineTo(W, H); x.closePath(); x.fill();
    };
    draw(h.r, 'rgba(230,70,70,0.55)'); draw(h.g, 'rgba(70,200,90,0.55)'); draw(h.b, 'rgba(70,120,240,0.6)');
    x.globalCompositeOperation = 'source-over';
    if (hover) {
      const zones: Record<string, [number, number]> = { blacks: [0, 0.1], shadows: [0.1, 0.35], exposure: [0.35, 0.65], highlights: [0.65, 0.9], whites: [0.9, 1] };
      const [a, b] = zones[hover];
      x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(a * W, 0, (b - a) * W, H);
    }
  }, [h, hover]);
  const zoneAt = (fx: number) => (fx < 0.1 ? 'blacks' : fx < 0.35 ? 'shadows' : fx < 0.65 ? 'exposure' : fx < 0.9 ? 'highlights' : 'whites');
  const down = (e: React.PointerEvent) => {
    if (!onDrag) return;
    const r = (e.target as HTMLElement).getBoundingClientRect();
    const zone = zoneAt((e.clientX - r.left) / r.width);
    let lx = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => { onDrag(zone, (ev.clientX - lx) / r.width); lx = ev.clientX; };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); onDrag(zone, NaN); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  return (
    <div className="histo">
      <canvas ref={ref} width={300} height={110} onPointerDown={down}
        onPointerMove={(e) => { const r = (e.target as HTMLElement).getBoundingClientRect(); setHover(onDrag ? zoneAt((e.clientX - r.left) / r.width) : null); }}
        onPointerLeave={() => setHover(null)} />
      {h && <>
        <button className={'clip clip-lo' + (clip && h.clipLo > 0.0005 ? ' hot' : '')} title="Show clipping (J)" onClick={onClip} />
        <button className={'clip clip-hi' + (clip && h.clipHi > 0.0005 ? ' hot' : '') + (h.clipHi > 0.001 ? ' warn' : '')} title="Show clipping (J)" onClick={onClip} />
      </>}
      {hover && <div className="histo-zone">{hover[0].toUpperCase() + hover.slice(1)} · drag to adjust</div>}
    </div>
  );
}

/** Point curve editor: click to add, drag to move, double-click a point to remove it. */
export function CurveEditor({ pts, onChange, onCommit, color = '#ddd', histo }: { pts: Pt[]; onChange: (p: Pt[]) => void; onCommit: (p: Pt[]) => void; color?: string; histo?: Histo | null }) {
  const ref = useRef<SVGSVGElement>(null);
  const S = 240;
  const f = spline(pts);
  let d = '';
  for (let i = 0; i <= 120; i++) { const x = i / 120; d += `${i ? 'L' : 'M'}${x * S},${(1 - Math.min(1, Math.max(0, f(x)))) * S}`; }
  let hp = '';
  if (histo) { hp = `M0,${S}`; for (let i = 0; i < 256; i++) hp += `L${(i / 255) * S},${S - Math.min(1, Math.sqrt(histo.l[i] / histo.max)) * S * 0.6}`; hp += `L${S},${S}Z`; }
  const toPt = (e: { clientX: number; clientY: number }): Pt => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))];
  };
  const startDrag = (idx: number, list: Pt[], e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    let cur = list;
    const mv = (ev: PointerEvent) => {
      const [x, y] = toPt(ev);
      const n = cur.map((p) => [...p] as Pt);
      const lo = idx > 0 ? n[idx - 1][0] + 0.01 : 0, hi = idx < n.length - 1 ? n[idx + 1][0] - 0.01 : 1;
      n[idx] = [idx === 0 ? Math.min(x, hi) : idx === n.length - 1 ? Math.max(x, lo) : Math.min(hi, Math.max(lo, x)), y];
      cur = n; onChange(n);
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); onCommit(cur); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  return (
    <svg ref={ref} className="curve" viewBox={`0 0 ${S} ${S}`} onPointerDown={(e) => {
      const p = toPt(e);
      if (Math.abs(f(p[0]) - p[1]) > 0.12) return;
      const n = [...pts, p].sort((a, b) => a[0] - b[0]);
      onChange(n);
      startDrag(n.indexOf(p), n, e);
    }}>
      {hp && <path d={hp} fill="rgba(255,255,255,0.07)" />}
      {[0.25, 0.5, 0.75].map((g) => <g key={g}><line x1={g * S} y1={0} x2={g * S} y2={S} className="grid" /><line x1={0} y1={g * S} x2={S} y2={g * S} className="grid" /></g>)}
      <line x1={0} y1={S} x2={S} y2={0} className="diag" />
      <path d={d} stroke={color} strokeWidth={2} fill="none" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0] * S} cy={(1 - p[1]) * S} r={5} className="cpt" onPointerDown={(e) => startDrag(i, pts, e)}
          onDoubleClick={(e) => { e.stopPropagation(); if (i > 0 && i < pts.length - 1) { const n = pts.filter((_, j) => j !== i); onChange(n); onCommit(n); } }} />
      ))}
    </svg>
  );
}

/** Hue/saturation wheel for colour grading. */
export function ColorWheel({ hue, sat, onChange, onCommit, size = 110 }: { hue: number; sat: number; onChange: (h: number, s: number) => void; onCommit: () => void; size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const r = size / 2;
  const px = r + Math.cos((hue * Math.PI) / 180) * (sat / 100) * (r - 6);
  const py = r - Math.sin((hue * Math.PI) / 180) * (sat / 100) * (r - 6);
  const set = (e: { clientX: number; clientY: number }, fine: boolean) => {
    const b = ref.current!.getBoundingClientRect();
    const dx = e.clientX - b.left - r, dy = -(e.clientY - b.top - r);
    let h = (Math.atan2(dy, dx) * 180) / Math.PI; if (h < 0) h += 360;
    const s = Math.min(100, (Math.hypot(dx, dy) / (r - 6)) * 100);
    onChange(Math.round(h), Math.round(fine ? Math.min(s, 30) : s));
  };
  return (
    <div className="wheel" ref={ref} style={{ width: size, height: size }}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture(e.pointerId); set(e, e.shiftKey);
        const mv = (ev: PointerEvent) => set(ev, ev.shiftKey);
        const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); onCommit(); };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      }}
      onDoubleClick={() => { onChange(0, 0); onCommit(); }}>
      <div className="wheel-dot" style={{ left: px, top: py }} />
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, React.ReactNode][]; onChange: (v: T) => void }) {
  return <div className="seg">{options.map(([v, l]) => <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</div>;
}

export function fmtExposure(e?: number) { if (!e) return ''; return e >= 1 ? `${e}s` : `1/${Math.round(1 / e)}s`; }
export function fmtBytes(n: number) { return n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1e3) + ' KB'; }
