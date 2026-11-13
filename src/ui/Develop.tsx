import React, { useEffect, useRef, useState } from 'react';
import { Crop, Bandage, Eye, Layers, ZoomIn, Columns2, SplitSquareHorizontal, Copy, ClipboardPaste, RotateCcw, Camera, Plus, Trash2, Upload, Download, Save, Undo2, Redo2, ArrowLeftRight, Search } from 'lucide-react';
import Viewer, { type Tool, type BrushOpts, type SpotOpts, useSpaceKey } from './Viewer';
import { BasicPanel, CurvePanel, MixerPanel, GradePanel, DetailPanel, LensPanel, TransformPanel, EffectsPanel, CalibrationPanel, CropPanel, SpotPanel, MaskPanel, type Ed } from './panels';
import { Section, HistogramView, Thumb, Modal, fmtExposure } from './common';
import { store, useStore, photoTitle, type Photo, type Preset } from '../catalog/store';
import { clone, apply, pick, GROUPS, defaultSettings, uid, LOCAL_ZERO, type Settings, type MaskComp } from '../engine/settings';
import { BUILTIN_PRESETS } from '../engine/presets';
import { loadDecoded } from '../engine/pipeline';
import { autoTone, autoWB, wbFromPixel, estimateCA, type Histo } from '../engine/auto';
import { autoLevelAngle, constrainCrop, orientedDims } from '../engine/geometry';
import { xmpToSettings, settingsToXmp } from '../engine/xmp';
import { download, refreshThumb } from '../engine/export';

export default function Develop({ onSync }: { onSync: (groups?: string[]) => void }) {
  const photo = useStore((s) => (s.active ? s.photos.get(s.active) : undefined));
  if (!photo) return <div className="empty-state"><h2>No photo selected</h2><p>Import photos in the Library, then pick one to develop.</p></div>;
  return <DevelopInner photo={photo} onSync={onSync} />;
}

