import { useSyncExternalStore } from 'react';
import * as db from './db';
import { defaultSettings, normalize, clone, isEdited, uid, describeChange, type Settings } from '../engine/settings';
import { readExif, quickThumb, isSupported, ext, isRaw, type Exif } from '../engine/decode';

export type Flag = -1 | 0 | 1;
export const LABELS = ['', 'red', 'yellow', 'green', 'blue', 'purple'] as const;
export type Label = (typeof LABELS)[number];

export interface HistoryEntry { label: string; s: Settings; t: number }
export interface Snapshot { id: string; name: string; s: Settings; t: number }

export interface Photo {
  id: string; originalId: string; name: string; ext: string; size: number; mime: string; raw: boolean;
  folder: string; importedAt: number; captureTime: number; w: number; h: number;
  exif: Exif;
  rating: number; flag: Flag; label: Label; keywords: string[];
  title: string; caption: string; creator: string; copyright: string; location: string;
  lat?: number; lon?: number;
  settings: Settings; history: HistoryEntry[]; hIndex: number; snapshots: Snapshot[];
  virtual: boolean; copyName: string; edited: boolean; thumbV: number;
  stack?: string; stackTop?: boolean;
}

export interface Rule { field: string; op: string; value: string }
export interface Collection { id: string; name: string; kind: 'manual' | 'smart' | 'set'; parent?: string; ids: string[]; match: 'all' | 'any'; rules: Rule[]; created: number }
export interface Preset { id: string; name: string; group: string; part: Partial<Settings>; builtin?: boolean }
export interface ExportPreset { id: string; name: string; opts: any }

export interface Filter { text: string; minRating: number; ratingOp: '>=' | '=' | '<='; flag: 'all' | 'picked' | 'rejected' | 'unflagged' | 'notRejected'; label: string; camera: string; lens: string; fileType: string; edited: 'all' | 'edited' | 'unedited'; keyword: string }

export const emptyFilter = (): Filter => ({ text: '', minRating: 0, ratingOp: '>=', flag: 'all', label: '', camera: '', lens: '', fileType: '', edited: 'all', keyword: '' });

export type Source = { kind: 'all' } | { kind: 'quick' } | { kind: 'recent' } | { kind: 'folder'; name: string } | { kind: 'collection'; id: string } | { kind: 'rejected' } | { kind: 'edited' };

export type SortKey = 'captureTime' | 'importedAt' | 'name' | 'rating' | 'label' | 'edited' | 'ext';

interface State {
  ready: boolean;
  photos: Map<string, Photo>;
  order: string[];
  collections: Collection[];
  presets: Preset[];
  exportPresets: ExportPreset[];
  quick: string[];
  selected: string[];
  active: string | null;
  source: Source;
  filter: Filter;
  sort: SortKey; sortDir: 1 | -1;
  module: 'library' | 'develop' | 'map' | 'book' | 'slideshow' | 'print' | 'web';
  libView: 'grid' | 'loupe' | 'compare' | 'survey';
  busy: { label: string; done: number; total: number } | null;
  toast: string | null;
  clipboard: Partial<Settings> | null;
  prefs: Record<string, any>;
}

class Store {
  s: State = {
    ready: false, photos: new Map(), order: [], collections: [], presets: [], exportPresets: [], quick: [],
    selected: [], active: null, source: { kind: 'all' }, filter: emptyFilter(), sort: 'captureTime', sortDir: 1,
    module: 'library', libView: 'grid', busy: null, toast: null, clipboard: null, prefs: {},
  };
  v = 0;
  subs = new Set<() => void>();
  dirty = new Set<string>();
  timer: any = null;
  thumbUrls = new Map<string, string>();

  subscribe = (f: () => void) => { this.subs.add(f); return () => this.subs.delete(f); };
  emit() { this.v++; for (const f of this.subs) f(); }
  set(p: Partial<State>) { this.s = { ...this.s, ...p }; this.emit(); }

