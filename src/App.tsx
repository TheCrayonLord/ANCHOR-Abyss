import React, { useEffect, useRef, useState } from 'react';
import { Download, Upload, Settings as Cog, HelpCircle, Merge, Copy, Layers3, FolderOpen, PanelLeft, SlidersHorizontal, X } from 'lucide-react';
import { store, useStore, photoTitle } from './catalog/store';
import Library from './ui/Library';
import Develop, { SyncDialog } from './ui/Develop';
import { MapModule, SlideshowModule, PrintModule, BookModule, WebModule } from './ui/Outputs';
import { ImportDialog, ExportDialog, MergeDialog, PrefsDialog, HelpDialog } from './ui/Dialogs';
import { Thumb, Stars, FlagMark, LabelDot, usePhone } from './ui/common';
import { ACCEPT, isSupported } from './engine/decode';
import { apply } from './engine/settings';
import { refreshThumb } from './engine/export';

const MODULES = [['library', 'Library'], ['develop', 'Develop'], ['map', 'Map'], ['book', 'Book'], ['slideshow', 'Slideshow'], ['print', 'Print'], ['web', 'Web']] as const;
const LABEL_KEYS: Record<string, any> = { '6': 'red', '7': 'yellow', '8': 'green', '9': 'blue' };

const PHONE_TABS: Record<string, ['left' | 'right', string][]> = {
  library: [['left', 'Catalog'], ['right', 'Info & quick edit']],
  develop: [['left', 'Presets & history'], ['right', 'Adjust']],
  map: [['left', 'Places']],
  slideshow: [['left', 'Slides'], ['right', 'Playback']],
  print: [['left', 'Layout'], ['right', 'Page & image']],
  book: [['left', 'Book'], ['right', 'Export']],
  web: [['left', 'Gallery'], ['right', 'Appearance']],
};