function DevelopInner({ photo, onSync }: { photo: Photo; onSync: (groups?: string[]) => void }) {
  const active = photo.id;
  const selected = useStore((s) => s.selected);
  const clipboard = useStore((s) => s.clipboard);
  const presets = useStore((s) => s.presets);
  const [live, setLive] = useState<Settings | null>(null);
  const [tool, setTool] = useState<Tool>('none');
  const [prevTool, setPrevTool] = useState<Tool>('none');
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  const [before, setBefore] = useState<'off' | 'split' | 'side' | 'hold'>('off');
  const [clip, setClip] = useState(false);
  const [histo, setHisto] = useState<Histo | null>(null);
  const [info, setInfo] = useState('');
  const [activeMask, setActiveMask] = useState<string | null>(null);
  const [draw, setDraw] = useState<'brush' | 'linear' | 'radial' | null>(null);
  const [drawMode, setDrawMode] = useState<MaskComp['mode']>('add');
  const [overlay, setOverlay] = useState(true);
  const [brush, setBrush] = useState<BrushOpts>({ size: 20, feather: 60, flow: 80, density: 100, erase: false, autoMask: false });
  const [spot, setSpot] = useState<SpotOpts>({ mode: 'heal', size: 20, feather: 40, opacity: 100 });
  const [selSpot, setSelSpot] = useState<string | null>(null);
  const [savePreset, setSavePreset] = useState(false);
  const [presetFilter, setPresetFilter] = useState('');
  const [hoverPreset, setHoverPreset] = useState<Partial<Settings> | null>(null);
  const thumbTimer = useRef<any>(null);
  useSpaceKey();

  useEffect(() => { setLive(null); setActiveMask(null); setSelSpot(null); }, [active]);

  const base = live || photo.settings;
  const s = hoverPreset ? apply(base, hoverPreset) : base;

  const commit = (ns: Settings, label?: string) => {
    setLive(null);
    store.commit(photo.id, ns, label);
    clearTimeout(thumbTimer.current);
    thumbTimer.current = setTimeout(() => { const p = store.s.photos.get(photo.id); if (p) refreshThumb(p); }, 1200);
  };
  const ed: Ed = { s: base, live: setLive, commit, raw: photo.raw };

  const getPreview = async () => (await loadDecoded(photo.originalId, () => store.original(photo), photo.name)).preview;

  const doAuto = async () => commit({ ...base, ...autoTone(await getPreview()) }, 'Auto tone');
  const doAutoWB = async () => commit({ ...base, wb: 'auto', ...autoWB(await getPreview()) }, 'Auto white balance');
  const doAutoCA = async () => { const r = estimateCA(await getPreview()); commit({ ...base, lens: { ...base.lens, ca: true, ...r } }, 'Remove chromatic aberration'); };
  const doLevel = async () => {
    const pv = await getPreview();
    const k = Math.min(1, 640 / Math.max(pv.w, pv.h));
    const w = Math.round(pv.w * k), h = Math.round(pv.h * k);
    const g = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (Math.floor(y / k) * pv.w + Math.floor(x / k)) * 3; g[y * w + x] = (pv.data[i] * 0.3 + pv.data[i + 1] * 0.59 + pv.data[i + 2] * 0.11) / 65535; }
    // rotate the measurement into the oriented frame (90° steps don't change the angle; flips negate it)
    let a = autoLevelAngle(g, w, h);
    if (base.flipH !== base.flipV) a = -a;
    const ns = { ...base, crop: { ...base.crop, angle: a } };
    ns.crop = constrainCrop(ns, photo.w || pv.w, photo.h || pv.h);
    commit(ns, `Auto straighten ${a.toFixed(1)}°`);
    store.toast(Math.abs(a) < 0.05 ? 'Already level' : `Straightened by ${a.toFixed(1)}°`);
  };

  const pickTool = (t: Tool) => { setPrevTool(tool); setTool(tool === t ? 'none' : t); setDraw(null); if (t === 'mask' && !activeMask && base.masks.length) setActiveMask(base.masks[base.masks.length - 1].id); };

  // keyboard shortcuts (develop only)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? store.redo(photo.id) : store.undo(photo.id); setLive(null); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(photo.id); return; }
      if (mod) return;
      switch (e.key) {
        case 'r': case 'R': pickTool('crop'); break;
        case 'q': case 'Q': pickTool('spot'); break;
        case 'w': case 'W': pickTool(tool === 'wb' ? 'none' : 'wb'); break;
        case 'k': case 'K': setTool('mask'); { const m = base.masks.find((x) => x.id === activeMask); if (!m) { createQuickMask('brush'); } setDraw('brush'); } break;
        case 'm': case 'M': setTool('mask'); createQuickMask(e.shiftKey ? 'radial' : 'linear'); break;
        case 'o': case 'O': setOverlay((v) => !v); break;
        case 'j': case 'J': setClip((v) => !v); break;
        case 'y': case 'Y': setBefore((b) => (b === 'off' ? 'side' : b === 'side' ? 'split' : 'off')); break;
        case 'z': case 'Z': setZoom((z) => (z === 'fit' ? 1 : 'fit')); break;
        case 'Escape': setTool('none'); setDraw(null); break;
        case 'Enter': if (tool === 'crop') setTool('none'); break;
        case '[': setBrush((b) => ({ ...b, size: Math.max(1, b.size - 3) })); setSpot((p) => ({ ...p, size: Math.max(2, p.size - 3) })); break;
        case ']': setBrush((b) => ({ ...b, size: Math.min(100, b.size + 3) })); setSpot((p) => ({ ...p, size: Math.min(100, p.size + 3) })); break;
        case 'Delete': case 'Backspace':
          if (tool === 'spot' && selSpot) { commit({ ...base, spots: base.spots.filter((x) => x.id !== selSpot) }, 'Delete spot'); setSelSpot(null); }
          else if (tool === 'mask' && activeMask) { commit({ ...base, masks: base.masks.filter((x) => x.id !== activeMask) }, 'Delete mask'); setActiveMask(null); }
          break;
        case 'x': case 'X': if (tool === 'crop') { const [OW, OH] = orientedDims(photo.w, photo.h, base.orient); const c = base.crop; const nw = (c.h * OH) / OW, nh = (c.w * OW) / OH; const ns = { ...base, crop: { ...c, w: Math.min(1, nw), h: Math.min(1, nh) } }; ns.crop = constrainCrop(ns, photo.w, photo.h); commit(ns, 'Crop orientation'); } break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const createQuickMask = (kind: 'brush' | 'linear' | 'radial') => {
    const comp: MaskComp = kind === 'brush' ? { kind: 'brush', mode: 'add', strokes: [] } : kind === 'linear' ? { kind: 'linear', mode: 'add', x1: 0.5, y1: 0.15, x2: 0.5, y2: 0.5 } : { kind: 'radial', mode: 'add', cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.25, angle: 0, feather: 50, invert: false };
    const name = kind === 'brush' ? 'Brush' : kind === 'linear' ? 'Linear gradient' : 'Radial gradient';
    const m = { id: uid(), name: `${name} ${base.masks.length + 1}`, visible: true, invert: false, amount: 100, comps: [comp], colorRange: { on: false, r: 0.5, g: 0.5, b: 0.5, tol: 30 }, lumRange: { on: false, lo: 0, hi: 1, feather: 0.1 }, adj: { ...LOCAL_ZERO } };
    commit({ ...base, masks: [...base.masks, m] }, `New mask: ${name}`);
    setActiveMask(m.id);
  };

  const allPresets: Preset[] = [...BUILTIN_PRESETS.map((b) => ({ ...b, builtin: true })), ...presets];
  const pgroups = [...new Set(allPresets.map((p) => p.group))];
  const ex = photo.exif;

  const importPresetFiles = async (files: FileList | null) => {
    if (!files) return;
    let n = 0;
    for (const f of Array.from(files)) {
      const txt = await f.text();
      try {
        if (f.name.endsWith('.json')) {
          const j = JSON.parse(txt);
          const list = Array.isArray(j) ? j : [j];
          for (const p of list) { await store.savePreset({ id: uid(), name: p.name || f.name, group: p.group || 'Imported', part: p.part || p.settings || {} }); n++; }
        } else {
          const r = xmpToSettings(txt);
          if (!r.count) continue;
          const { fields } = await import('../engine/xmp').then((m) => m.parseXmpFields(txt) as any);
          // keep only the groups the file actually sets
          const keys = Object.keys(fields);
          const groups = Object.keys(GROUPS).filter((g) => g !== 'Masking' && g !== 'Spot removal' && (g !== 'Crop' || keys.includes('HasCrop')));
          await store.savePreset({ id: uid(), name: r.name || f.name.replace(/\.[^.]+$/, ''), group: 'Imported', part: pick(r.settings, groups) });
          n++;
        }
      } catch (e) { console.warn(e); }
    }
    store.toast(n ? `Imported ${n} preset${n === 1 ? '' : 's'}` : 'No presets found in those files');
  };

  return (
    <div className="module develop">
      <aside className="left-panel">
        <Section title="Navigator" id="nav">
          <div className="navigator" onClick={() => setZoom('fit')}><Thumb p={photo} /></div>
          <div className="row small wrap"><button className={'btn small' + (zoom === 'fit' ? ' on' : '')} onClick={() => setZoom('fit')}>Fit</button>
            {[0.5, 1, 2, 4].map((z) => <button key={z} className={'btn small' + (zoom === z ? ' on' : '')} onClick={() => setZoom(z)}>{z * 100}%</button>)}</div>
        </Section>
        <Section title="Presets" id="presets" right={<>
          <label className="icon" title="Import presets (.xmp or .json)"><Upload size={14} /><input type="file" accept=".xmp,.json,.lrtemplate" multiple hidden onChange={(e) => importPresetFiles(e.target.files)} /></label>
          <button className="icon" title="Create preset from current settings" onClick={() => setSavePreset(true)}><Plus size={14} /></button>
        </>}>
          <div className="search-row"><Search size={12} /><input placeholder="Filter presets" value={presetFilter} onChange={(e) => setPresetFilter(e.target.value)} /></div>
          {pgroups.map((g) => {
            const list = allPresets.filter((p) => p.group === g && p.name.toLowerCase().includes(presetFilter.toLowerCase()));
            if (!list.length) return null;
            return (
              <details key={g} open={g === 'Essentials' || !!presetFilter || g === 'User Presets'}>
                <summary>{g}</summary>
                {list.map((p) => (
                  <div key={p.id} className="preset" onMouseEnter={() => setHoverPreset(p.part)} onMouseLeave={() => setHoverPreset(null)}
                    onClick={() => { setHoverPreset(null); commit(apply(base, p.part), `Preset: ${p.name}`); }}>
                    <span>{p.name}</span>
                    {!p.builtin && <span className="preset-actions">
                      <button className="icon" title="Export as XMP" onClick={(e) => { e.stopPropagation(); download(new Blob([settingsToXmp(apply(defaultSettings(), p.part), { name: p.name })]), p.name + '.xmp'); }}><Download size={12} /></button>
                      <button className="icon" title="Update with current settings" onClick={(e) => { e.stopPropagation(); store.savePreset({ ...p, part: pick(base, Object.keys(GROUPS).filter((k) => Object.keys(p.part).some((key) => GROUPS[k].includes(key as any)))) }); store.toast('Preset updated'); }}><Save size={12} /></button>
                      <button className="icon" title="Delete" onClick={(e) => { e.stopPropagation(); store.deletePreset(p.id); }}><Trash2 size={12} /></button>
                    </span>}
                  </div>
                ))}
              </details>
            );
          })}
          <p className="hint">Hover a preset to preview it on the photo.</p>
        </Section>
        <Section title="Snapshots" id="snaps" right={<button className="icon" title="Create snapshot" onClick={() => {
          const name = prompt('Snapshot name', new Date().toLocaleString());
          if (name) store.update(photo.id, { snapshots: [...photo.snapshots, { id: uid(), name, s: clone(base), t: Date.now() }] });
        }}><Camera size={14} /></button>}>
          {!photo.snapshots.length && <p className="hint">Save the current state to come back to it later.</p>}
          {photo.snapshots.map((sn) => (
            <div key={sn.id} className="preset" onMouseEnter={() => setHoverPreset(sn.s)} onMouseLeave={() => setHoverPreset(null)} onClick={() => { setHoverPreset(null); commit(clone(sn.s), `Snapshot: ${sn.name}`); }}>
              <span>{sn.name}</span>
              <span className="preset-actions"><button className="icon" onClick={(e) => { e.stopPropagation(); store.update(photo.id, { snapshots: photo.snapshots.filter((x) => x.id !== sn.id) }); }}><Trash2 size={12} /></button></span>
            </div>
          ))}
        </Section>
        <Section title="History" id="history" right={<button className="icon" title="Clear history" onClick={() => store.clearHistory(photo.id)}><Trash2 size={14} /></button>}>
          <div className="history">
            {[...photo.history].map((h, i) => ({ h, i })).reverse().map(({ h, i }) => (
              <div key={i} className={'hist-item' + (i === photo.hIndex ? ' on' : '') + (i > photo.hIndex ? ' future' : '')}
                onMouseEnter={() => setHoverPreset(h.s)} onMouseLeave={() => setHoverPreset(null)} onClick={() => { setHoverPreset(null); store.gotoHistory(photo.id, i); setLive(null); }}>{h.label}</div>
            ))}
          </div>
        </Section>
        <div className="panel-foot">
          <button className="btn" onClick={() => onSync()} title="Copy settings (Ctrl+Shift+C)"><Copy size={14} /> Copy…</button>
          <button className="btn" disabled={!clipboard} onClick={() => { commit(apply(base, clipboard!), 'Paste settings'); }} title="Paste settings (Ctrl+Shift+V)"><ClipboardPaste size={14} /> Paste</button>
        </div>
      </aside>

      <main className="center">
        <Viewer photo={photo} settings={s} tool={tool} zoom={zoom} setZoom={setZoom} before={before} clip={clip} showOverlay={overlay}
          activeMask={tool === 'mask' ? activeMask : null} draw={tool === 'mask' ? draw : null} drawMode={drawMode} brush={brush} spot={spot}
          selSpot={selSpot} setSelSpot={setSelSpot} onLive={setLive} onCommit={commit} onHisto={setHisto} onInfo={setInfo}
          onPickWB={(rgb) => { commit({ ...base, wb: 'custom', ...wbFromPixel(rgb[0], rgb[1], rgb[2], base) }, 'White balance (picked)'); setTool(prevTool === 'wb' ? 'none' : prevTool); }}
          onDrawDone={() => setDraw(null)} />
        <div className="toolbar bottom">
          <button className={'btn small' + (before !== 'off' ? ' on' : '')} title="Before / after (Y). Hold \\ to see the original." onClick={() => setBefore(before === 'off' ? 'side' : before === 'side' ? 'split' : 'off')}>
            {before === 'split' ? <SplitSquareHorizontal size={14} /> : <Columns2 size={14} />} {before === 'off' ? 'Before / After' : before === 'side' ? 'Side by side' : 'Split'}
          </button>
          {before !== 'off' && <button className="btn small" title="Copy before settings to after" onClick={() => commit(defaultSettings(), 'Reset to before')}><ArrowLeftRight size={14} /></button>}
          <button className={'btn small' + (clip ? ' on' : '')} onClick={() => setClip(!clip)} title="Clipping warnings (J)">Clipping</button>
          <button className="btn small" onClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')} title="Zoom (Z)"><ZoomIn size={14} /> {zoom === 'fit' ? 'Fit' : Math.round((zoom as number) * 100) + '%'}</button>
          <div className="grow" />
          {info && <span className="info">{info}</span>}
          <button className="icon" title="Undo (Ctrl+Z)" disabled={photo.hIndex <= 0} onClick={() => { store.undo(photo.id); setLive(null); }}><Undo2 size={15} /></button>
          <button className="icon" title="Redo (Ctrl+Shift+Z)" disabled={photo.hIndex >= photo.history.length - 1} onClick={() => { store.redo(photo.id); setLive(null); }}><Redo2 size={15} /></button>
        </div>
      </main>

      <aside className="right-panel">
        <HistogramView h={histo} clip={clip} onClip={() => setClip(!clip)} onDrag={(zone, d) => {
          if (isNaN(d)) { commit(ed.s, `${zone} (histogram)`); return; }
          const cur = (ed.s as any)[zone] as number;
          const nv = zone === 'exposure' ? Math.max(-5, Math.min(5, cur + d * 4)) : Math.max(-100, Math.min(100, cur + d * 200));
          const ns = { ...ed.s, [zone]: zone === 'exposure' ? Math.round(nv * 100) / 100 : Math.round(nv) };
          ed.s = ns; setLive(ns);
        }} />
        <div className="exif-line">{[ex.iso && `ISO ${ex.iso}`, ex.focal && `${Math.round(ex.focal)} mm`, ex.fnumber && `f/${ex.fnumber}`, fmtExposure(ex.exposure)].filter(Boolean).join('   ') || photoTitle(photo)}</div>
        <div className="toolstrip">
          <button className={tool === 'crop' ? 'on' : ''} onClick={() => pickTool('crop')} title="Crop & straighten (R)"><Crop size={17} /></button>
          <button className={tool === 'spot' ? 'on' : ''} onClick={() => pickTool('spot')} title="Healing / spot removal (Q)"><Bandage size={17} /></button>
          <button className={tool === 'redeye' ? 'on' : ''} onClick={() => pickTool('redeye')} title="Red eye correction"><Eye size={17} /></button>
          <button className={tool === 'mask' ? 'on' : ''} onClick={() => pickTool('mask')} title="Masking (K brush, M linear, Shift+M radial)"><Layers size={17} />{base.masks.length > 0 && <span className="badge">{base.masks.length}</span>}</button>
        </div>
        <div className="panels">
          {tool === 'crop' && <CropPanel ed={ed} W={photo.w} H={photo.h} onLevel={doLevel} />}
          {(tool === 'spot' || tool === 'redeye') && <SpotPanel ed={ed} opts={spot} setOpts={setSpot} sel={selSpot} setSel={setSelSpot} redeye={tool === 'redeye'} />}
          {tool === 'mask' && <MaskPanel ed={ed} active={activeMask} setActive={setActiveMask} draw={draw} setDraw={setDraw} drawMode={drawMode} setDrawMode={setDrawMode}
            brush={brush} setBrush={setBrush} overlay={overlay} setOverlay={setOverlay} sample={() => null} />}
          {tool !== 'mask' && <>
            <BasicPanel ed={ed} onAuto={doAuto} onAutoWB={doAutoWB} wbPick={tool === 'wb'} setWbPick={(b) => { setPrevTool(tool); setTool(b ? 'wb' : 'none'); }} />
            <CurvePanel ed={ed} histo={histo} />
            <MixerPanel ed={ed} />
            <GradePanel ed={ed} />
            <DetailPanel ed={ed} />
            <LensPanel ed={ed} onAutoCA={doAutoCA} hasFocal={!!ex.focal35} />
            <TransformPanel ed={ed} onUpright={(m) => { if (m === 'off') commit({ ...base, transform: defaultSettings().transform, crop: { ...base.crop, angle: 0 } }, 'Upright off'); else doLevel(); }} />
            <EffectsPanel ed={ed} />
            <CalibrationPanel ed={ed} />
          </>}
        </div>
        <div className="panel-foot">
          <button className="btn" title="Apply the previous photo’s settings" onClick={() => {
            const vis = store.visible(); const i = vis.findIndex((x) => x.id === photo.id);
            const prev = vis[i - 1]; if (prev) commit(clone(prev.settings), 'Previous settings'); else store.toast('No previous photo');
          }}>Previous</button>
          <button className="btn" onClick={() => commit(defaultSettings(), 'Reset')}><RotateCcw size={14} /> Reset</button>
          {selected.length > 1 && <button className="btn primary" onClick={() => onSync()}>Sync…</button>}
        </div>
      </aside>

      {savePreset && <SavePresetDialog s={base} onClose={() => setSavePreset(false)} />}
    </div>
  );
}

