import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Grid3x3, Square, Columns2, LayoutGrid, Folder, FolderPlus, Plus, Trash2, Star, Clock, Pencil, Ban, Sparkles, Tag, X, Filter as FilterIcon, ChevronUp, ChevronDown, Layers3, Images } from 'lucide-react';
import { Section, Stars, FlagMark, LabelDot, Thumb, Modal, LABEL_COLORS, fmtExposure, fmtBytes, Seg, HistogramView } from './common';
import { store, useStore, photoTitle, emptyFilter, RULE_FIELDS, LABELS, type Photo, type Collection, type Rule, type Source, type SortKey } from '../catalog/store';
import { WB_PRESETS, autoTone, histogram } from '../engine/auto';
import { loadDecoded } from '../engine/pipeline';
import { renderForDisplay, refreshThumb } from '../engine/export';
import { clone, uid, type Settings } from '../engine/settings';

export default function Library() {
  const st = useStore((s) => s);
  const vis = store.visible();
  const view = st.libView;
  return (
    <div className="module library">
      <LeftPanel />
      <main className="center">
        <FilterBar />
        {view === 'grid' && <Grid photos={vis} />}
        {view === 'loupe' && <Loupe />}
        {view === 'compare' && <Compare />}
        {view === 'survey' && <Survey />}
        <LibToolbar count={vis.length} />
      </main>
      <RightPanel />
    </div>
  );
}

// ---------------- left panel ----------------

function SourceItem({ src, icon, label, count }: { src: Source; icon: React.ReactNode; label: string; count: number }) {
  const cur = useStore((s) => s.source);
  const on = JSON.stringify(cur) === JSON.stringify(src);
  return (
    <div className={'src-item' + (on ? ' on' : '')} onClick={() => store.set({ source: src })}
      onDragOver={(e) => { if (src.kind === 'collection' || src.kind === 'quick') e.preventDefault(); }}
      onDrop={(e) => {
        const ids = JSON.parse(e.dataTransfer.getData('text/abyss-ids') || '[]');
        if (src.kind === 'collection') store.addToCollection(src.id, ids);
        if (src.kind === 'quick') store.toggleQuick(ids);
      }}>
      {icon}<span className="grow">{label}</span><span className="count">{count}</span>
    </div>
  );
}