export default function App() {
  const st = useStore((s) => s);
  const [importFiles, setImportFiles] = useState<File[] | null>(null);
  const [exporting, setExporting] = useState(false);
  const [sync, setSync] = useState<'copy' | 'sync' | null>(null);
  const [merge, setMerge] = useState<'hdr' | 'pano' | null>(null);
  const [prefs, setPrefs] = useState(false);
  const [help, setHelp] = useState(false);
  const [lights, setLights] = useState(0);
  const [panels, setPanels] = useState(true);
  const [drag, setDrag] = useState(false);
  const [menu, setMenu] = useState(false);
  const phone = usePhone();
  // On phones the side panels open one at a time as a sheet under the photo.
  const [sheet, setSheet] = useState<'none' | 'left' | 'right'>('none');
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);

  useEffect(() => { store.load(); }, []);

  const selPhotos = () => (st.selected.length ? st.selected : st.active ? [st.active] : []).map((id) => store.s.photos.get(id)!).filter(Boolean);

  // global shortcuts
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,select,[contenteditable],.slider-track') || document.querySelector('.modal-back')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;
      const s = store.s;
      const sel = s.selected.length ? s.selected : s.active ? [s.active] : [];
      if (mod && e.altKey && /^[1-7]$/.test(key)) { store.set({ module: MODULES[+key - 1][0] }); e.preventDefault(); return; }
      if (mod && e.shiftKey) {
        const kk = key.toLowerCase();
        if (kk === 'i') { e.preventDefault(); fileInput.current?.click(); }
        else if (kk === 'e') { e.preventDefault(); setExporting(true); }
        else if (kk === 'c') { e.preventDefault(); setSync('copy'); }
        else if (kk === 'v') { e.preventDefault(); if (s.clipboard) { store.applyToMany(sel, (x) => apply(x, s.clipboard!), 'Paste settings'); sel.forEach((id) => refreshThumb(store.s.photos.get(id)!)); } }
        else if (kk === 's') { e.preventDefault(); setSync('sync'); }
        else if (kk === 'h') { e.preventDefault(); setMerge('hdr'); }
        else if (kk === 'm') { e.preventDefault(); setMerge('pano'); }
        else if (kk === 'g') { e.preventDefault(); store.unstack(sel); }
        return;
      }
      if (mod) {
        if (key === "'") { e.preventDefault(); if (s.active) store.virtualCopy(s.active); }
        else if (key.toLowerCase() === 'a' && s.module === 'library') { e.preventDefault(); store.set({ selected: store.visible().map((p) => p.id) }); }
        else if (key.toLowerCase() === 'd' && s.module === 'library') { e.preventDefault(); store.set({ selected: s.active ? [s.active] : [] }); }
        else if (key.toLowerCase() === 'g') { e.preventDefault(); store.stack(sel); }
        else if (key === ',') { e.preventDefault(); setPrefs(true); }
        return;
      }
      if (e.altKey) return;
      const vis = store.visible();
      const idx = vis.findIndex((p) => p.id === s.active);
      switch (key) {
        case 'g': case 'G': store.set({ module: 'library', libView: 'grid' }); break;
        case 'e': case 'E': store.set({ module: 'library', libView: 'loupe' }); break;
        case 'c': case 'C': store.set({ module: 'library', libView: 'compare' }); break;
        case 'n': case 'N': store.set({ module: 'library', libView: 'survey' }); break;
        case 'd': case 'D': store.set({ module: 'develop' }); break;
        case 'ArrowRight': case 'ArrowLeft': {
          if (s.module === 'library' && s.libView === 'grid' && (key === 'ArrowRight' || key === 'ArrowLeft')) { /* fallthrough to navigation */ }
          const n = vis[Math.min(vis.length - 1, Math.max(0, idx + (key === 'ArrowRight' ? 1 : -1)))];
          if (n) store.select(n.id, e.shiftKey ? 'range' : 'set', vis.map((p) => p.id));
          break;
        }
        case 'p': case 'P': store.updateMany(sel, () => ({ flag: 1 })); break;
        case 'x': case 'X': if (s.module === 'develop') return; store.updateMany(sel, () => ({ flag: -1 })); break;
        case 'u': case 'U': store.updateMany(sel, () => ({ flag: 0 })); break;
        case '0': case '1': case '2': case '3': case '4': case '5': store.updateMany(sel, () => ({ rating: +key })); break;
        case '6': case '7': case '8': case '9': store.updateMany(sel, (p) => ({ label: p.label === LABEL_KEYS[key] ? '' : LABEL_KEYS[key] })); break;
        case 'b': case 'B': store.toggleQuick(sel); break;
        case 'l': case 'L': setLights((v) => (v + 1) % 3); break;
        case 'f': case 'F': if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => { /* ignore */ }); break;
        case 'Tab': setPanels((v) => !v); break;
        case '?': setHelp(true); break;
        case 'Delete': case 'Backspace':
          if (s.module === 'library' && sel.length && confirm(`Remove ${sel.length} photo${sel.length === 1 ? '' : 's'} from the catalog? The stored original is deleted from this browser.`)) store.remove(sel);
          break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  // drag & drop import, including folders
  const collect = async (items: DataTransferItemList): Promise<File[]> => {
    const out: File[] = [];
    const walk = async (entry: any, path: string): Promise<void> => {
      if (entry.isFile) { const f: File = await new Promise((r, j) => entry.file(r, j)); try { Object.defineProperty(f, 'webkitRelativePath', { value: path + f.name }); } catch { /* ignore */ } out.push(f); }
      else if (entry.isDirectory) {
        const rd = entry.createReader();
        let batch: any[];
        do { batch = await new Promise((r) => rd.readEntries(r)); for (const e of batch) await walk(e, path + entry.name + '/'); } while (batch.length);
      }
    };
    const entries = Array.from(items).map((i) => (i as any).webkitGetAsEntry?.()).filter(Boolean);
    for (const en of entries) await walk(en, '');
    return out;
  };

  useEffect(() => { setSheet(st.module === 'develop' ? 'right' : 'none'); }, [st.module]);

  const startImport = (files: File[]) => {
    const ok = files.filter((f) => isSupported(f.name));
    if (!ok.length) { store.toast('No supported photos in that selection'); return; }
    setImportFiles(ok);
  };

  if (!st.ready) return <div className="boot"><img className="logo-big" src="icon.svg" alt="" /><p>Opening catalog…</p></div>;

  const filmPhotos = store.visible();
  const tabs = PHONE_TABS[st.module] || [];
  const showFilm = !st.prefs.hideFilmstrip && st.module !== 'map';

  return (
    <div className={`app lights-${lights}${panels ? '' : ' no-panels'}${phone ? ' phone sheet-' + sheet : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={async (e) => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); setDrag(false); startImport(await collect(e.dataTransfer.items)); }}>
      <header className="topbar">
        <div className="brand"><img className="logo" src="icon.svg" alt="" /><span className="brand-name">ANCHOR <b>Abyss</b></span></div>
        <div className="top-actions">
          <button className="btn small" onClick={() => fileInput.current?.click()} title="Import photos (Ctrl+Shift+I)"><Upload size={14} /><span>Import</span></button>
          <button className="btn small" onClick={() => dirInput.current?.click()} title="Import a folder"><FolderOpen size={14} /><span>Folder</span></button>
          <button className="btn small" onClick={() => setExporting(true)} disabled={!st.photos.size} title="Export (Ctrl+Shift+E)"><Download size={14} /><span>Export</span></button>
          <div className={'menu-wrap' + (menu ? ' open' : '')}>
            <button className="btn small" title="Photo menu" onClick={() => setMenu((v) => !v)}><Merge size={14} /><span>Photo</span></button>
            {menu && <div className="menu-catcher" onClick={() => setMenu(false)} />}
            <div className="menu" onClick={() => setMenu(false)}>
              <button onClick={() => setMerge('hdr')}>Photo Merge › HDR… <kbd>Ctrl+Shift+H</kbd></button>
              <button onClick={() => setMerge('pano')}>Photo Merge › Panorama… <kbd>Ctrl+Shift+M</kbd></button>
              <button onClick={() => st.active && store.virtualCopy(st.active)}>Create virtual copy <kbd>Ctrl+'</kbd></button>
              <button onClick={() => setSync('copy')}><Copy size={12} /> Copy settings… <kbd>Ctrl+Shift+C</kbd></button>
              <button disabled={st.selected.length < 2} onClick={() => setSync('sync')}>Sync settings… <kbd>Ctrl+Shift+S</kbd></button>
              <button disabled={st.selected.length < 2} onClick={() => store.stack(st.selected)}><Layers3 size={12} /> Group into stack <kbd>Ctrl+G</kbd></button>
              <button onClick={() => store.unstack(st.selected)}>Unstack</button>
              <button onClick={() => { const r = selPhotos().filter((p) => p.flag === -1); if (r.length && confirm(`Remove ${r.length} rejected photo(s) from the catalog?`)) store.remove(r.map((p) => p.id)); }}>Remove rejected photos…</button>
              <button onClick={() => { const all = [...store.s.photos.values()].filter((p) => p.flag === -1); if (all.length && confirm(`Remove all ${all.length} rejected photos from the catalog?`)) store.remove(all.map((p) => p.id)); }}>Remove all rejected…</button>
            </div>
          </div>
          <button className="icon" title="Preferences" onClick={() => setPrefs(true)}><Cog size={16} /></button>
          <button className="icon" title="Keyboard shortcuts (?)" onClick={() => setHelp(true)}><HelpCircle size={16} /></button>
        </div>
        <nav className="modules">
          {MODULES.map(([id, label], i) => (
            <button key={id} className={st.module === id ? 'on' : ''} onClick={() => store.set({ module: id })} title={`${label} (Ctrl+Alt+${i + 1})`}>{label}</button>
          ))}
        </nav>
      </header>

      <div className="body">
        {st.module === 'library' && <Library />}
        {st.module === 'develop' && <Develop onSync={() => setSync(st.selected.length > 1 ? 'sync' : 'copy')} />}
        {st.module === 'map' && <MapModule />}
        {st.module === 'slideshow' && <SlideshowModule />}
        {st.module === 'print' && <PrintModule />}
        {st.module === 'book' && <BookModule />}
        {st.module === 'web' && <WebModule />}
      </div>

      {phone && tabs.length > 0 && <nav className="phone-tabs">
        {tabs.map(([side, label]) => (
          <button key={side} data-p={side} className={sheet === side ? 'on' : ''} onClick={() => setSheet(sheet === side ? 'none' : side)}>
            {sheet === side ? <X size={15} /> : side === 'left' ? <PanelLeft size={15} /> : <SlidersHorizontal size={15} />}<span>{label}</span>
          </button>
        ))}
      </nav>}

      {showFilm && <div className="filmstrip">
        <div className="film-info">{st.active && st.photos.get(st.active) ? photoTitle(st.photos.get(st.active)!) : ''} <span className="hint">{filmPhotos.length} photos</span></div>
        <div className="film-row">
          {filmPhotos.map((p) => (
            <div key={p.id} className={'film-cell' + (st.selected.includes(p.id) ? ' sel' : '') + (st.active === p.id ? ' active' : '')} draggable
              onDragStart={(e) => e.dataTransfer.setData('text/abyss-ids', JSON.stringify(st.selected.includes(p.id) ? st.selected : [p.id]))}
              onClick={(e) => store.select(p.id, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'set', filmPhotos.map((x) => x.id))}
              onDoubleClick={() => store.set({ module: 'develop' })} title={photoTitle(p)}>
              <Thumb p={p} />
              <div className="film-marks"><FlagMark flag={p.flag} size={10} />{p.rating > 0 && <span className="film-rating">{'★'.repeat(p.rating)}</span>}<LabelDot label={p.label} /></div>
            </div>
          ))}
        </div>
      </div>}

      <input id="import-input" ref={fileInput} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { startImport(Array.from(e.target.files || [])); e.target.value = ''; }} />
      <input ref={dirInput} type="file" multiple hidden {...({ webkitdirectory: '', directory: '' } as any)} onChange={(e) => { startImport(Array.from(e.target.files || [])); e.target.value = ''; }} />

      {importFiles && <ImportDialog files={importFiles} onClose={() => setImportFiles(null)} />}
      {exporting && <ExportDialog photos={selPhotos().length ? selPhotos() : store.visible()} onClose={() => setExporting(false)} />}
      {sync && <SyncDialog mode={sync} onClose={() => setSync(null)} />}
      {merge && <MergeDialog kind={merge} photos={selPhotos()} onClose={() => setMerge(null)} />}
      {prefs && <PrefsDialog onClose={() => setPrefs(false)} />}
      {help && <HelpDialog onClose={() => setHelp(false)} />}
      {drag && <div className="drop-zone">Drop photos or folders to import</div>}
      {st.busy && <div className="busy"><div className="spinner" />{st.busy.label} {st.busy.done} / {st.busy.total}<div className="bar"><div style={{ width: `${(st.busy.done / Math.max(1, st.busy.total)) * 100}%` }} /></div></div>}
      {st.toast && <div className="toast">{st.toast}</div>}
    </div>
  );
}