export function SavePresetDialog({ s, onClose }: { s: Settings; onClose: () => void }) {
  const [name, setName] = useState('My preset');
  const [group, setGroup] = useState('User Presets');
  const all = Object.keys(GROUPS);
  const [groups, setGroups] = useState<string[]>(all.filter((g) => !['Crop', 'Masking', 'Spot removal', 'Transform'].includes(g)));
  return (
    <Modal title="New Develop Preset" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={() => { store.savePreset({ id: uid(), name, group, part: pick(s, groups) }); store.toast(`Preset “${name}” saved`); onClose(); }}>Create</button>
    </>}>
      <label className="field">Preset name<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
      <label className="field">Group<input value={group} onChange={(e) => setGroup(e.target.value)} /></label>
      <GroupChecks groups={groups} setGroups={setGroups} />
    </Modal>
  );
}

export function GroupChecks({ groups, setGroups }: { groups: string[]; setGroups: (g: string[]) => void }) {
  const all = Object.keys(GROUPS);
  return (
    <div className="group-checks">
      <div className="row small"><button className="btn small" onClick={() => setGroups(all)}>Check all</button><button className="btn small" onClick={() => setGroups([])}>Check none</button></div>
      <div className="checks-grid">
        {all.map((g) => <label key={g} className="check"><input type="checkbox" checked={groups.includes(g)} onChange={(e) => setGroups(e.target.checked ? [...groups, g] : groups.filter((x) => x !== g))} /> {g}</label>)}
      </div>
    </div>
  );
}