function LeftPanel() {
  const st = useStore((s) => s);
  const [editing, setEditing] = useState<Collection | null>(null);
  const all = st.photos.size;
  const folders = store.folders();
  const kws = store.keywords();
  const roots = st.collections.filter((c) => !c.parent).sort((a, b) => a.name.localeCompare(b.name));
  const renderCol = (c: Collection, depth: number): React.ReactNode => (
    <div key={c.id} style={{ paddingLeft: depth * 12 }} className="col-row">
      <SourceItem src={{ kind: 'collection', id: c.id }} icon={c.kind === 'smart' ? <Sparkles size={13} /> : c.kind === 'set' ? <Folder size={13} /> : <Images size={13} />} label={c.name} count={store.sourcePhotos({ kind: 'collection', id: c.id }).length} />
      <span className="col-actions">
        <button className="icon" title="Edit" onClick={() => setEditing(c)}><Pencil size={11} /></button>
        <button className="icon" title="Delete" onClick={() => { if (confirm(`Delete collection “${c.name}”? Photos stay in the catalog.`)) store.deleteCollection(c.id); }}><Trash2 size={11} /></button>
      </span>
      {c.kind === 'set' && st.collections.filter((k) => k.parent === c.id).map((k) => renderCol(k, depth + 1))}
    </div>
  );
  const newCol = (kind: Collection['kind']) => setEditing({ id: uid(), name: kind === 'smart' ? 'Smart collection' : kind === 'set' ? 'Collection set' : 'Collection', kind, ids: kind === 'manual' ? [...st.selected] : [], match: 'all', rules: kind === 'smart' ? [{ field: 'rating', op: '>=', value: '3' }] : [], created: Date.now() });
  return (
    <aside className="left-panel">
      <Section title="Catalog" id="catalog">
        <SourceItem src={{ kind: 'all' }} icon={<LayoutGrid size={13} />} label="All Photographs" count={all} />
        <SourceItem src={{ kind: 'quick' }} icon={<Star size={13} />} label="Quick Collection" count={st.quick.length} />
        <SourceItem src={{ kind: 'recent' }} icon={<Clock size={13} />} label="Previous Import" count={store.sourcePhotos({ kind: 'recent' }).length} />
        <SourceItem src={{ kind: 'edited' }} icon={<Pencil size={13} />} label="Edited" count={store.sourcePhotos({ kind: 'edited' }).length} />
        <SourceItem src={{ kind: 'rejected' }} icon={<Ban size={13} />} label="Rejected" count={store.sourcePhotos({ kind: 'rejected' }).length} />
      </Section>
      <Section title="Folders" id="folders">
        {folders.map((f) => <SourceItem key={f.name} src={{ kind: 'folder', name: f.name }} icon={<Folder size={13} />} label={f.name} count={f.count} />)}
        {!folders.length && <p className="hint">Imported folders appear here.</p>}
      </Section>
      <Section title="Collections" id="collections" right={<span className="row tight">
        <button className="icon" title="New collection (from selection)" onClick={() => newCol('manual')}><Plus size={14} /></button>
        <button className="icon" title="New smart collection" onClick={() => newCol('smart')}><Sparkles size={14} /></button>
        <button className="icon" title="New collection set" onClick={() => newCol('set')}><FolderPlus size={14} /></button>
      </span>}>
        {roots.map((c) => renderCol(c, 0))}
        {!roots.length && <p className="hint">Group photos into collections. Smart collections fill themselves from rules. Drag photos onto a collection to add them.</p>}
      </Section>
      <Section title="Keyword List" id="kwlist">
        {kws.map((k) => (
          <div key={k.name} className={'src-item' + (st.filter.keyword === k.name ? ' on' : '')} onClick={() => store.set({ filter: { ...st.filter, keyword: st.filter.keyword === k.name ? '' : k.name } })}>
            <Tag size={12} /><span className="grow">{k.name}</span><span className="count">{k.count}</span>
            <button className="icon kw-del" title="Remove keyword from all photos" onClick={(e) => { e.stopPropagation(); if (confirm(`Remove “${k.name}” from every photo?`)) store.updateMany([...st.photos.keys()], (p) => ({ keywords: p.keywords.filter((x) => x !== k.name) })); }}><X size={11} /></button>
          </div>
        ))}
        {!kws.length && <p className="hint">No keywords yet. Add them in the Keywording panel.</p>}
      </Section>
      {editing && <CollectionDialog c={editing} onClose={() => setEditing(null)} />}
    </aside>
  );
}