  async load() {
    try { await navigator.storage?.persist?.(); } catch { /* ignore */ }
    const [photos, cols, presets, eps, quick, prefs] = await Promise.all([
      db.all<Photo>('photos'), db.all<Collection>('collections'), db.all<Preset>('presets'), db.all<ExportPreset>('exportPresets'),
      db.get<string[]>('kv', 'quick'), db.get<Record<string, any>>('kv', 'prefs'),
    ]);
    const map = new Map<string, Photo>();
    for (const p of photos) { p.settings = normalize(p.settings); map.set(p.id, p); }
    this.s = { ...this.s, ready: true, photos: map, order: photos.map((p) => p.id), collections: cols, presets, exportPresets: eps, quick: quick || [], prefs: prefs || {} };
    this.emit();
  }

  toast(msg: string) { this.set({ toast: msg }); setTimeout(() => { if (this.s.toast === msg) this.set({ toast: null }); }, 3500); }

  // ---------- persistence ----------
  touch(id: string) {
    this.dirty.add(id);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }
  async flush() {
    const ids = [...this.dirty]; this.dirty.clear();
    const entries: [string, any][] = [];
    for (const id of ids) { const p = this.s.photos.get(id); if (p) entries.push([id, p]); }
    await db.putMany('photos', entries);
  }
  savePrefs(p: Record<string, any>) { this.set({ prefs: { ...this.s.prefs, ...p } }); db.put('kv', 'prefs', this.s.prefs); }

