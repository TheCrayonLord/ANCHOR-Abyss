import React, { useState } from 'react';
import { Modal, Slider, Seg, fmtBytes, Thumb } from './common';
import { store, useStore, photoTitle, type Photo } from '../catalog/store';
import { defaultExport, exportMany, targetSize, type ExportOpts } from '../engine/export';
import { BUILTIN_PRESETS } from '../engine/presets';
import { uid } from '../engine/settings';
import { ACCEPT } from '../engine/decode';
import { loadDecoded } from '../engine/pipeline';
import { mergeHDR, mergePanorama } from '../engine/merge';
import { srcToCanvas } from '../engine/decode';
import * as db from '../catalog/db';

export function ImportDialog({ files, onClose }: { files: File[]; onClose: () => void }) {
  const presets = useStore((s) => s.presets);
  const [kw, setKw] = useState('');
  const [preset, setPreset] = useState('');
  const [folder, setFolder] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set(files.map((_, i) => i)));
  const all = [...BUILTIN_PRESETS.map((p) => ({ ...p, builtin: true })), ...presets];
  const size = files.filter((_, i) => picked.has(i)).reduce((a, f) => a + f.size, 0);
  return (
    <Modal title={`Import ${files.length} file${files.length === 1 ? '' : 's'}`} wide onClose={onClose} footer={<>
      <span className="hint grow">{picked.size} selected · {fmtBytes(size)} will be copied into the catalog on this device</span>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!picked.size} onClick={() => {
        const list = files.filter((_, i) => picked.has(i));
        onClose();
        store.importFiles(list, { keywords: kw.split(',').map((k) => k.trim()).filter(Boolean), preset: all.find((p) => p.id === preset) || null, folder: folder.trim() || undefined });
      }}>Import</button>
    </>}>
      <div className="import-grid">
        {files.slice(0, 400).map((f, i) => (
          <label key={i} className={'import-cell' + (picked.has(i) ? ' on' : '')}>
            <input type="checkbox" checked={picked.has(i)} onChange={(e) => { const n = new Set(picked); e.target.checked ? n.add(i) : n.delete(i); setPicked(n); }} />
            <span>{f.name}</span><small>{fmtBytes(f.size)}</small>
          </label>
        ))}
      </div>
      <div className="row small"><button className="btn small" onClick={() => setPicked(new Set(files.map((_, i) => i)))}>Check all</button><button className="btn small" onClick={() => setPicked(new Set())}>Uncheck all</button></div>
      <div className="form-cols">
        <label className="field">Apply during import: develop preset
          <select value={preset} onChange={(e) => setPreset(e.target.value)}><option value="">None</option>{all.map((p) => <option key={p.id} value={p.id}>{p.group}: {p.name}</option>)}</select>
        </label>
        <label className="field">Keywords<input placeholder="e.g. travel, iceland" value={kw} onChange={(e) => setKw(e.target.value)} /></label>
        <label className="field">Folder name<input placeholder="(from the files’ folder, or today’s date)" value={folder} onChange={(e) => setFolder(e.target.value)} /></label>
      </div>
    </Modal>
  );
}