function CollectionDialog({ c, onClose }: { c: Collection; onClose: () => void }) {
  const [col, setCol] = useState<Collection>(clone(c));
  const sets = store.s.collections.filter((x) => x.kind === 'set' && x.id !== c.id);
  const matching = col.kind === 'smart' ? [...store.s.photos.values()].filter((p) => (col.match === 'any' ? col.rules.some((r) => matchR(p, r)) : col.rules.every((r) => matchR(p, r)))).length : col.ids.length;
  return (
    <Modal title={col.kind === 'smart' ? 'Smart Collection' : col.kind === 'set' ? 'Collection Set' : 'Collection'} wide={col.kind === 'smart'} onClose={onClose} footer={<>
      <span className="hint grow">{col.kind !== 'set' && `${matching} photo${matching === 1 ? '' : 's'}`}</span>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={() => { store.saveCollection(col); store.set({ source: { kind: 'collection', id: col.id } }); onClose(); }}>Save</button>
    </>}>
      <label className="field">Name<input autoFocus value={col.name} onChange={(e) => setCol({ ...col, name: e.target.value })} /></label>
      <label className="field">Inside set
        <select value={col.parent || ''} onChange={(e) => setCol({ ...col, parent: e.target.value || undefined })}>
          <option value="">None (top level)</option>{sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      {col.kind === 'manual' && <label className="check"><input type="checkbox" checked={col.ids.length > 0} onChange={(e) => setCol({ ...col, ids: e.target.checked ? [...store.s.selected] : [] })} /> Include selected photos ({store.s.selected.length})</label>}
      {col.kind === 'smart' && <>
        <div className="row">Match <select value={col.match} onChange={(e) => setCol({ ...col, match: e.target.value as any })}><option value="all">all</option><option value="any">any</option></select> of the following rules:</div>
        {col.rules.map((r, i) => <RuleRow key={i} r={r} onChange={(nr) => setCol({ ...col, rules: col.rules.map((x, j) => (j === i ? nr : x)) })} onRemove={() => setCol({ ...col, rules: col.rules.filter((_, j) => j !== i) })} />)}
        <button className="btn small" onClick={() => setCol({ ...col, rules: [...col.rules, { field: 'keyword', op: 'contains', value: '' }] })}><Plus size={12} /> Add rule</button>
      </>}
    </Modal>
  );
}

import { matchRule } from '../catalog/store';
const matchR = (p: Photo, r: Rule) => matchRule(p, r, store.s);

function RuleRow({ r, onChange, onRemove }: { r: Rule; onChange: (r: Rule) => void; onRemove: () => void }) {
  const f = RULE_FIELDS.find((x) => x.id === r.field) || RULE_FIELDS[0];
  const ops = f.type === 'num' ? [['>=', 'is at least'], ['<=', 'is at most'], ['=', 'is'], ['!=', 'is not'], ['>', 'is greater than'], ['<', 'is less than']]
    : f.type === 'text' ? [['contains', 'contains'], ['notContains', "doesn't contain"], ['is', 'is'], ['starts', 'starts with'], ['ends', 'ends with']]
      : f.type === 'enum' ? [['is', 'is'], ['isNot', 'is not']]
        : f.type === 'date' ? [['is', 'is'], ['before', 'is before'], ['after', 'is after'], ['inLast', 'is in the last (days)']]
          : [['isTrue', 'is true'], ['isFalse', 'is false']];
  return (
    <div className="rule-row">
      <select value={r.field} onChange={(e) => { const nf = RULE_FIELDS.find((x) => x.id === e.target.value)!; onChange({ field: nf.id, op: nf.type === 'num' ? '>=' : nf.type === 'text' ? 'contains' : nf.type === 'enum' ? 'is' : nf.type === 'date' ? 'inLast' : 'isTrue', value: nf.options?.[0] || '' }); }}>
        {RULE_FIELDS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>
      <select value={r.op} onChange={(e) => onChange({ ...r, op: e.target.value })}>{ops.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      {f.type === 'enum' ? <select value={r.value} onChange={(e) => onChange({ ...r, value: e.target.value })}>{f.options!.map((o) => <option key={o}>{o}</option>)}</select>
        : f.type === 'bool' ? <span />
          : <input type={f.type === 'num' || (f.type === 'date' && r.op === 'inLast') ? 'number' : f.type === 'date' ? 'date' : 'text'} value={r.value} onChange={(e) => onChange({ ...r, value: e.target.value })} />}
      <button className="icon" onClick={onRemove}><X size={14} /></button>
    </div>
  );
}

// ---------------- filter bar ----------------

function FilterBar() {
  const f = useStore((s) => s.filter);
  const [open, setOpen] = useState(false);
  const cams = useMemo(() => [...new Set([...store.s.photos.values()].map((p) => p.exif.model || 'Unknown'))].sort(), [store.s.photos.size]);
  const lenses = useMemo(() => [...new Set([...store.s.photos.values()].map((p) => p.exif.lens || 'Unknown'))].sort(), [store.s.photos.size]);
  const set = (p: Partial<typeof f>) => store.set({ filter: { ...f, ...p } });
  const active = JSON.stringify(f) !== JSON.stringify(emptyFilter());
  return (
    <div className="filterbar">
      <FilterIcon size={14} />
      <input className="search" placeholder="Search names, keywords, captions, cameras…" value={f.text} onChange={(e) => set({ text: e.target.value })} />
      <span className="fb-group">
        <select value={f.ratingOp} onChange={(e) => set({ ratingOp: e.target.value as any })}><option value=">=">≥</option><option value="=">=</option><option value="<=">≤</option></select>
        <Stars value={f.minRating} onChange={(v) => set({ minRating: v })} />
      </span>
      <select value={f.flag} onChange={(e) => set({ flag: e.target.value as any })}>
        <option value="all">Any flag</option><option value="picked">Picked</option><option value="unflagged">Unflagged</option><option value="rejected">Rejected</option><option value="notRejected">Not rejected</option>
      </select>
      <span className="fb-labels">
        {LABELS.filter(Boolean).map((l) => <button key={l} className={'label-btn' + (f.label === l ? ' on' : '')} style={{ background: LABEL_COLORS[l] }} title={l} onClick={() => set({ label: f.label === l ? '' : l })} />)}
      </span>
      <button className={'btn small' + (open ? ' on' : '')} onClick={() => setOpen(!open)}>Metadata {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
      {active && <button className="btn small" onClick={() => store.set({ filter: emptyFilter() })}>Clear</button>}
      {open && <div className="fb-meta">
        <select value={f.camera} onChange={(e) => set({ camera: e.target.value })}><option value="">Any camera</option>{cams.map((c) => <option key={c}>{c}</option>)}</select>
        <select value={f.lens} onChange={(e) => set({ lens: e.target.value })}><option value="">Any lens</option>{lenses.map((c) => <option key={c}>{c}</option>)}</select>
        <select value={f.fileType} onChange={(e) => set({ fileType: e.target.value })}><option value="">Any file type</option><option value="raw">RAW</option><option value="jpg">JPEG</option><option value="png">PNG</option><option value="tif">TIFF</option><option value="heic">HEIC</option><option value="virtual">Virtual copies</option></select>
        <select value={f.edited} onChange={(e) => set({ edited: e.target.value as any })}><option value="all">Edited or not</option><option value="edited">Edited</option><option value="unedited">Unedited</option></select>
      </div>}
    </div>
  );
}

// ---------------- grid ----------------

function Grid({ photos }: { photos: Photo[] }) {
  const sel = useStore((s) => s.selected);
  const active = useStore((s) => s.active);
  const size = useStore((s) => s.prefs.thumbSize || 170);
  const quick = useStore((s) => s.quick);
  const ids = photos.map((p) => p.id);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = ref.current?.querySelector('.cell.active'); (el as any)?.scrollIntoView?.({ block: 'nearest' }); }, [active]);
  if (!photos.length) return <EmptyLibrary />;
  return (
    <div className="grid" ref={ref} style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}
      onClick={(e) => { if (e.target === e.currentTarget) store.set({ selected: [] }); }}>
      {photos.map((p, i) => {
        const stackN = p.stack ? [...store.s.photos.values()].filter((x) => x.stack === p.stack).length : 0;
        return (
          <div key={p.id} className={'cell' + (sel.includes(p.id) ? ' sel' : '') + (active === p.id ? ' active' : '') + (p.flag === -1 ? ' rejected' : '')}
            draggable onDragStart={(e) => { const dragIds = sel.includes(p.id) ? sel : [p.id]; e.dataTransfer.setData('text/abyss-ids', JSON.stringify(dragIds)); }}
            onClick={(e) => store.select(p.id, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'set', ids)}
            onDoubleClick={() => { store.select(p.id); store.set({ libView: 'loupe' }); }}>
            <div className="cell-top"><span className="cell-idx">{i + 1}</span>{p.virtual && <span className="badge-v" title="Virtual copy">VC</span>}{stackN > 1 && <span className="badge-v" title="Stack — click to expand" onClick={(e) => { e.stopPropagation(); store.savePrefs({ expandStacks: !store.s.prefs.expandStacks }); }}><Layers3 size={10} />{stackN}</span>}{p.edited && <span className="badge-e" title="Edited">✎</span>}<FlagMark flag={p.flag} /></div>
            <div className="cell-img"><Thumb p={p} /></div>
            <div className="cell-bot">
              <Stars value={p.rating} onChange={(v) => store.updateMany(sel.includes(p.id) ? sel : [p.id], () => ({ rating: v }))} size={11} />
              <LabelDot label={p.label} />
              <span className={'quick-dot' + (quick.includes(p.id) ? ' on' : '')} title="Quick Collection (B)" onClick={(e) => { e.stopPropagation(); store.toggleQuick([p.id]); }}>●</span>
            </div>
            <div className="cell-name" title={photoTitle(p)}>{photoTitle(p)}</div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyLibrary() {
  const n = useStore((s) => s.photos.size);
  return (
    <div className="empty-state">
      {n ? <><h2>No photos match</h2><p>Try a different source or clear the filter.</p><button className="btn" onClick={() => store.set({ filter: emptyFilter(), source: { kind: 'all' } })}>Show all photos</button></>
        : <><div className="logo-big" /><h2>Welcome to ANCHOR Abyss</h2><p>Import photos to start. JPEG, PNG, TIFF, HEIC, WebP and RAW files from most cameras (DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2 and more) are supported. Everything stays on this device.</p>
          <button className="btn primary big" onClick={() => (document.getElementById('import-input') as HTMLInputElement)?.click()}>Import photos…</button>
          <p className="hint">Or drop files or folders anywhere in this window.</p></>}
    </div>
  );
}

// ---------------- loupe / compare / survey ----------------

function useRendered(p: Photo | undefined, max: number) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!p) return;
    setUrl(null);
    renderForDisplay(p, max).then((c) => c.convertToBlob({ type: 'image/jpeg', quality: 0.92 })).then((b) => { if (live) setUrl(URL.createObjectURL(b)); }).catch(() => { /* thumbnail stays */ });
    return () => { live = false; };
  }, [p?.id, JSON.stringify(p?.settings)]);
  return url;
}

function Loupe() {
  const p = useStore((s) => (s.active ? s.photos.get(s.active) : undefined));
  const url = useRendered(p, Math.round(Math.max(window.innerWidth, window.innerHeight) * Math.min(2, devicePixelRatio)));
  const [info, setInfo] = useState(1);
  if (!p) return <EmptyLibrary />;
  const e = p.exif;
  return (
    <div className="loupe" onClick={() => setInfo((info + 1) % 3)} title="Click to cycle the info overlay (I)">
      {url ? <img src={url} alt="" /> : <Thumb p={p} className="loupe-thumb" />}
      {info > 0 && <div className="loupe-info">
        <b>{photoTitle(p)}</b>
        {info > 1 && <div>{[e.model, e.lens].filter(Boolean).join(' · ')}</div>}
        <div>{[e.iso && `ISO ${e.iso}`, e.focal && `${Math.round(e.focal)}mm`, e.fnumber && `f/${e.fnumber}`, fmtExposure(e.exposure)].filter(Boolean).join('  ')}</div>
        {info > 1 && <div>{new Date(p.captureTime).toLocaleString()} · {p.w}×{p.h}</div>}
      </div>}
    </div>
  );
}

function Compare() {
  const sel = useStore((s) => s.selected);
  const active = useStore((s) => s.active);
  const [selectId, setSelectId] = useState<string | null>(sel[0] || null);
  const ids = sel.length >= 2 ? sel : store.visible().slice(0, 2).map((p) => p.id);
  const a = store.s.photos.get(selectId && ids.includes(selectId) ? selectId : ids[0]);
  const bId = active && active !== a?.id ? active : ids.find((x) => x !== a?.id);
  const b = bId ? store.s.photos.get(bId) : undefined;
  const ua = useRendered(a, 1800), ub = useRendered(b, 1800);
  if (!a || !b) return <div className="empty-state"><p>Select two or more photos to compare.</p></div>;
  return (
    <div className="compare">
      {[[a, ua, 'Select'], [b, ub, 'Candidate']].map(([p, u, l]: any) => (
        <div key={l} className="compare-pane">
          <div className="pane-label">{l}: {photoTitle(p)} <Stars value={p.rating} onChange={(v) => store.update(p.id, { rating: v })} /></div>
          {u ? <img src={u} alt="" /> : <Thumb p={p} />}
        </div>
      ))}
      <div className="compare-actions">
        <button className="btn small" onClick={() => setSelectId(b.id)}>Make candidate the select</button>
        <button className="btn small" onClick={() => { const i = ids.indexOf(b.id); const n = ids[(i + 1) % ids.length]; store.set({ active: n === a.id ? ids[(i + 2) % ids.length] : n }); }}>Next candidate →</button>
      </div>
    </div>
  );
}

function Survey() {
  const sel = useStore((s) => s.selected);
  const active = useStore((s) => s.active);
  const photos = sel.map((id) => store.s.photos.get(id)!).filter(Boolean);
  if (photos.length < 2) return <div className="empty-state"><p>Select several photos (Ctrl/Cmd+click) to survey them side by side.</p></div>;
  const cols = Math.ceil(Math.sqrt(photos.length));
  return (
    <div className="survey" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {photos.map((p) => (
        <div key={p.id} className={'survey-cell' + (p.id === active ? ' active' : '')} onClick={() => store.set({ active: p.id })}>
          <Thumb p={p} />
          <div className="survey-bar"><Stars value={p.rating} onChange={(v) => store.update(p.id, { rating: v })} /><FlagMark flag={p.flag} />
            <button className="icon" title="Remove from survey" onClick={(e) => { e.stopPropagation(); store.set({ selected: sel.filter((x) => x !== p.id) }); }}><X size={12} /></button></div>
        </div>
      ))}
    </div>
  );
}

// ---------------- toolbar ----------------

function LibToolbar({ count }: { count: number }) {
  const st = useStore((s) => s);
  const sel = st.selected;
  return (
    <div className="toolbar bottom">
      <Seg value={st.libView} options={[['grid', <Grid3x3 size={14} key="g" />], ['loupe', <Square size={14} key="l" />], ['compare', <Columns2 size={14} key="c" />], ['survey', <LayoutGrid size={14} key="s" />]]} onChange={(v) => store.set({ libView: v })} />
      <span className="sep" />
      <span className="lbl">Sort</span>
      <select value={st.sort} onChange={(e) => store.set({ sort: e.target.value as SortKey })}>
        <option value="captureTime">Capture time</option><option value="importedAt">Import order</option><option value="name">File name</option><option value="rating">Rating</option><option value="label">Color label</option><option value="edited">Edited</option><option value="ext">File type</option>
      </select>
      <button className="icon" onClick={() => store.set({ sortDir: st.sortDir === 1 ? -1 : 1 })} title="Sort direction">{st.sortDir === 1 ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
      <span className="sep" />
      {sel.length > 0 && <>
        <button className="icon" title="Pick (P)" onClick={() => store.updateMany(sel, () => ({ flag: 1 }))}><FlagMark flag={1} size={14} /></button>
        <button className="icon" title="Reject (X)" onClick={() => store.updateMany(sel, () => ({ flag: -1 }))}><FlagMark flag={-1} size={14} /></button>
        <Stars value={st.photos.get(st.active || sel[0])?.rating || 0} onChange={(v) => store.updateMany(sel, () => ({ rating: v }))} size={13} />
        {LABELS.filter(Boolean).map((l) => <button key={l} className="label-btn" style={{ background: LABEL_COLORS[l] }} title={`Label ${l}`} onClick={() => store.updateMany(sel, (p) => ({ label: p.label === l ? '' : l }))} />)}
      </>}
      <div className="grow" />
      <span className="info">{sel.length > 1 ? `${sel.length} of ${count} selected` : `${count} photo${count === 1 ? '' : 's'}`}</span>
      {st.libView === 'grid' && <input type="range" min={100} max={360} value={st.prefs.thumbSize || 170} onChange={(e) => store.savePrefs({ thumbSize: +e.target.value })} title="Thumbnail size" className="size-range" />}
    </div>
  );
}

// ---------------- right panel ----------------

function RightPanel() {
  const st = useStore((s) => s);
  const p = st.active ? st.photos.get(st.active) : undefined;
  const sel = st.selected.length ? st.selected : p ? [p.id] : [];
  return (
    <aside className="right-panel">
      <ThumbHisto p={p} />
      <QuickDevelop ids={sel} />
      <Keywording ids={sel} />
      <Metadata p={p} ids={sel} />
    </aside>
  );
}

function ThumbHisto({ p }: { p?: Photo }) {
  const [h, setH] = useState<any>(null);
  useEffect(() => {
    if (!p) { setH(null); return; }
    let live = true;
    store.thumbUrl(p).then(async (u) => {
      if (!u || !live) return;
      const img = new Image(); img.src = u; await img.decode();
      const c = new OffscreenCanvas(img.width, img.height); const x = c.getContext('2d')!; x.drawImage(img, 0, 0);
      if (live) setH(histogram(x.getImageData(0, 0, img.width, img.height).data));
    }).catch(() => { /* ignore */ });
    return () => { live = false; };
  }, [p?.id, p?.thumbV]);
  return <HistogramView h={h} />;
}

function QuickDevelop({ ids }: { ids: string[] }) {
  const nudge = (k: keyof Settings, d: number, label: string) => {
    store.applyToMany(ids, (s) => ({ ...s, [k]: k === 'exposure' ? Math.max(-5, Math.min(5, Math.round(((s[k] as number) + d) * 100) / 100)) : Math.max(-100, Math.min(100, (s[k] as number) + d)) }), `Quick Develop: ${label}`);
    for (const id of ids) { const p = store.s.photos.get(id); if (p) refreshThumb(p); }
  };
  const Row = ({ k, label, big, small, exp }: { k: keyof Settings; label: string; big: number; small: number; exp?: boolean }) => (
    <div className="qd-row"><span>{label}</span>
      <button onClick={() => nudge(k, -big, `${label} −`)}>{'«'}</button><button onClick={() => nudge(k, -small, `${label} −`)}>{'‹'}</button>
      <button onClick={() => nudge(k, small, `${label} +`)}>{'›'}</button><button onClick={() => nudge(k, big, `${label} +`)}>{'»'}</button>
      {exp && <span className="hint">⅓ / 1 EV</span>}
    </div>
  );
  return (
    <Section title="Quick Develop" id="qd">
      {!ids.length ? <p className="hint">Select photos to adjust them in bulk.</p> : <>
        <div className="row"><span className="lbl">White balance</span>
          <select value="" onChange={(e) => { const pr = WB_PRESETS[e.target.value]; if (pr) { store.applyToMany(ids, (s) => ({ ...s, wb: e.target.value as any, ...pr }), 'Quick Develop: WB'); ids.forEach((id) => refreshThumb(store.s.photos.get(id)!)); } }}>
            <option value="">Choose…</option>{Object.keys(WB_PRESETS).map((k) => <option key={k} value={k}>{k === 'asShot' ? 'As Shot' : k[0].toUpperCase() + k.slice(1)}</option>)}
          </select>
        </div>
        <button className="btn small" onClick={async () => {
          store.set({ busy: { label: 'Auto tone', done: 0, total: ids.length } });
          for (let i = 0; i < ids.length; i++) {
            const p = store.s.photos.get(ids[i])!;
            try { const d = await loadDecoded(p.originalId, () => store.original(p), p.name); store.commit(p.id, { ...p.settings, ...autoTone(d.preview) }, 'Auto tone'); refreshThumb(store.s.photos.get(p.id)!); } catch { /* skip */ }
            store.set({ busy: { label: 'Auto tone', done: i + 1, total: ids.length } });
          }
          store.set({ busy: null });
        }}>Auto tone</button>
        <Row k="exposure" label="Exposure" big={1} small={0.33} />
        <Row k="contrast" label="Contrast" big={20} small={5} />
        <Row k="highlights" label="Highlights" big={20} small={5} />
        <Row k="shadows" label="Shadows" big={20} small={5} />
        <Row k="whites" label="Whites" big={20} small={5} />
        <Row k="blacks" label="Blacks" big={20} small={5} />
        <Row k="clarity" label="Clarity" big={20} small={5} />
        <Row k="vibrance" label="Vibrance" big={20} small={5} />
        <Row k="saturation" label="Saturation" big={20} small={5} />
        <div className="row small"><button className="btn small" onClick={() => { store.applyToMany(ids, () => clone(store.s.photos.get(ids[0])!.settings && (require_default())), 'Reset all settings'); ids.forEach((id) => refreshThumb(store.s.photos.get(id)!)); }}>Reset all</button>
          <select value="" onChange={(e) => { const pr = [...store.s.presets].find((x) => x.id === e.target.value) || BUILTIN.find((x) => x.id === e.target.value); if (pr) { store.applyToMany(ids, (s) => ({ ...s, ...clone(pr.part) }), `Preset: ${pr.name}`); ids.forEach((id) => refreshThumb(store.s.photos.get(id)!)); } }}>
            <option value="">Apply preset…</option>
            {[...BUILTIN, ...store.s.presets].map((pr) => <option key={pr.id} value={pr.id}>{pr.group}: {pr.name}</option>)}
          </select>
        </div>
      </>}
    </Section>
  );
}
import { BUILTIN_PRESETS as BUILTIN } from '../engine/presets';
import { defaultSettings } from '../engine/settings';
function require_default() { return defaultSettings(); }

function Keywording({ ids }: { ids: string[] }) {
  const [txt, setTxt] = useState('');
  const photos = ids.map((id) => store.s.photos.get(id)!).filter(Boolean);
  const common = photos.length ? photos[0].keywords.filter((k) => photos.every((p) => p.keywords.includes(k))) : [];
  const partial = [...new Set(photos.flatMap((p) => p.keywords))].filter((k) => !common.includes(k));
  const suggestions = store.keywords().map((k) => k.name).filter((k) => !common.includes(k)).slice(0, 12);
  const add = (list: string[]) => {
    const kws = list.map((k) => k.trim()).filter(Boolean);
    if (!kws.length) return;
    store.updateMany(ids, (p) => ({ keywords: [...new Set([...p.keywords, ...kws])] }));
    setTxt('');
  };
  return (
    <Section title="Keywording" id="kw">
      {!ids.length ? <p className="hint">Select photos to add keywords.</p> : <>
        <div className="chips">
          {common.map((k) => <span key={k} className="chip">{k}<X size={11} onClick={() => store.updateMany(ids, (p) => ({ keywords: p.keywords.filter((x) => x !== k) }))} /></span>)}
          {partial.map((k) => <span key={k} className="chip partial" title="On some of the selected photos">{k}*<X size={11} onClick={() => store.updateMany(ids, (p) => ({ keywords: p.keywords.filter((x) => x !== k) }))} /></span>)}
        </div>
        <input placeholder="Add keywords, separated by commas" value={txt} onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(txt.split(',')); }} />
        {suggestions.length > 0 && <div className="chips suggest">{suggestions.map((k) => <span key={k} className="chip ghost" onClick={() => add([k])}>+ {k}</span>)}</div>}
      </>}
    </Section>
  );
}

function Metadata({ p, ids }: { p?: Photo; ids: string[] }) {
  if (!p) return <Section title="Metadata" id="meta"><p className="hint">No photo selected.</p></Section>;
  const e = p.exif;
  const field = (k: 'title' | 'caption' | 'creator' | 'copyright' | 'location', label: string, area = false) => (
    <label className="field small">{label}
      {area ? <textarea defaultValue={p[k]} key={p.id + k} onBlur={(ev) => store.updateMany(ids, () => ({ [k]: ev.target.value }))} rows={2} />
        : <input defaultValue={p[k]} key={p.id + k} onBlur={(ev) => store.updateMany(ids, () => ({ [k]: ev.target.value }))} />}
    </label>
  );
  const rows: [string, any][] = [
    ['File', photoTitle(p)], ['Folder', p.folder], ['Size', `${p.w}×${p.h} · ${fmtBytes(p.size)}`], ['Captured', new Date(p.captureTime).toLocaleString()],
    ['Camera', [e.make, e.model].filter(Boolean).join(' ')], ['Lens', e.lens], ['Exposure', [fmtExposure(e.exposure), e.fnumber && `f/${e.fnumber}`, e.iso && `ISO ${e.iso}`].filter(Boolean).join(' · ')],
    ['Focal length', e.focal && `${Math.round(e.focal)} mm${e.focal35 ? ` (${e.focal35} mm eq.)` : ''}`], ['Flash', e.flash], ['Software', e.software],
    ['GPS', p.lat !== undefined && p.lon !== undefined ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : undefined],
  ];
  return (
    <Section title="Metadata" id="meta">
      {ids.length > 1 && <p className="hint">Edits apply to all {ids.length} selected photos.</p>}
      <div className="row small"><span className="lbl">Rating</span><Stars value={p.rating} onChange={(v) => store.updateMany(ids, () => ({ rating: v }))} />
        <span className="lbl">Label</span>
        <select value={p.label} onChange={(ev) => store.updateMany(ids, () => ({ label: ev.target.value as any }))}>{LABELS.map((l) => <option key={l} value={l}>{l || 'None'}</option>)}</select>
      </div>
      {field('title', 'Title')}
      {field('caption', 'Caption', true)}
      {field('creator', 'Creator')}
      {field('copyright', 'Copyright')}
      {field('location', 'Location')}
      <div className="row small">
        <label className="field small">Latitude<input key={p.id + 'lat'} defaultValue={p.lat ?? ''} onBlur={(ev) => store.updateMany(ids, () => ({ lat: ev.target.value === '' ? undefined : +ev.target.value }))} /></label>
        <label className="field small">Longitude<input key={p.id + 'lon'} defaultValue={p.lon ?? ''} onBlur={(ev) => store.updateMany(ids, () => ({ lon: ev.target.value === '' ? undefined : +ev.target.value }))} /></label>
      </div>
      <table className="exif">{rows.filter(([, v]) => v).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</table>
    </Section>
  );
}
