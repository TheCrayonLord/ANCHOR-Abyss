import React, { useState } from 'react';
import { Pipette, Wand2, Plus, Trash2, Eye, EyeOff, Brush, Circle, Minus, Mountain, User, Square, Copy as CopyIcon, FlipHorizontal } from 'lucide-react';
import { Section, Slider, CurveEditor, ColorWheel, Seg } from './common';
import { HSL_BANDS, PROFILES, newMask, defaultSettings, clone, LOCAL_ZERO, type Settings, type Mask, type MaskComp, type Pt, type LocalAdj } from '../engine/settings';
import { ASPECTS, cropForAspect, orientedDims } from '../engine/geometry';
import { WB_PRESETS } from '../engine/auto';
import type { Histo } from '../engine/auto';
import type { BrushOpts, SpotOpts } from './Viewer';

export interface Ed { s: Settings; live: (s: Settings) => void; commit: (s: Settings, label?: string) => void; raw: boolean }

function setPath(s: any, path: string, v: any) {
  const out = clone(s);
  const k = path.split('.');
  let o = out;
  for (let i = 0; i < k.length - 1; i++) o = o[k[i]];
  o[k[k.length - 1]] = v;
  return out;
}
function getPath(s: any, path: string) { return path.split('.').reduce((o, k) => o[k], s); }

export function useSl(ed: Ed) {
  return (label: string, path: string, min: number, max: number, o: { step?: number; def?: number; track?: string; fmt?: (v: number) => string; title?: string; disabled?: boolean } = {}) => (
    <Slider key={path} label={label} value={getPath(ed.s, path)} min={min} max={max} step={o.step} def={o.def ?? getPath(defaultSettings(), path)} track={o.track} fmt={o.fmt} title={o.title} disabled={o.disabled}
      onChange={(v) => ed.live(setPath(ed.s, path, v))} onCommit={(v) => ed.commit(setPath(ed.s, path, v), `${label} ${v > 0 ? '+' : ''}${o.step && o.step < 1 ? v.toFixed(2) : Math.round(v)}`)} />
  );
}

const T = {
  temp: 'linear-gradient(90deg,#3d7fd6,#d8d8d8,#e0b23d)',
  tint: 'linear-gradient(90deg,#2fa84f,#d8d8d8,#c83fbe)',
  exp: 'linear-gradient(90deg,#111,#eee)',
  hue: 'linear-gradient(90deg,#ff3b3b,#ffb03b,#fff03b,#3bff5a,#3bf6ff,#3b62ff,#b03bff,#ff3bd2,#ff3b3b)',
  sat: 'linear-gradient(90deg,#888,#e8473b)',
};
const BAND_COL = ['#e5484d', '#f08c2e', '#f5d02b', '#3cb95b', '#3ac7cf', '#3e7ef7', '#8e55e0', '#d94ccf'];