  // ---------- import ----------
  async importFiles(files: File[], opts: { keywords?: string[]; preset?: Preset | null; folder?: string } = {}) {
    const list = files.filter((f) => isSupported(f.name));
    const skipped = files.length - list.length;
    if (!list.length) { this.toast(skipped ? `${skipped} file(s) skipped: not a supported image type` : 'No photos found'); return []; }
    const ids: string[] = [];
    this.set({ busy: { label: 'Importing', done: 0, total: list.length } });
    const known = new Set([...this.s.photos.values()].map((p) => `${p.name}|${p.size}`));
    let dupes = 0;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (known.has(`${f.name}|${f.size}`) && !this.s.prefs.allowDupes) { dupes++; this.set({ busy: { label: 'Importing', done: i + 1, total: list.length } }); continue; }
      try {
        const id = uid();
        const [exif, th] = await Promise.all([readExif(f), quickThumb(f, f.name)]);
        const ct = exif.date ? Date.parse(exif.date) : f.lastModified;
        let settings = defaultSettings();
        if (opts.preset) settings = normalize({ ...settings, ...clone(opts.preset.part) });
        const folder = opts.folder || (f as any).webkitRelativePath?.split('/').slice(0, -1).join('/') || 'Imported ' + new Date().toISOString().slice(0, 10);
        const p: Photo = {
          id, originalId: id, name: f.name, ext: ext(f.name), size: f.size, mime: f.type, raw: isRaw(f.name), folder,
          importedAt: Date.now(), captureTime: isNaN(ct) ? f.lastModified : ct, w: th.w || exif.width || 0, h: th.h || exif.height || 0, exif,
          rating: 0, flag: 0, label: '', keywords: [...(opts.keywords || [])], title: '', caption: exif.description || '', creator: exif.artist || '', copyright: exif.copyright || '', location: '',
          lat: exif.lat, lon: exif.lon,
          settings, history: [{ label: opts.preset ? `Import: ${opts.preset.name}` : 'Import', s: clone(settings), t: Date.now() }], hIndex: 0, snapshots: [],
          virtual: false, copyName: '', edited: isEdited(settings), thumbV: 0,
        };
        await db.put('originals', id, f);
        if (th.thumb) await db.put('thumbs', id, th.thumb);
        await db.put('photos', id, p);
        const photos = new Map(this.s.photos); photos.set(id, p);
        this.s = { ...this.s, photos, order: [...this.s.order, id] };
        ids.push(id);
      } catch (e) {
        console.error('import failed', f.name, e);
      }
      this.set({ busy: { label: 'Importing', done: i + 1, total: list.length } });
    }
    this.set({ busy: null, selected: ids.length ? [ids[0]] : this.s.selected, active: ids[0] || this.s.active, source: ids.length ? { kind: 'recent' } : this.s.source });
    this.toast(`Imported ${ids.length} photo${ids.length === 1 ? '' : 's'}${dupes ? `, ${dupes} duplicate${dupes === 1 ? '' : 's'} skipped` : ''}${skipped ? `, ${skipped} unsupported skipped` : ''}`);
    return ids;
  }

  /** Add a generated image (HDR/panorama) as a new photo. */
  async addGenerated(blob: Blob, name: string, w: number, h: number, base?: Photo) {
    const id = uid();
    const th = await quickThumb(blob, name);
    const settings = defaultSettings();
    const p: Photo = {
      id, originalId: id, name, ext: ext(name), size: blob.size, mime: blob.type, raw: false, folder: base?.folder || 'Merged', importedAt: Date.now(),
      captureTime: base?.captureTime || Date.now(), w, h, exif: base ? { ...base.exif } : {}, rating: 0, flag: 0, label: '', keywords: [...(base?.keywords || [])],
      title: '', caption: '', creator: base?.creator || '', copyright: base?.copyright || '', location: base?.location || '', lat: base?.lat, lon: base?.lon,
      settings, history: [{ label: 'Created', s: clone(settings), t: Date.now() }], hIndex: 0, snapshots: [], virtual: false, copyName: '', edited: false, thumbV: 0,
    };
    await db.put('originals', id, blob);
    if (th.thumb) await db.put('thumbs', id, th.thumb);
    await db.put('photos', id, p);
    const photos = new Map(this.s.photos); photos.set(id, p);
    this.set({ photos, order: [...this.s.order, id], selected: [id], active: id });
    return id;
  }

  async original(p: Photo): Promise<Blob | undefined> { return db.get<Blob>('originals', p.originalId); }

  async thumbUrl(p: Photo): Promise<string | null> {
    const key = `${p.id}:${p.thumbV}`;
    const c = this.thumbUrls.get(key);
    if (c) return c;
    const b = await db.get<Blob>('thumbs', p.id) || await db.get<Blob>('thumbs', p.originalId);
    if (!b) return null;
    const u = URL.createObjectURL(b);
    this.thumbUrls.set(key, u);
    return u;
  }

  async setThumb(id: string, blob: Blob) {
    await db.put('thumbs', id, blob);
    const p = this.s.photos.get(id);
    if (p) this.update(id, { thumbV: p.thumbV + 1 }, false);
  }

  // ---------- updates ----------
  update(id: string, patch: Partial<Photo>, persist = true) {
    const p = this.s.photos.get(id);
    if (!p) return;
    const photos = new Map(this.s.photos);
    photos.set(id, { ...p, ...patch });
    this.s = { ...this.s, photos };
    this.emit();
    if (persist) this.touch(id); else this.touch(id);
  }

  updateMany(ids: string[], fn: (p: Photo) => Partial<Photo>) {
    const photos = new Map(this.s.photos);
    for (const id of ids) { const p = photos.get(id); if (p) { photos.set(id, { ...p, ...fn(p) }); this.dirty.add(id); } }
    this.s = { ...this.s, photos };
    this.emit();
    clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 300);
  }

  /** Commit develop settings with a history entry. */
  commit(id: string, s: Settings, label?: string) {
    const p = this.s.photos.get(id);
    if (!p) return;
    const prev = p.history[p.hIndex]?.s || p.settings;
    if (JSON.stringify(prev) === JSON.stringify(s)) { if (p.settings !== s) this.update(id, { settings: s }); return; }
    const lbl = label || describeChange(prev, s);
    let history = p.history.slice(0, p.hIndex + 1);
    // merge consecutive tweaks of the same control into one entry
    const last = history[history.length - 1];
    if (last && !label && last.label.split(' ')[0] === lbl.split(' ')[0] && Date.now() - last.t < 1500 && history.length > 1) history = history.slice(0, -1);
    history.push({ label: lbl, s: clone(s), t: Date.now() });
    if (history.length > 300) history = history.slice(history.length - 300);
    this.update(id, { settings: s, history, hIndex: history.length - 1, edited: isEdited(s) });
  }

  undo(id: string) { const p = this.s.photos.get(id); if (p && p.hIndex > 0) this.update(id, { hIndex: p.hIndex - 1, settings: clone(p.history[p.hIndex - 1].s), edited: isEdited(p.history[p.hIndex - 1].s) }); }
  redo(id: string) { const p = this.s.photos.get(id); if (p && p.hIndex < p.history.length - 1) this.update(id, { hIndex: p.hIndex + 1, settings: clone(p.history[p.hIndex + 1].s), edited: isEdited(p.history[p.hIndex + 1].s) }); }
  gotoHistory(id: string, i: number) { const p = this.s.photos.get(id); if (p && p.history[i]) this.update(id, { hIndex: i, settings: clone(p.history[i].s), edited: isEdited(p.history[i].s) }); }
  clearHistory(id: string) { const p = this.s.photos.get(id); if (p) this.update(id, { history: [{ label: 'History cleared', s: clone(p.settings), t: Date.now() }], hIndex: 0 }); }

  applyToMany(ids: string[], fn: (s: Settings, p: Photo) => Settings, label: string) {
    for (const id of ids) { const p = this.s.photos.get(id); if (p) this.commit(id, fn(clone(p.settings), p), label); }
  }

  // ---------- selection ----------
  select(id: string, mode: 'set' | 'toggle' | 'range' = 'set', visible?: string[]) {
    let sel = [...this.s.selected];
    if (mode === 'set') sel = [id];
    else if (mode === 'toggle') sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    else if (mode === 'range' && visible && this.s.active) {
      const a = visible.indexOf(this.s.active), b = visible.indexOf(id);
      if (a >= 0 && b >= 0) sel = visible.slice(Math.min(a, b), Math.max(a, b) + 1);
    }
    this.set({ selected: sel, active: id });
  }

  // ---------- photos ----------
  async virtualCopy(id: string) {
    const p = this.s.photos.get(id);
    if (!p) return;
    const nid = uid();
    const n = [...this.s.photos.values()].filter((x) => x.originalId === p.originalId).length;
    const copy: Photo = { ...clone(p), id: nid, virtual: true, copyName: `Copy ${n}`, history: [{ label: 'Virtual copy', s: clone(p.settings), t: Date.now() }], hIndex: 0, snapshots: [] };
    const tb = await db.get<Blob>('thumbs', p.id);
    if (tb) await db.put('thumbs', nid, tb);
    await db.put('photos', nid, copy);
    const photos = new Map(this.s.photos); photos.set(nid, copy);
    const order = [...this.s.order]; order.splice(order.indexOf(id) + 1, 0, nid);
    this.set({ photos, order, selected: [nid], active: nid });
    this.toast('Virtual copy created');
  }

  async remove(ids: string[]) {
    const photos = new Map(this.s.photos);
    for (const id of ids) {
      const p = photos.get(id);
      if (!p) continue;
      photos.delete(id);
      await db.del('photos', id);
      await db.del('thumbs', id);
      if (![...photos.values()].some((x) => x.originalId === p.originalId)) await db.del('originals', p.originalId);
    }
    const order = this.s.order.filter((x) => photos.has(x));
    const collections = this.s.collections.map((c) => ({ ...c, ids: c.ids.filter((x) => photos.has(x)) }));
    for (const c of collections) await db.put('collections', c.id, c);
    const quick = this.s.quick.filter((x) => photos.has(x));
    db.put('kv', 'quick', quick);
    this.set({ photos, order, collections, quick, selected: [], active: order[0] || null });
    this.toast(`Removed ${ids.length} photo${ids.length === 1 ? '' : 's'} from the catalog`);
  }

  toggleQuick(ids: string[]) {
    const q = new Set(this.s.quick);
    const allIn = ids.every((i) => q.has(i));
    for (const i of ids) allIn ? q.delete(i) : q.add(i);
    const quick = [...q];
    db.put('kv', 'quick', quick);
    this.set({ quick });
    this.toast(allIn ? 'Removed from Quick Collection' : 'Added to Quick Collection');
  }

  stack(ids: string[]) {
    if (ids.length < 2) return;
    const sid = uid();
    this.updateMany(ids, (p) => ({ stack: sid, stackTop: p.id === ids[0] }));
    this.toast(`Stacked ${ids.length} photos`);
  }
  unstack(ids: string[]) {
    const stacks = new Set(ids.map((i) => this.s.photos.get(i)?.stack).filter(Boolean));
    const all = [...this.s.photos.values()].filter((p) => p.stack && stacks.has(p.stack)).map((p) => p.id);
    this.updateMany(all, () => ({ stack: undefined, stackTop: undefined }));
  }

  // ---------- collections ----------
  async saveCollection(c: Collection) {
    const others = this.s.collections.filter((x) => x.id !== c.id);
    this.set({ collections: [...others, c] });
    await db.put('collections', c.id, c);
  }
  async deleteCollection(id: string) {
    const kids = this.s.collections.filter((c) => c.parent === id).map((c) => c.id);
    for (const k of kids) await this.deleteCollection(k);
    this.set({ collections: this.s.collections.filter((c) => c.id !== id), source: this.s.source.kind === 'collection' && this.s.source.id === id ? { kind: 'all' } : this.s.source });
    await db.del('collections', id);
  }
  addToCollection(cid: string, ids: string[]) {
    const c = this.s.collections.find((x) => x.id === cid);
    if (!c || c.kind !== 'manual') return;
    this.saveCollection({ ...c, ids: [...new Set([...c.ids, ...ids])] });
    this.toast(`Added ${ids.length} to “${c.name}”`);
  }
  removeFromCollection(cid: string, ids: string[]) {
    const c = this.s.collections.find((x) => x.id === cid);
    if (!c) return;
    this.saveCollection({ ...c, ids: c.ids.filter((x) => !ids.includes(x)) });
  }

  // ---------- presets ----------
  async savePreset(p: Preset) { this.set({ presets: [...this.s.presets.filter((x) => x.id !== p.id), p] }); await db.put('presets', p.id, p); }
  async deletePreset(id: string) { this.set({ presets: this.s.presets.filter((x) => x.id !== id) }); await db.del('presets', id); }
  async saveExportPreset(p: ExportPreset) { this.set({ exportPresets: [...this.s.exportPresets.filter((x) => x.id !== p.id), p] }); await db.put('exportPresets', p.id, p); }
  async deleteExportPreset(id: string) { this.set({ exportPresets: this.s.exportPresets.filter((x) => x.id !== id) }); await db.del('exportPresets', id); }

  // ---------- queries ----------
  sourcePhotos(src: Source = this.s.source): Photo[] {
    const all = this.s.order.map((id) => this.s.photos.get(id)!).filter(Boolean);
    switch (src.kind) {
      case 'all': return all;
      case 'quick': return all.filter((p) => this.s.quick.includes(p.id));
      case 'recent': { const t = Math.max(0, ...all.map((p) => p.importedAt)); return all.filter((p) => t - p.importedAt < 10 * 60 * 1000); }
      case 'folder': return all.filter((p) => p.folder === src.name);
      case 'rejected': return all.filter((p) => p.flag === -1);
      case 'edited': return all.filter((p) => p.edited);
      case 'collection': {
        const c = this.s.collections.find((x) => x.id === src.id);
        if (!c) return [];
        if (c.kind === 'manual') return all.filter((p) => c.ids.includes(p.id));
        if (c.kind === 'smart') return all.filter((p) => matchRules(p, c, this.s));
        // set: union of children
        const kids = this.s.collections.filter((x) => x.parent === c.id);
        const ids = new Set(kids.flatMap((k) => this.sourcePhotos({ kind: 'collection', id: k.id }).map((p) => p.id)));
        return all.filter((p) => ids.has(p.id));
      }
    }
  }

  visible(): Photo[] {
    const f = this.s.filter;
    let ps = this.sourcePhotos().filter((p) => matchFilter(p, f));
    // collapsed stacks: show only the top
    if (!this.s.prefs.expandStacks) ps = ps.filter((p) => !p.stack || p.stackTop);
    const k = this.s.sort, d = this.s.sortDir;
    const val = (p: Photo): any => k === 'name' ? p.name.toLowerCase() : k === 'label' ? LABELS.indexOf(p.label) : k === 'edited' ? (p.edited ? 1 : 0) : k === 'ext' ? p.ext : (p as any)[k];
    return [...ps].sort((a, b) => (val(a) < val(b) ? -d : val(a) > val(b) ? d : 0));
  }

  folders(): { name: string; count: number }[] {
    const m = new Map<string, number>();
    for (const p of this.s.photos.values()) m.set(p.folder, (m.get(p.folder) || 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
  }

  keywords(): { name: string; count: number }[] {
    const m = new Map<string, number>();
    for (const p of this.s.photos.values()) for (const k of p.keywords) m.set(k, (m.get(k) || 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
  }

  async resetCatalog() { await db.clearAll(); location.reload(); }
}

export function matchFilter(p: Photo, f: Filter): boolean {
  if (f.text) {
    const t = f.text.toLowerCase();
    const hay = [p.name, p.title, p.caption, p.keywords.join(' '), p.exif.model, p.exif.make, p.exif.lens, p.location, p.folder, p.copyName].join(' ').toLowerCase();
    if (!t.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  if (f.minRating) {
    if (f.ratingOp === '>=' && p.rating < f.minRating) return false;
    if (f.ratingOp === '=' && p.rating !== f.minRating) return false;
    if (f.ratingOp === '<=' && p.rating > f.minRating) return false;
  }
  if (f.flag === 'picked' && p.flag !== 1) return false;
  if (f.flag === 'rejected' && p.flag !== -1) return false;
  if (f.flag === 'unflagged' && p.flag !== 0) return false;
  if (f.flag === 'notRejected' && p.flag === -1) return false;
  if (f.label && (f.label === 'none' ? p.label !== '' : p.label !== f.label)) return false;
  if (f.camera && (p.exif.model || 'Unknown') !== f.camera) return false;
  if (f.lens && (p.exif.lens || 'Unknown') !== f.lens) return false;
  if (f.fileType && (f.fileType === 'raw' ? !p.raw : f.fileType === 'virtual' ? !p.virtual : p.ext !== f.fileType)) return false;
  if (f.edited === 'edited' && !p.edited) return false;
  if (f.edited === 'unedited' && p.edited) return false;
  if (f.keyword && !p.keywords.includes(f.keyword)) return false;
  return true;
}

export const RULE_FIELDS: { id: string; label: string; type: 'num' | 'text' | 'enum' | 'date' | 'bool'; options?: string[] }[] = [
  { id: 'rating', label: 'Rating', type: 'num' },
  { id: 'flag', label: 'Pick flag', type: 'enum', options: ['picked', 'unflagged', 'rejected'] },
  { id: 'label', label: 'Color label', type: 'enum', options: ['red', 'yellow', 'green', 'blue', 'purple', 'none'] },
  { id: 'keyword', label: 'Keywords', type: 'text' },
  { id: 'filename', label: 'File name', type: 'text' },
  { id: 'text', label: 'Any searchable text', type: 'text' },
  { id: 'camera', label: 'Camera', type: 'text' },
  { id: 'lens', label: 'Lens', type: 'text' },
  { id: 'iso', label: 'ISO', type: 'num' },
  { id: 'focal', label: 'Focal length (mm)', type: 'num' },
  { id: 'aperture', label: 'Aperture (f/)', type: 'num' },
  { id: 'captureDate', label: 'Capture date', type: 'date' },
  { id: 'filetype', label: 'File type', type: 'enum', options: ['raw', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'heic', 'webp', 'dng'] },
  { id: 'edited', label: 'Has edits', type: 'bool' },
  { id: 'gps', label: 'Has GPS', type: 'bool' },
  { id: 'virtual', label: 'Is virtual copy', type: 'bool' },
];

export function matchRule(p: Photo, r: Rule, st: { quick: string[] }): boolean {
  const v = r.value;
  const num = (x: number | undefined) => {
    if (x === undefined) return false;
    const n = +v;
    return r.op === '>=' ? x >= n : r.op === '<=' ? x <= n : r.op === '>' ? x > n : r.op === '<' ? x < n : r.op === '!=' ? x !== n : x === n;
  };
  const text = (x: string) => {
    const a = (x || '').toLowerCase(), b = v.toLowerCase();
    return r.op === 'contains' ? a.includes(b) : r.op === 'notContains' ? !a.includes(b) : r.op === 'starts' ? a.startsWith(b) : r.op === 'ends' ? a.endsWith(b) : r.op === 'is' ? a === b : a.includes(b);
  };
  const bool = (x: boolean) => (r.op === 'isFalse' ? !x : x);
  switch (r.field) {
    case 'rating': return num(p.rating);
    case 'flag': { const f = p.flag === 1 ? 'picked' : p.flag === -1 ? 'rejected' : 'unflagged'; return r.op === 'isNot' ? f !== v : f === v; }
    case 'label': { const l = p.label || 'none'; return r.op === 'isNot' ? l !== v : l === v; }
    case 'keyword': return r.op === 'notContains' ? !p.keywords.some((k) => k.toLowerCase().includes(v.toLowerCase())) : p.keywords.some((k) => text(k));
    case 'filename': return text(p.name);
    case 'text': return text([p.name, p.title, p.caption, p.keywords.join(' '), p.location].join(' '));
    case 'camera': return text(`${p.exif.make || ''} ${p.exif.model || ''}`);
    case 'lens': return text(p.exif.lens || '');
    case 'iso': return num(p.exif.iso);
    case 'focal': return num(p.exif.focal);
    case 'aperture': return num(p.exif.fnumber);
    case 'captureDate': {
      const t = new Date(p.captureTime), d = new Date(v);
      if (r.op === 'inLast') return Date.now() - p.captureTime <= +v * 86400000;
      const day = (x: Date) => x.toISOString().slice(0, 10);
      return r.op === 'before' ? t < d : r.op === 'after' ? t > d : day(t) === day(d);
    }
    case 'filetype': return v === 'raw' ? p.raw : p.ext === v;
    case 'edited': return bool(p.edited);
    case 'gps': return bool(p.lat !== undefined && p.lon !== undefined);
    case 'virtual': return bool(p.virtual);
    case 'quick': return st.quick.includes(p.id);
  }
  return false;
}

export function matchRules(p: Photo, c: Collection, st: { quick: string[] }): boolean {
  if (!c.rules.length) return true;
  return c.match === 'any' ? c.rules.some((r) => matchRule(p, r, st)) : c.rules.every((r) => matchRule(p, r, st));
}

export const store = new Store();

export function useStore<T>(sel: (s: State) => T): T {
  useSyncExternalStore(store.subscribe, () => store.v);
  return sel(store.s);
}

export function photoTitle(p: Photo) { return p.virtual ? `${p.name} (${p.copyName})` : p.name; }