export function ExportDialog({ photos, onClose }: { photos: Photo[]; onClose: () => void }) {
  const eps = useStore((s) => s.exportPresets);
  const [o, setO] = useState<ExportOpts>(() => ({ ...defaultExport(), ...(store.s.prefs.lastExport || {}) }));
  const [busy, setBusy] = useState<string | null>(null);
  const set = (p: Partial<ExportOpts>) => setO({ ...o, ...p });
  const first = photos[0];
  const [tw, th] = first ? targetSize(first.w || 4000, first.h || 3000, o) : [0, 0];
  const canFolder = 'showDirectoryPicker' in window;
  const run = async () => {
    store.savePrefs({ lastExport: o });
    setBusy('Starting…');
    try {
      const n = await exportMany(photos, o, (d, t) => setBusy(`Exporting ${d} of ${t}…`));
      store.toast(`Exported ${n} file${n === 1 ? '' : 's'}`);
      onClose();
    } catch (e: any) {
      if (e?.name !== 'AbortError') alert('Export failed: ' + (e?.message || e));
      setBusy(null);
    }
  };
  return (
    <Modal title={`Export ${photos.length} photo${photos.length === 1 ? '' : 's'}`} wide onClose={onClose} footer={<>
      <select value="" onChange={(e) => { const p = eps.find((x) => x.id === e.target.value); if (p) setO({ ...defaultExport(), ...p.opts }); }}>
        <option value="">Export presets…</option>{eps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button className="btn small" onClick={() => { const name = prompt('Export preset name'); if (name) store.saveExportPreset({ id: uid(), name, opts: o }); }}>Save preset</button>
      <span className="grow" />
      <button className="btn" onClick={onClose} disabled={!!busy}>Cancel</button>
      <button className="btn primary" onClick={run} disabled={!!busy || !photos.length}>{busy || 'Export'}</button>
    </>}>
      <div className="form-cols">
        <fieldset>
          <legend>File settings</legend>
          <label className="field">Format
            <select value={o.format} onChange={(e) => set({ format: e.target.value as any })}>
              <option value="jpeg">JPEG</option><option value="png">PNG</option><option value="webp">WebP</option><option value="avif">AVIF (if supported)</option><option value="tiff">TIFF (8-bit)</option><option value="original">Original file</option>
            </select>
          </label>
          {['jpeg', 'webp', 'avif'].includes(o.format) && <Slider label="Quality" value={o.quality} min={1} max={100} def={90} onChange={(v) => set({ quality: v })} />}
          {['jpeg', 'webp'].includes(o.format) && <label className="field">Limit file size to (KB, 0 = no limit)<input type="number" min={0} value={o.limitKB} onChange={(e) => set({ limitKB: +e.target.value })} /></label>}
          <p className="hint">Colour space: sRGB.</p>
        </fieldset>
        <fieldset disabled={o.format === 'original'}>
          <legend>Image sizing</legend>
          <select value={o.resize} onChange={(e) => set({ resize: e.target.value as any })}>
            <option value="none">Full size</option><option value="long">Long edge</option><option value="short">Short edge</option><option value="wh">Fit within width × height</option><option value="mp">Megapixels</option><option value="percent">Percentage</option>
          </select>
          {o.resize === 'long' && <label className="field">Long edge (px)<input type="number" value={o.long} onChange={(e) => set({ long: +e.target.value })} /></label>}
          {o.resize === 'short' && <label className="field">Short edge (px)<input type="number" value={o.short} onChange={(e) => set({ short: +e.target.value })} /></label>}
          {o.resize === 'wh' && <div className="row"><input type="number" value={o.width} onChange={(e) => set({ width: +e.target.value })} /> × <input type="number" value={o.height} onChange={(e) => set({ height: +e.target.value })} /></div>}
          {o.resize === 'mp' && <label className="field">Megapixels<input type="number" step={0.5} value={o.mp} onChange={(e) => set({ mp: +e.target.value })} /></label>}
          {o.resize === 'percent' && <Slider label="Percent" value={o.percent} min={5} max={100} def={50} onChange={(v) => set({ percent: v })} />}
          <label className="check"><input type="checkbox" checked={o.noEnlarge} onChange={(e) => set({ noEnlarge: e.target.checked })} /> Don’t enlarge</label>
          {first && <p className="hint">First photo: about {tw} × {th} px</p>}
        </fieldset>
        <fieldset disabled={o.format === 'original'}>
          <legend>Output sharpening</legend>
          <select value={o.sharpen} onChange={(e) => set({ sharpen: e.target.value as any })}><option value="none">None</option><option value="screen">For screen</option><option value="matte">For matte paper</option><option value="glossy">For glossy paper</option></select>
          {o.sharpen !== 'none' && <Seg value={o.sharpenAmount} options={[['low', 'Low'], ['standard', 'Standard'], ['high', 'High']]} onChange={(v) => set({ sharpenAmount: v })} />}
        </fieldset>
        <fieldset>
          <legend>Metadata</legend>
          <select value={o.metadata} onChange={(e) => set({ metadata: e.target.value as any })}>
            <option value="all">All (camera, keywords, title, location)</option><option value="allButLocation">All except location</option><option value="copyright">Copyright and creator only</option><option value="none">None</option>
          </select>
          <label className="check"><input type="checkbox" checked={o.sidecar} onChange={(e) => set({ sidecar: e.target.checked })} /> Also write .xmp sidecar with develop settings</label>
        </fieldset>
        <fieldset disabled={o.format === 'original'}>
          <legend>Watermark</legend>
          <label className="check"><input type="checkbox" checked={o.watermark.on} onChange={(e) => set({ watermark: { ...o.watermark, on: e.target.checked } })} /> Add text watermark</label>
          {o.watermark.on && <>
            <input value={o.watermark.text} onChange={(e) => set({ watermark: { ...o.watermark, text: e.target.value } })} />
            <Slider label="Size (% of short edge)" value={o.watermark.size} min={1} max={20} step={0.5} def={4} onChange={(v) => set({ watermark: { ...o.watermark, size: v } })} />
            <Slider label="Opacity" value={o.watermark.opacity} min={5} max={100} def={60} onChange={(v) => set({ watermark: { ...o.watermark, opacity: v } })} />
            <div className="row"><select value={o.watermark.pos} onChange={(e) => set({ watermark: { ...o.watermark, pos: e.target.value } })}>
              {[['tl', 'Top left'], ['t', 'Top'], ['tr', 'Top right'], ['c', 'Centre'], ['bl', 'Bottom left'], ['b', 'Bottom'], ['br', 'Bottom right']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select><input type="color" value={o.watermark.color} onChange={(e) => set({ watermark: { ...o.watermark, color: e.target.value } })} /></div>
          </>}
        </fieldset>
        <fieldset>
          <legend>File naming & location</legend>
          <label className="field">Name template<input value={o.naming} onChange={(e) => set({ naming: e.target.value })} /></label>
          <p className="hint">Tokens: {'{name} {seq} {date} {time} {title} {rating} {copy}'}</p>
          <label className="field">Start number<input type="number" value={o.start} onChange={(e) => set({ start: +e.target.value })} /></label>
          <select value={o.dest} onChange={(e) => set({ dest: e.target.value as any })}>
            <option value="download">Download (zip if more than 3 files)</option><option value="zip">Always one zip file</option>{canFolder && <option value="folder">Choose a folder…</option>}
          </select>
        </fieldset>
      </div>
    </Modal>
  );
}

export function MergeDialog({ kind, photos, onClose }: { kind: 'hdr' | 'pano'; photos: Photo[]; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [cyl, setCyl] = useState(true);
  const [size, setSize] = useState(kind === 'hdr' ? 3600 : 2400);
  const run = async () => {
    try {
      setBusy('Decoding photos…');
      const srcs = [];
      for (const p of photos) srcs.push((await loadDecoded(p.originalId, () => store.original(p), p.name)).full);
      setBusy(kind === 'hdr' ? 'Aligning and blending exposures…' : 'Finding overlaps and stitching…');
      await new Promise((r) => setTimeout(r, 30));
      const out = kind === 'hdr' ? mergeHDR(srcs, size) : mergePanorama(srcs, size, cyl, photos[0].exif.focal35 || 28);
      setBusy('Saving…');
      const c = srcToCanvas(out);
      const blob = await c.convertToBlob({ type: 'image/png' });
      const name = photos[0].name.replace(/\.[^.]+$/, '') + (kind === 'hdr' ? '-HDR.png' : '-Pano.png');
      await store.addGenerated(blob, name, out.w, out.h, photos[0]);
      store.toast(kind === 'hdr' ? 'HDR photo created' : 'Panorama created');
      onClose();
    } catch (e: any) { alert(e.message || String(e)); setBusy(null); }
  };
  return (
    <Modal title={kind === 'hdr' ? 'Photo Merge: HDR' : 'Photo Merge: Panorama'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose} disabled={!!busy}>Cancel</button>
      <button className="btn primary" onClick={run} disabled={!!busy || photos.length < 2}>{busy || 'Merge'}</button>
    </>}>
      <div className="mini-strip">{photos.map((p) => <Thumb key={p.id} p={p} />)}</div>
      {photos.length < 2 && <p className="error-text">Select at least two photos first.</p>}
      {kind === 'hdr' ? <p className="hint">Blends bracketed exposures of the same scene (exposure fusion), with automatic alignment for small hand-held shifts. The result is added to the catalog as a new photo you can develop.</p>
        : <><p className="hint">Stitches overlapping photos taken left to right in the order they are selected or sorted. Works best for a single row shot from one spot.</p>
          <label className="check"><input type="checkbox" checked={cyl} onChange={(e) => setCyl(e.target.checked)} /> Cylindrical projection</label></>}
      <Slider label={kind === 'hdr' ? 'Maximum long edge (px)' : 'Output height (px)'} value={size} min={1000} max={8000} step={100} def={kind === 'hdr' ? 3600 : 2400} onChange={setSize} />
    </Modal>
  );
}

export function PrefsDialog({ onClose }: { onClose: () => void }) {
  const prefs = useStore((s) => s.prefs);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  React.useEffect(() => { db.estimate().then(setUsage); }, []);
  const backup = async () => {
    const JSZip = (await import('jszip')).default;
    const z = new JSZip();
    const photos = [...store.s.photos.values()];
    z.file('catalog.json', JSON.stringify({ version: 1, photos, collections: store.s.collections, presets: store.s.presets, exportPresets: store.s.exportPresets, quick: store.s.quick }));
    for (const id of new Set(photos.map((p) => p.originalId))) { const b = await db.get<Blob>('originals', id); if (b) z.file('originals/' + id, b); }
    const blob = await z.generateAsync({ type: 'blob', compression: 'STORE' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ANCHOR Abyss catalog ${new Date().toISOString().slice(0, 10)}.zip`; a.click();
  };
  const restore = async (f: File) => {
    const JSZip = (await import('jszip')).default;
    const z = await JSZip.loadAsync(f);
    const j = JSON.parse(await z.file('catalog.json')!.async('string'));
    for (const p of j.photos) {
      const ob = z.file('originals/' + p.originalId);
      if (ob && !(await db.get('originals', p.originalId))) await db.put('originals', p.originalId, new Blob([await ob.async('arraybuffer')]));
      await db.put('photos', p.id, p);
    }
    for (const c of j.collections || []) await db.put('collections', c.id, c);
    for (const c of j.presets || []) await db.put('presets', c.id, c);
    for (const c of j.exportPresets || []) await db.put('exportPresets', c.id, c);
    location.reload();
  };
  return (
    <Modal title="Preferences & Catalog" onClose={onClose}>
      <fieldset><legend>Import</legend>
        <label className="check"><input type="checkbox" checked={!!prefs.allowDupes} onChange={(e) => store.savePrefs({ allowDupes: e.target.checked })} /> Allow importing suspected duplicates</label>
      </fieldset>
      <fieldset><legend>Interface</legend>
        <label className="check"><input type="checkbox" checked={!!prefs.expandStacks} onChange={(e) => store.savePrefs({ expandStacks: e.target.checked })} /> Expand all stacks</label>
        <label className="check"><input type="checkbox" checked={!!prefs.hideFilmstrip} onChange={(e) => store.savePrefs({ hideFilmstrip: e.target.checked })} /> Hide filmstrip</label>
      </fieldset>
      <fieldset><legend>Catalog</legend>
        <p className="hint">{store.s.photos.size} photos. {usage && `Using ${fmtBytes(usage.usage)} of about ${fmtBytes(usage.quota)} available to this app in the browser.`} Originals are stored on this device only.</p>
        <div className="row small wrap">
          <button className="btn small" onClick={backup}>Back up catalog (zip)</button>
          <label className="btn small">Restore from backup<input type="file" accept=".zip" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} /></label>
          <button className="btn small danger" onClick={() => { if (confirm('Delete the whole catalog, including all imported originals stored in this browser? This cannot be undone.')) store.resetCatalog(); }}>Delete catalog…</button>
        </div>
      </fieldset>
    </Modal>
  );
}

export const SHORTCUTS: [string, string][] = [
  ['G', 'Library grid'], ['E', 'Library loupe'], ['C', 'Compare'], ['N', 'Survey'], ['D', 'Develop'], ['Ctrl+Alt+1…7', 'Switch module'],
  ['← →', 'Previous / next photo'], ['P / X / U', 'Pick / reject / unflag'], ['0–5', 'Star rating'], ['6–9', 'Red / yellow / green / blue label'],
  ['B', 'Add to Quick Collection'], ["Ctrl+'", 'Virtual copy'], ['Ctrl+G / Ctrl+Shift+G', 'Stack / unstack'],
  ['Ctrl+Shift+I', 'Import'], ['Ctrl+Shift+E', 'Export'], ['Ctrl+Shift+C / V', 'Copy / paste settings'], ['Ctrl+Shift+S', 'Sync settings'],
  ['Ctrl+Shift+H', 'HDR merge'], ['Ctrl+Shift+M', 'Panorama merge'], ['Ctrl+A', 'Select all'],
  ['R', 'Crop'], ['Q', 'Healing'], ['W', 'White balance picker'], ['K', 'Brush mask'], ['M / Shift+M', 'Linear / radial mask'], ['O', 'Mask overlay'],
  ['J', 'Clipping warnings'], ['Y', 'Before / after'], ['\\ (hold)', 'Show original'], ['Z', 'Zoom fit / 100%'], ['Space + drag', 'Pan'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'], ['[ ]', 'Brush / spot size'], ['L', 'Lights out'], ['F', 'Full screen'], ['Tab', 'Hide side panels'], ['?', 'This list'],
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" wide onClose={onClose}>
      <div className="shortcuts">{SHORTCUTS.map(([k, d]) => <div key={k}><kbd>{k}</kbd><span>{d}</span></div>)}</div>
      <p className="hint">ANCHOR Abyss works offline once loaded, and keeps every photo and edit in this browser on this device.</p>
    </Modal>
  );
}

export { ACCEPT, photoTitle };