export function BasicPanel({ ed, onAuto, onAutoWB, wbPick, setWbPick }: { ed: Ed; onAuto: () => void; onAutoWB: () => void; wbPick: boolean; setWbPick: (b: boolean) => void }) {
  const sl = useSl(ed);
  const s = ed.s;
  const groups = [...new Set(PROFILES.map((p) => p.group))];
  return (
    <Section title="Basic" id="basic" onReset={() => { const d = defaultSettings(); ed.commit({ ...s, wb: d.wb, temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0 }, 'Reset Basic'); }}>
      <div className="row">
        <span className="lbl">Treatment</span>
        <Seg value={s.treatment} options={[['color', 'Color'], ['bw', 'B&W']]} onChange={(v) => ed.commit({ ...s, treatment: v }, v === 'bw' ? 'Black & White' : 'Color')} />
      </div>
      <div className="row">
        <span className="lbl">Profile</span>
        <select value={s.profile} onChange={(e) => ed.commit({ ...s, profile: e.target.value }, 'Profile: ' + PROFILES.find((p) => p.id === e.target.value)?.name)}>
          {groups.map((g) => <optgroup key={g} label={g}>{PROFILES.filter((p) => p.group === g).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}
        </select>
      </div>
      {s.profile !== 'color' && sl('Profile amount', 'profileAmount', 0, 200, { def: 100 })}
      <div className="row">
        <span className="lbl">WB</span>
        <select value={s.wb} onChange={(e) => {
          const v = e.target.value as Settings['wb'];
          if (v === 'auto') { onAutoWB(); return; }
          const pr = WB_PRESETS[v];
          ed.commit({ ...s, wb: v, ...(pr || {}) }, 'White balance: ' + v);
        }}>
          <option value="asShot">As Shot</option><option value="auto">Auto</option><option value="daylight">Daylight</option><option value="cloudy">Cloudy</option>
          <option value="shade">Shade</option><option value="tungsten">Tungsten</option><option value="fluorescent">Fluorescent</option><option value="flash">Flash</option><option value="custom">Custom</option>
        </select>
        <button className={'icon' + (wbPick ? ' on' : '')} title="White balance selector (W): click something neutral" onClick={() => setWbPick(!wbPick)}><Pipette size={15} /></button>
      </div>
      {sl('Temp', 'temp', -100, 100, { track: T.temp })}
      {sl('Tint', 'tint', -100, 100, { track: T.tint })}
      <div className="sub-head">Tone <button className="link" onClick={onAuto}><Wand2 size={12} /> Auto</button></div>
      {sl('Exposure', 'exposure', -5, 5, { step: 0.01, track: T.exp })}
      {sl('Contrast', 'contrast', -100, 100)}
      {sl('Highlights', 'highlights', -100, 100)}
      {sl('Shadows', 'shadows', -100, 100)}
      {sl('Whites', 'whites', -100, 100)}
      {sl('Blacks', 'blacks', -100, 100)}
      <div className="sub-head">Presence</div>
      {sl('Texture', 'texture', -100, 100)}
      {sl('Clarity', 'clarity', -100, 100)}
      {sl('Dehaze', 'dehaze', -100, 100)}
      {sl('Vibrance', 'vibrance', -100, 100, { track: T.sat })}
      {sl('Saturation', 'saturation', -100, 100, { track: T.sat })}
    </Section>
  );
}

export function CurvePanel({ ed, histo }: { ed: Ed; histo: Histo | null }) {
  const [ch, setCh] = useState<'param' | 'master' | 'red' | 'green' | 'blue'>('param');
  const sl = useSl(ed);
  const s = ed.s;
  const col = { master: '#e6e6e6', red: '#ff5a5a', green: '#5ad46a', blue: '#5a8cff' } as const;
  return (
    <Section title="Tone Curve" id="curve" onReset={() => ed.commit({ ...s, curve: defaultSettings().curve }, 'Reset Tone Curve')}>
      <Seg value={ch} options={[['param', 'Region'], ['master', 'Point'], ['red', 'R'], ['green', 'G'], ['blue', 'B']]} onChange={setCh} />
      {ch === 'param' ? (
        <>
          <ParamCurvePreview c={s.curve} />
          {sl('Highlights', 'curve.highlights', -100, 100)}
          {sl('Lights', 'curve.lights', -100, 100)}
          {sl('Darks', 'curve.darks', -100, 100)}
          {sl('Shadows', 'curve.shadows', -100, 100)}
          <div className="sub-head">Region splits</div>
          {sl('Shadows / Darks', 'curve.s1', 10, 70, { def: 25 })}
          {sl('Darks / Lights', 'curve.s2', 20, 80, { def: 50 })}
          {sl('Lights / Highlights', 'curve.s3', 30, 90, { def: 75 })}
        </>
      ) : (
        <>
          <CurveEditor pts={s.curve[ch]} color={col[ch]} histo={histo}
            onChange={(p: Pt[]) => ed.live({ ...s, curve: { ...s.curve, [ch]: p } })}
            onCommit={(p: Pt[]) => ed.commit({ ...s, curve: { ...s.curve, [ch]: p } }, 'Point curve')} />
          <div className="row small">
            <select value="" onChange={(e) => {
              const presets: Record<string, Pt[]> = { linear: [[0, 0], [1, 1]], medium: [[0, 0], [0.25, 0.21], [0.75, 0.8], [1, 1]], strong: [[0, 0], [0.25, 0.17], [0.75, 0.85], [1, 1]], fade: [[0, 0.08], [0.5, 0.52], [1, 0.95]], invert: [[0, 1], [1, 0]] };
              if (presets[e.target.value]) ed.commit({ ...s, curve: { ...s.curve, [ch]: presets[e.target.value] } }, 'Point curve preset');
            }}>
              <option value="">Curve preset…</option><option value="linear">Linear</option><option value="medium">Medium contrast</option><option value="strong">Strong contrast</option><option value="fade">Faded film</option><option value="invert">Negative (invert)</option>
            </select>
            <span className="hint">Click curve to add · double-click point to remove</span>
          </div>
        </>
      )}
    </Section>
  );
}

function ParamCurvePreview({ c }: { c: Settings['curve'] }) {
  const { parametric } = require_curve();
  const f = parametric(c);
  let d = '';
  for (let i = 0; i <= 80; i++) { const x = i / 80; d += `${i ? 'L' : 'M'}${x * 240},${(1 - f(x)) * 120}`; }
  return (
    <svg className="curve small" viewBox="0 0 240 120">
      {[c.s1, c.s2, c.s3].map((v, i) => <line key={i} x1={(v / 100) * 240} x2={(v / 100) * 240} y1={0} y2={120} className="grid" />)}
      <line x1={0} y1={120} x2={240} y2={0} className="diag" />
      <path d={d} stroke="#e6e6e6" strokeWidth={2} fill="none" />
    </svg>
  );
}
import * as curveMod from '../engine/curve';
function require_curve() { return curveMod; }

export function MixerPanel({ ed }: { ed: Ed }) {
  const [mode, setMode] = useState<'hue' | 'sat' | 'lum' | 'all'>('hue');
  const sl = useSl(ed);
  const s = ed.s;
  const bw = s.treatment === 'bw' || PROFILES.find((p) => p.id === s.profile)?.bw;
  if (bw) {
    return (
      <Section title="B&W Mix" id="mixer" onReset={() => ed.commit({ ...s, bw: defaultSettings().bw }, 'Reset B&W mix')}>
        {HSL_BANDS.map((b, i) => sl(b, `bw.${i}`, -100, 100, { def: defaultSettings().bw[i], track: `linear-gradient(90deg,#111,${BAND_COL[i]},#fff)` }))}
        <button className="btn small" onClick={() => ed.commit({ ...s, bw: [0, 0, 0, 0, 0, 0, 0, 0] }, 'B&W mix: flat')}>Flatten mix</button>
      </Section>
    );
  }
  const key = mode === 'all' ? null : mode;
  return (
    <Section title="Color Mixer" id="mixer" onReset={() => ed.commit({ ...s, hsl: defaultSettings().hsl }, 'Reset Color Mixer')}>
      <Seg value={mode} options={[['hue', 'Hue'], ['sat', 'Saturation'], ['lum', 'Luminance'], ['all', 'All']]} onChange={setMode} />
      {(key ? [key] : (['hue', 'sat', 'lum'] as const)).map((k) => (
        <div key={k}>
          {!key && <div className="sub-head">{k === 'hue' ? 'Hue' : k === 'sat' ? 'Saturation' : 'Luminance'}</div>}
          {HSL_BANDS.map((b, i) => sl(b, `hsl.${k}.${i}`, -100, 100, {
            track: k === 'hue' ? `linear-gradient(90deg,${BAND_COL[(i + 7) % 8]},${BAND_COL[i]},${BAND_COL[(i + 1) % 8]})` : k === 'sat' ? `linear-gradient(90deg,#888,${BAND_COL[i]})` : `linear-gradient(90deg,#111,${BAND_COL[i]},#fff)`,
          }))}
        </div>
      ))}
    </Section>
  );
}

export function GradePanel({ ed }: { ed: Ed }) {
  const s = ed.s;
  const [zone, setZone] = useState<'three' | 'sh' | 'mid' | 'hi' | 'global'>('three');
  const sl = useSl(ed);
  const wheel = (z: 'sh' | 'mid' | 'hi' | 'global', label: string, size: number) => (
    <div className="wheel-box" key={z}>
      <div className="wheel-label">{label}</div>
      <ColorWheel size={size} hue={s.grade[z][0]} sat={s.grade[z][1]}
        onChange={(h, sat) => ed.live({ ...s, grade: { ...s.grade, [z]: [h, sat, s.grade[z][2]] } })}
        onCommit={() => ed.commit(ed.s, `Color grading ${label}`)} />
      <Slider label="Lum" value={s.grade[z][2]} min={-100} max={100} onChange={(v) => ed.live({ ...s, grade: { ...s.grade, [z]: [s.grade[z][0], s.grade[z][1], v] } })} onCommit={() => ed.commit(ed.s, `Color grading ${label}`)} />
    </div>
  );
  return (
    <Section title="Color Grading" id="grade" onReset={() => ed.commit({ ...s, grade: defaultSettings().grade }, 'Reset Color Grading')}>
      <Seg value={zone} options={[['three', '3-way'], ['sh', 'Shadows'], ['mid', 'Midtones'], ['hi', 'Highlights'], ['global', 'Global']]} onChange={setZone} />
      {zone === 'three' ? (
        <div className="wheels">
          <div className="wheel-row">{wheel('mid', 'Midtones', 104)}</div>
          <div className="wheel-row">{wheel('sh', 'Shadows', 92)}{wheel('hi', 'Highlights', 92)}</div>
          {wheel('global', 'Global', 92)}
        </div>
      ) : (
        <div className="wheels single">
          {wheel(zone, ({ sh: 'Shadows', mid: 'Midtones', hi: 'Highlights', global: 'Global' } as any)[zone], 170)}
          <Slider label="Hue" value={s.grade[zone][0]} min={0} max={360} track={T.hue} onChange={(v) => ed.live({ ...s, grade: { ...s.grade, [zone]: [v, s.grade[zone][1], s.grade[zone][2]] } })} onCommit={() => ed.commit(ed.s, 'Color grading hue')} />
          <Slider label="Saturation" value={s.grade[zone][1]} min={0} max={100} onChange={(v) => ed.live({ ...s, grade: { ...s.grade, [zone]: [s.grade[zone][0], v, s.grade[zone][2]] } })} onCommit={() => ed.commit(ed.s, 'Color grading saturation')} />
        </div>
      )}
      {sl('Blending', 'grade.blending', 0, 100, { def: 50 })}
      {sl('Balance', 'grade.balance', -100, 100)}
    </Section>
  );
}

export function DetailPanel({ ed }: { ed: Ed }) {
  const sl = useSl(ed);
  const s = ed.s;
  return (
    <Section title="Detail" id="detail" onReset={() => ed.commit({ ...s, sharpen: defaultSettings().sharpen, nr: defaultSettings().nr }, 'Reset Detail')}>
      <div className="sub-head">Sharpening</div>
      {sl('Amount', 'sharpen.amount', 0, 150, { def: 40 })}
      {sl('Radius', 'sharpen.radius', 0.5, 3, { step: 0.1, def: 1 })}
      {sl('Detail', 'sharpen.detail', 0, 100, { def: 25 })}
      {sl('Masking', 'sharpen.masking', 0, 100, { title: 'Hold back sharpening on smooth areas' })}
      <div className="sub-head">Noise Reduction</div>
      {sl('Luminance', 'nr.lum', 0, 100)}
      {sl('Detail', 'nr.lumDetail', 0, 100, { def: 50, disabled: !s.nr.lum })}
      {sl('Contrast', 'nr.lumContrast', 0, 100, { disabled: !s.nr.lum })}
      {sl('Color', 'nr.color', 0, 100, { def: 25 })}
      {sl('Detail', 'nr.colorDetail', 0, 100, { def: 50, disabled: !s.nr.color })}
      {sl('Smoothness', 'nr.colorSmooth', 0, 100, { def: 50, disabled: !s.nr.color })}
      <p className="hint">Zoom to 100% (Z) to judge sharpening and noise accurately.</p>
    </Section>
  );
}

export function LensPanel({ ed, onAutoCA, hasFocal }: { ed: Ed; onAutoCA: () => void; hasFocal: boolean }) {
  const sl = useSl(ed);
  const s = ed.s;
  const L = s.lens;
  return (
    <Section title="Lens Corrections" id="lens" onReset={() => ed.commit({ ...s, lens: defaultSettings().lens }, 'Reset Lens')}>
      <label className="check"><input type="checkbox" checked={L.ca} onChange={(e) => { if (e.target.checked) onAutoCA(); else ed.commit({ ...s, lens: { ...L, ca: false, caRed: 0, caBlue: 0 } }, 'Remove CA off'); }} /> Remove chromatic aberration</label>
      <label className="check" title={hasFocal ? 'Generic correction estimated from the focal length in the photo’s metadata' : 'No focal length in this photo’s metadata'}><input type="checkbox" checked={L.profile} disabled={!hasFocal} onChange={(e) => ed.commit({ ...s, lens: { ...L, profile: e.target.checked } }, 'Lens profile')} /> Enable lens profile (generic, from focal length)</label>
      <div className="sub-head">Manual</div>
      {sl('Distortion', 'lens.distortion', -100, 100)}
      {sl('Vignetting', 'lens.vignette', -100, 100)}
      {sl('Midpoint', 'lens.vignetteMid', 0, 100, { def: 50, disabled: !L.vignette })}
      {L.ca && <>{sl('Red / Cyan fringe', 'lens.caRed', -100, 100)}{sl('Blue / Yellow fringe', 'lens.caBlue', -100, 100)}</>}
      <div className="sub-head">Defringe</div>
      {sl('Purple amount', 'lens.purple', 0, 20)}
      {sl('Purple hue from', 'lens.purpleLo', 200, 340, { def: 270, disabled: !L.purple, track: 'linear-gradient(90deg,#3b62ff,#b03bff,#ff3bd2)' })}
      {sl('Purple hue to', 'lens.purpleHi', 200, 340, { def: 320, disabled: !L.purple, track: 'linear-gradient(90deg,#3b62ff,#b03bff,#ff3bd2)' })}
      {sl('Green amount', 'lens.green', 0, 20)}
      {sl('Green hue from', 'lens.greenLo', 40, 150, { def: 75, disabled: !L.green, track: 'linear-gradient(90deg,#fff03b,#3bff5a,#3bf6ff)' })}
      {sl('Green hue to', 'lens.greenHi', 40, 150, { def: 115, disabled: !L.green, track: 'linear-gradient(90deg,#fff03b,#3bff5a,#3bf6ff)' })}
    </Section>
  );
}

export function TransformPanel({ ed, onUpright }: { ed: Ed; onUpright: (mode: 'level' | 'off') => void }) {
  const sl = useSl(ed);
  const s = ed.s;
  return (
    <Section title="Transform" id="transform" onReset={() => ed.commit({ ...s, transform: defaultSettings().transform }, 'Reset Transform')}>
      <div className="row small wrap">
        <button className="btn small" onClick={() => onUpright('off')}>Off</button>
        <button className="btn small" onClick={() => onUpright('level')} title="Find the dominant horizon or verticals and straighten">Auto level</button>
      </div>
      {sl('Vertical', 'transform.vertical', -100, 100)}
      {sl('Horizontal', 'transform.horizontal', -100, 100)}
      {sl('Rotate', 'transform.rotate', -10, 10, { step: 0.1 })}
      {sl('Aspect', 'transform.aspect', -100, 100)}
      {sl('Scale', 'transform.scale', 50, 150, { def: 100 })}
      {sl('Offset X', 'transform.x', -100, 100, { step: 0.1 })}
      {sl('Offset Y', 'transform.y', -100, 100, { step: 0.1 })}
      <p className="hint">Use the crop tool’s “Constrain to image” to trim edges a correction pulls in.</p>
    </Section>
  );
}

export function EffectsPanel({ ed }: { ed: Ed }) {
  const sl = useSl(ed);
  const s = ed.s;
  return (
    <Section title="Effects" id="effects" onReset={() => ed.commit({ ...s, vignette: defaultSettings().vignette, grain: defaultSettings().grain }, 'Reset Effects')}>
      <div className="sub-head">Post-Crop Vignetting</div>
      <div className="row"><span className="lbl">Style</span>
        <select value={s.vignette.style} onChange={(e) => ed.commit({ ...s, vignette: { ...s.vignette, style: e.target.value as any } }, 'Vignette style')}>
          <option value="highlight">Highlight priority</option><option value="color">Color priority</option><option value="paint">Paint overlay</option>
        </select>
      </div>
      {sl('Amount', 'vignette.amount', -100, 100)}
      {sl('Midpoint', 'vignette.midpoint', 0, 100, { def: 50, disabled: !s.vignette.amount })}
      {sl('Roundness', 'vignette.roundness', -100, 100, { disabled: !s.vignette.amount })}
      {sl('Feather', 'vignette.feather', 0, 100, { def: 50, disabled: !s.vignette.amount })}
      {sl('Highlights', 'vignette.highlights', 0, 100, { disabled: !s.vignette.amount || s.vignette.style === 'paint' })}
      <div className="sub-head">Grain</div>
      {sl('Amount', 'grain.amount', 0, 100)}
      {sl('Size', 'grain.size', 0, 100, { def: 25, disabled: !s.grain.amount })}
      {sl('Roughness', 'grain.roughness', 0, 100, { def: 50, disabled: !s.grain.amount })}
    </Section>
  );
}

export function CalibrationPanel({ ed }: { ed: Ed }) {
  const sl = useSl(ed);
  const s = ed.s;
  return (
    <Section title="Calibration" id="calib" open={false} onReset={() => ed.commit({ ...s, calib: defaultSettings().calib }, 'Reset Calibration')}>
      {sl('Shadows tint', 'calib.shadowTint', -100, 100, { track: T.tint })}
      <div className="sub-head">Red primary</div>
      {sl('Hue', 'calib.redHue', -100, 100, { track: 'linear-gradient(90deg,#ff3b9a,#ff3b3b,#ff9a3b)' })}
      {sl('Saturation', 'calib.redSat', -100, 100, { track: 'linear-gradient(90deg,#888,#ff3b3b)' })}
      <div className="sub-head">Green primary</div>
      {sl('Hue', 'calib.greenHue', -100, 100, { track: 'linear-gradient(90deg,#c8ff3b,#3bff5a,#3bffc8)' })}
      {sl('Saturation', 'calib.greenSat', -100, 100, { track: 'linear-gradient(90deg,#888,#3bff5a)' })}
      <div className="sub-head">Blue primary</div>
      {sl('Hue', 'calib.blueHue', -100, 100, { track: 'linear-gradient(90deg,#3bc8ff,#3b62ff,#9a3bff)' })}
      {sl('Saturation', 'calib.blueSat', -100, 100, { track: 'linear-gradient(90deg,#888,#3b62ff)' })}
    </Section>
  );
}

// ---------------- tool panels ----------------

export function CropPanel({ ed, W, H, onLevel }: { ed: Ed; W: number; H: number; onLevel: () => void }) {
  const s = ed.s;
  const [OW, OH] = orientedDims(W, H, s.orient);
  return (
    <div className="tool-panel">
      <div className="tool-title">Crop & Straighten</div>
      <div className="row"><span className="lbl">Aspect</span>
        <select value={s.crop.aspect} onChange={(e) => ed.commit({ ...s, crop: cropForAspect(e.target.value, OW, OH, s.crop) }, 'Crop aspect')}>
          {Object.keys(ASPECTS).map((a) => <option key={a} value={a}>{a === 'original' ? 'Original' : a === 'free' ? 'Free' : a}</option>)}
        </select>
        <button className="icon" title="Swap orientation (X)" onClick={() => {
          const r = (s.crop.w * OW) / (s.crop.h * OH);
          const cur = Object.entries(ASPECTS).find(([, v]) => v && v > 0 && Math.abs(v - 1 / r) < 0.01);
          if (cur) ed.commit({ ...s, crop: cropForAspect(cur[0], OW, OH, s.crop) }, 'Crop orientation');
        }}><FlipHorizontal size={15} /></button>
      </div>
      <Slider label="Angle" value={s.crop.angle} min={-45} max={45} step={0.1} onChange={(v) => ed.live({ ...s, crop: { ...s.crop, angle: v } })} onCommit={(v) => ed.commit({ ...s, crop: { ...s.crop, angle: v } }, 'Straighten')} />
      <div className="row small wrap">
        <button className="btn small" onClick={onLevel}>Auto straighten</button>
        <button className="btn small" onClick={() => ed.commit({ ...s, orient: (s.orient + 3) % 4, crop: { ...defaultSettings().crop } }, 'Rotate left')}>⟲ 90°</button>
        <button className="btn small" onClick={() => ed.commit({ ...s, orient: (s.orient + 1) % 4, crop: { ...defaultSettings().crop } }, 'Rotate right')}>⟳ 90°</button>
        <button className="btn small" onClick={() => ed.commit({ ...s, flipH: !s.flipH }, 'Flip horizontal')}>Flip H</button>
        <button className="btn small" onClick={() => ed.commit({ ...s, flipV: !s.flipV }, 'Flip vertical')}>Flip V</button>
      </div>
      <label className="check"><input type="checkbox" checked={s.crop.constrain} onChange={(e) => ed.commit({ ...s, crop: { ...s.crop, constrain: e.target.checked } }, 'Constrain crop')} /> Constrain to image</label>
      <div className="row small"><button className="btn small" onClick={() => ed.commit({ ...s, crop: defaultSettings().crop }, 'Reset crop')}>Reset crop</button><span className="hint">Drag outside the box to rotate</span></div>
    </div>
  );
}

export function SpotPanel({ ed, opts, setOpts, sel, setSel, redeye }: { ed: Ed; opts: SpotOpts; setOpts: (o: SpotOpts) => void; sel: string | null; setSel: (id: string | null) => void; redeye: boolean }) {
  const s = ed.s;
  if (redeye) {
    return (
      <div className="tool-panel">
        <div className="tool-title">Red Eye Correction</div>
        <p className="hint">Drag from the centre of each eye outwards.</p>
        {s.redeye.length > 0 && <>
          <Slider label="Pupil size" value={s.redeye[s.redeye.length - 1].pupil} min={0} max={100} def={50} onChange={(v) => ed.live({ ...s, redeye: s.redeye.map((r) => ({ ...r, pupil: v })) })} onCommit={() => ed.commit(ed.s, 'Red eye pupil')} />
          <Slider label="Darken" value={s.redeye[s.redeye.length - 1].darken} min={0} max={100} def={50} onChange={(v) => ed.live({ ...s, redeye: s.redeye.map((r) => ({ ...r, darken: v })) })} onCommit={() => ed.commit(ed.s, 'Red eye darken')} />
          <label className="check"><input type="checkbox" checked={s.redeye[s.redeye.length - 1].pet} onChange={(e) => ed.commit({ ...s, redeye: s.redeye.map((r) => ({ ...r, pet: e.target.checked })) }, 'Pet eye')} /> Pet eye</label>
        </>}
        <button className="btn small" disabled={!s.redeye.length} onClick={() => ed.commit({ ...s, redeye: [] }, 'Clear red eye')}>Reset</button>
      </div>
    );
  }
  const sp = s.spots.find((x) => x.id === sel);
  return (
    <div className="tool-panel">
      <div className="tool-title">Healing</div>
      <Seg value={sp ? sp.mode : opts.mode} options={[['heal', 'Heal'], ['clone', 'Clone']]} onChange={(m) => { setOpts({ ...opts, mode: m }); if (sp) ed.commit({ ...s, spots: s.spots.map((x) => (x.id === sp.id ? { ...x, mode: m } : x)) }, 'Spot mode'); }} />
      <Slider label="Size" value={opts.size} min={2} max={100} def={20} onChange={(v) => { setOpts({ ...opts, size: v }); }} />
      <Slider label="Feather" value={sp ? sp.feather : opts.feather} min={0} max={100} def={40} onChange={(v) => { setOpts({ ...opts, feather: v }); if (sp) ed.live({ ...s, spots: s.spots.map((x) => (x.id === sp.id ? { ...x, feather: v } : x)) }); }} onCommit={() => sp && ed.commit(ed.s, 'Spot feather')} />
      <Slider label="Opacity" value={sp ? sp.opacity : opts.opacity} min={0} max={100} def={100} onChange={(v) => { setOpts({ ...opts, opacity: v }); if (sp) ed.live({ ...s, spots: s.spots.map((x) => (x.id === sp.id ? { ...x, opacity: v } : x)) }); }} onCommit={() => sp && ed.commit(ed.s, 'Spot opacity')} />
      <p className="hint">Click a blemish. Drag the source circle to choose what is copied. [ and ] change size. Delete removes the selected spot.</p>
      <div className="row small">
        <button className="btn small" disabled={!sp} onClick={() => { ed.commit({ ...s, spots: s.spots.filter((x) => x.id !== sel) }, 'Delete spot'); setSel(null); }}>Delete spot</button>
        <button className="btn small" disabled={!s.spots.length} onClick={() => { ed.commit({ ...s, spots: [] }, 'Clear spots'); setSel(null); }}>Reset all</button>
      </div>
    </div>
  );
}

const LOCAL_SLIDERS: [keyof LocalAdj, string, number, number, number?][] = [
  ['temp', 'Temp', -100, 100], ['tint', 'Tint', -100, 100],
  ['exposure', 'Exposure', -4, 4, 0.01], ['contrast', 'Contrast', -100, 100], ['highlights', 'Highlights', -100, 100], ['shadows', 'Shadows', -100, 100],
  ['whites', 'Whites', -100, 100], ['blacks', 'Blacks', -100, 100],
  ['texture', 'Texture', -100, 100], ['clarity', 'Clarity', -100, 100], ['dehaze', 'Dehaze', -100, 100],
  ['hue', 'Hue', -100, 100], ['saturation', 'Saturation', -100, 100],
  ['sharpness', 'Sharpness', -100, 100], ['noise', 'Noise', 0, 100],
];

export function MaskPanel(p: {
  ed: Ed; active: string | null; setActive: (id: string | null) => void;
  draw: 'brush' | 'linear' | 'radial' | null; setDraw: (d: 'brush' | 'linear' | 'radial' | null) => void;
  drawMode: MaskComp['mode']; setDrawMode: (m: MaskComp['mode']) => void;
  brush: BrushOpts; setBrush: (b: BrushOpts) => void; overlay: boolean; setOverlay: (b: boolean) => void;
  sample: () => [number, number, number] | null;
}) {
  const { ed } = p;
  const s = ed.s;
  const mask = s.masks.find((m) => m.id === p.active);
  const create = (kind: string) => {
    if (s.masks.length >= 8) { alert('Up to 8 masks per photo.'); return; }
    let comp: MaskComp;
    let name = '';
    if (kind === 'brush') { comp = { kind: 'brush', mode: 'add', strokes: [] }; name = 'Brush'; }
    else if (kind === 'linear') { comp = { kind: 'linear', mode: 'add', x1: 0.5, y1: 0.2, x2: 0.5, y2: 0.55 }; name = 'Linear gradient'; }
    else if (kind === 'radial') { comp = { kind: 'radial', mode: 'add', cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.25, angle: 0, feather: 50, invert: false }; name = 'Radial gradient'; }
    else if (kind === 'sky') { comp = { kind: 'sky', mode: 'add', strength: 100 }; name = 'Sky'; }
    else if (kind === 'subject') { comp = { kind: 'subject', mode: 'add', strength: 100 }; name = 'Subject'; }
    else if (kind === 'background') { comp = { kind: 'subject', mode: 'add', strength: 100 }; name = 'Background'; }
    else if (kind === 'color') { comp = { kind: 'all', mode: 'add' }; name = 'Color range'; }
    else { comp = { kind: 'all', mode: 'add' }; name = 'Luminance range'; }
    const m = newMask(`${name} ${s.masks.length + 1}`, comp);
    if (kind === 'background') m.invert = true;
    if (kind === 'color') { const c = p.sample(); m.colorRange = { on: true, r: c?.[0] ?? 0.4, g: c?.[1] ?? 0.6, b: c?.[2] ?? 0.85, tol: 30 }; }
    if (kind === 'luminance') m.lumRange = { on: true, lo: 0.6, hi: 1, feather: 0.15 };
    ed.commit({ ...s, masks: [...s.masks, m] }, `New mask: ${name}`);
    p.setActive(m.id);
    p.setDraw(kind === 'brush' ? 'brush' : null);
    p.setOverlay(true);
  };
  const upd = (fn: (m: Mask) => void, label?: string, liveOnly = false) => {
    const ns = { ...s, masks: s.masks.map((m) => { if (m.id !== p.active) return m; const c = clone(m); fn(c); return c; }) };
    if (liveOnly) ed.live(ns); else ed.commit(ns, label);
  };
  const B = p.brush;
  return (
    <div className="tool-panel">
      <div className="tool-title">Masks</div>
      <div className="mask-create">
        <button onClick={() => create('subject')} title="Select subject (approximate)"><User size={14} />Subject</button>
        <button onClick={() => create('sky')} title="Select sky (approximate)"><Mountain size={14} />Sky</button>
        <button onClick={() => create('background')} title="Everything but the subject"><Square size={14} />Background</button>
        <button onClick={() => create('brush')} title="Brush (K)"><Brush size={14} />Brush</button>
        <button onClick={() => create('linear')} title="Linear gradient (M)"><Minus size={14} />Linear</button>
        <button onClick={() => create('radial')} title="Radial gradient (Shift+M)"><Circle size={14} />Radial</button>
        <button onClick={() => create('color')} title="Color range"><Pipette size={14} />Color range</button>
        <button onClick={() => create('luminance')} title="Luminance range"><Pipette size={14} />Luminance</button>
      </div>
      <div className="mask-list">
        {s.masks.map((m) => (
          <div key={m.id} className={'mask-item' + (m.id === p.active ? ' on' : '')} onClick={() => p.setActive(m.id)}>
            <button className="icon" onClick={(e) => { e.stopPropagation(); ed.commit({ ...s, masks: s.masks.map((x) => (x.id === m.id ? { ...x, visible: !x.visible } : x)) }, 'Toggle mask'); }}>{m.visible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
            <input value={m.name} onChange={(e) => ed.live({ ...s, masks: s.masks.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)) })} onBlur={() => ed.commit(ed.s, 'Rename mask')} />
            <button className="icon" title="Duplicate" onClick={(e) => { e.stopPropagation(); const c = clone(m); c.id = Math.random().toString(36).slice(2); c.name += ' copy'; ed.commit({ ...s, masks: [...s.masks, c] }, 'Duplicate mask'); }}><CopyIcon size={13} /></button>
            <button className="icon" title="Delete" onClick={(e) => { e.stopPropagation(); ed.commit({ ...s, masks: s.masks.filter((x) => x.id !== m.id) }, 'Delete mask'); if (p.active === m.id) p.setActive(null); }}><Trash2 size={13} /></button>
          </div>
        ))}
        {!s.masks.length && <p className="hint">Create a mask to adjust part of the photo.</p>}
      </div>
      {mask && <>
        <div className="row small wrap">
          <label className="check"><input type="checkbox" checked={p.overlay} onChange={(e) => p.setOverlay(e.target.checked)} /> Show overlay (O)</label>
          <label className="check"><input type="checkbox" checked={mask.invert} onChange={(e) => upd((m) => { m.invert = e.target.checked; }, 'Invert mask')} /> Invert</label>
        </div>
        <div className="sub-head">Components</div>
        {mask.comps.map((c, i) => (
          <div key={i} className="comp-row">
            <select value={c.mode} onChange={(e) => upd((m) => { m.comps[i].mode = e.target.value as any; }, 'Mask mode')} disabled={i === 0}>
              <option value="add">Add</option><option value="subtract">Subtract</option><option value="intersect">Intersect</option>
            </select>
            <span className="comp-kind">{c.kind === 'all' ? 'Whole photo' : c.kind[0].toUpperCase() + c.kind.slice(1)}{c.kind === 'brush' ? ` (${c.strokes.length} strokes)` : ''}</span>
            {c.kind === 'radial' && <input type="range" min={0} max={100} value={c.feather} title="Feather" onChange={(e) => upd((m) => { (m.comps[i] as any).feather = +e.target.value; }, undefined, true)} onPointerUp={() => ed.commit(ed.s, 'Radial feather')} />}
            {(c.kind === 'sky' || c.kind === 'subject') && <input type="range" min={0} max={200} value={c.strength} title="Strength" onChange={(e) => upd((m) => { (m.comps[i] as any).strength = +e.target.value; }, undefined, true)} onPointerUp={() => ed.commit(ed.s, 'Mask strength')} />}
            <button className="icon" disabled={mask.comps.length < 2} onClick={() => upd((m) => { m.comps.splice(i, 1); }, 'Remove component')}><Trash2 size={12} /></button>
          </div>
        ))}
        <div className="row small wrap">
          <select value={p.drawMode} onChange={(e) => p.setDrawMode(e.target.value as any)} title="How new components combine">
            <option value="add">Add</option><option value="subtract">Subtract</option><option value="intersect">Intersect</option>
          </select>
          <button className={'btn small' + (p.draw === 'brush' ? ' on' : '')} onClick={() => p.setDraw(p.draw === 'brush' ? null : 'brush')}><Brush size={12} /> Brush</button>
          <button className={'btn small' + (p.draw === 'linear' ? ' on' : '')} onClick={() => p.setDraw(p.draw === 'linear' ? null : 'linear')}><Minus size={12} /> Linear</button>
          <button className={'btn small' + (p.draw === 'radial' ? ' on' : '')} onClick={() => p.setDraw(p.draw === 'radial' ? null : 'radial')}><Circle size={12} /> Radial</button>
          <button className="btn small" onClick={() => upd((m) => { m.comps.push({ kind: 'sky', mode: p.drawMode, strength: 100 }); }, 'Add sky')}><Plus size={12} /> Sky</button>
          <button className="btn small" onClick={() => upd((m) => { m.comps.push({ kind: 'subject', mode: p.drawMode, strength: 100 }); }, 'Add subject')}><Plus size={12} /> Subject</button>
        </div>
        {p.draw === 'brush' && <div className="brush-opts">
          <Seg value={B.erase ? 'erase' : 'paint'} options={[['paint', 'Paint'], ['erase', 'Erase']]} onChange={(v) => p.setBrush({ ...B, erase: v === 'erase' })} />
          <Slider label="Size" value={B.size} min={1} max={100} def={20} onChange={(v) => p.setBrush({ ...B, size: v })} />
          <Slider label="Feather" value={B.feather} min={0} max={100} def={60} onChange={(v) => p.setBrush({ ...B, feather: v })} />
          <Slider label="Flow" value={B.flow} min={1} max={100} def={80} onChange={(v) => p.setBrush({ ...B, flow: v })} />
          <Slider label="Density" value={B.density} min={1} max={100} def={100} onChange={(v) => p.setBrush({ ...B, density: v })} />
          <label className="check"><input type="checkbox" checked={B.autoMask} onChange={(e) => p.setBrush({ ...B, autoMask: e.target.checked })} /> Auto mask (stay within similar colours)</label>
        </div>}
        <div className="sub-head">Refine</div>
        <label className="check"><input type="checkbox" checked={mask.lumRange.on} onChange={(e) => upd((m) => { m.lumRange.on = e.target.checked; }, 'Luminance range')} /> Intersect with luminance range</label>
        {mask.lumRange.on && <>
          <Slider label="From" value={Math.round(mask.lumRange.lo * 100)} min={0} max={100} onChange={(v) => upd((m) => { m.lumRange.lo = v / 100; }, undefined, true)} onCommit={() => ed.commit(ed.s, 'Luminance range')} />
          <Slider label="To" value={Math.round(mask.lumRange.hi * 100)} min={0} max={100} def={100} onChange={(v) => upd((m) => { m.lumRange.hi = v / 100; }, undefined, true)} onCommit={() => ed.commit(ed.s, 'Luminance range')} />
          <Slider label="Smoothness" value={Math.round(mask.lumRange.feather * 100)} min={1} max={50} def={10} onChange={(v) => upd((m) => { m.lumRange.feather = v / 100; }, undefined, true)} onCommit={() => ed.commit(ed.s, 'Luminance range')} />
        </>}
        <label className="check"><input type="checkbox" checked={mask.colorRange.on} onChange={(e) => upd((m) => { m.colorRange.on = e.target.checked; }, 'Color range')} /> Intersect with color range</label>
        {mask.colorRange.on && <>
          <div className="row small"><span className="swatch" style={{ background: `rgb(${mask.colorRange.r * 255},${mask.colorRange.g * 255},${mask.colorRange.b * 255})` }} />
            <input type="color" value={'#' + [mask.colorRange.r, mask.colorRange.g, mask.colorRange.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}
              onChange={(e) => { const h = e.target.value; upd((m) => { m.colorRange.r = parseInt(h.slice(1, 3), 16) / 255; m.colorRange.g = parseInt(h.slice(3, 5), 16) / 255; m.colorRange.b = parseInt(h.slice(5, 7), 16) / 255; }, 'Color range colour'); }} />
            <span className="hint">Pick the colour to keep</span></div>
          <Slider label="Refine" value={mask.colorRange.tol} min={1} max={100} def={30} onChange={(v) => upd((m) => { m.colorRange.tol = v; }, undefined, true)} onCommit={() => ed.commit(ed.s, 'Color range refine')} />
        </>}
        <div className="sub-head">Adjust <button className="link" onClick={() => upd((m) => { m.adj = { ...LOCAL_ZERO }; }, 'Reset mask sliders')}>Reset</button></div>
        <Slider label="Amount" value={mask.amount} min={0} max={200} def={100} onChange={(v) => upd((m) => { m.amount = v; }, undefined, true)} onCommit={() => ed.commit(ed.s, 'Mask amount')} />
        {LOCAL_SLIDERS.map(([k, l, mn, mx, st]) => (
          <Slider key={k} label={l} value={mask.adj[k]} min={mn} max={mx} step={st} def={0}
            track={k === 'temp' ? T.temp : k === 'tint' ? T.tint : undefined}
            onChange={(v) => upd((m) => { m.adj[k] = v; }, undefined, true)} onCommit={(v) => ed.commit(ed.s, `Mask ${l} ${v}`)} />
        ))}
        <div className="row small"><span className="lbl">Color</span>
          <input type="range" min={0} max={360} value={mask.adj.colorH} style={{ background: T.hue }} className="hue-range" onChange={(e) => upd((m) => { m.adj.colorH = +e.target.value; }, undefined, true)} onPointerUp={() => ed.commit(ed.s, 'Mask color')} />
          <input type="range" min={0} max={100} value={mask.adj.colorS} title="Strength" onChange={(e) => upd((m) => { m.adj.colorS = +e.target.value; }, undefined, true)} onPointerUp={() => ed.commit(ed.s, 'Mask color')} />
        </div>
      </>}
    </div>
  );
}