export function SyncDialog({ mode, onClose }: { mode: 'copy' | 'sync'; onClose: () => void }) {
  const photo = store.s.active ? store.s.photos.get(store.s.active) : undefined;
  const [groups, setGroups] = useState<string[]>(Object.keys(GROUPS).filter((g) => !['Crop', 'Masking', 'Spot removal'].includes(g)));
  if (!photo) return null;
  const targets = store.s.selected.filter((id) => id !== photo.id);
  return (
    <Modal title={mode === 'copy' ? 'Copy Settings' : `Synchronize Settings to ${targets.length} photo${targets.length === 1 ? '' : 's'}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={() => {
        const part = pick(photo.settings, groups);
        if (mode === 'copy') { store.set({ clipboard: part }); store.toast('Settings copied'); }
        else {
          store.applyToMany(targets, (s) => apply(s, part), 'Synchronize settings');
          for (const id of targets) { const p = store.s.photos.get(id); if (p) refreshThumb(p); }
          store.toast(`Synchronized ${targets.length} photo${targets.length === 1 ? '' : 's'}`);
        }
        onClose();
      }}>{mode === 'copy' ? 'Copy' : 'Synchronize'}</button>
    </>}>
      <p className="hint">From “{photoTitle(photo)}”. Choose which settings to include.</p>
      <GroupChecks groups={groups} setGroups={setGroups} />
    </Modal>
  );
}
