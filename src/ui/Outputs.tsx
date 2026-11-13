import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, X, MapPin, Download, Printer, Music } from 'lucide-react';
import { Section, Slider, Thumb, Seg, useBox } from './common';
import { store, useStore, photoTitle, type Photo } from '../catalog/store';
import { renderForDisplay, download } from '../engine/export';

function useScope(): Photo[] {
  useStore((s) => s.selected);
  const sel = store.s.selected.map((id) => store.s.photos.get(id)!).filter(Boolean);
  return sel.length > 1 ? sel : store.visible();
}

async function canvasToBytes(c: OffscreenCanvas, q = 0.9) { return new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: q })).arrayBuffer()); }

// ======================= MAP =======================

export function MapModule() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layer = useRef<any>(null);
  const photos = useStore((s) => s.photos);
  const active = useStore((s) => s.active);
  const [err, setErr] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);
  placingRef.current = placing;
  const tagged = [...photos.values()].filter((p) => p.lat !== undefined && p.lon !== undefined);

  useEffect(() => {
    let L: any;
    (async () => {
      try {
        L = (await import('leaflet')).default;
        await import('leaflet/dist/leaflet.css');
        const m = L.map(ref.current!, { worldCopyJump: true }).setView([20, 0], 2);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(m);
        m.on('click', (e: any) => {
          if (!placingRef.current) return;
          const ids = store.s.selected.length ? store.s.selected : store.s.active ? [store.s.active] : [];
          store.updateMany(ids, () => ({ lat: e.latlng.lat, lon: e.latlng.lng }));
          store.toast(`Placed ${ids.length} photo${ids.length === 1 ? '' : 's'} on the map`);
          setPlacing(false);
        });
        mapRef.current = m;
        // keep the map sized to its box (phone sheets and window resizes change it)
        const ro = new ResizeObserver(() => m.invalidateSize());
        ro.observe(ref.current!); m.on('unload', () => ro.disconnect());
        layer.current = L.layerGroup().addTo(m);
        drawMarkers(L);
      } catch (e: any) { setErr('The map could not load. It needs an internet connection for map tiles.'); }
    })();
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  const drawMarkers = async (Lmod?: any) => {
    const L = Lmod || (await import('leaflet')).default;
    if (!layer.current || !mapRef.current) return;
    layer.current.clearLayers();
    const pts: [number, number][] = [];
    for (const p of [...store.s.photos.values()]) {
      if (p.lat === undefined || p.lon === undefined) continue;
      const url = await store.thumbUrl(p);
      const icon = L.divIcon({ className: 'map-pin', html: `<div class="map-pin-img${p.id === store.s.active ? ' on' : ''}" style="background-image:url(${url || ''})"></div>`, iconSize: [44, 44], iconAnchor: [22, 44] });
      const mk = L.marker([p.lat, p.lon], { icon, draggable: true }).addTo(layer.current);
      mk.on('click', () => store.select(p.id));
      mk.on('dragend', () => { const ll = mk.getLatLng(); store.update(p.id, { lat: ll.lat, lon: ll.lng }); });
      mk.bindTooltip(photoTitle(p));
      pts.push([p.lat, p.lon]);
    }
    return pts;
  };

  useEffect(() => { drawMarkers(); }, [photos, active]);

  const fit = () => { if (mapRef.current && tagged.length) mapRef.current.fitBounds(tagged.map((p) => [p.lat!, p.lon!]), { padding: [40, 40], maxZoom: 14 }); };
  const search = async (q: string) => {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (j[0]) mapRef.current?.setView([+j[0].lat, +j[0].lon], 12); else store.toast('Place not found');
    } catch { store.toast('Place search needs an internet connection'); }
  };

  return (
    <div className="module map">
      <aside className="left-panel">
        <Section title="Locations" id="map-loc">
          <p className="hint">{tagged.length} of {photos.size} photos have a location.</p>
          <button className="btn small" onClick={fit} disabled={!tagged.length}>Show all on map</button>
          <form onSubmit={(e) => { e.preventDefault(); search(new FormData(e.currentTarget).get('q') as string); }} className="row small">
            <input name="q" placeholder="Search for a place" /><button className="btn small">Go</button>
          </form>
          <button className={'btn small' + (placing ? ' on' : '')} onClick={() => setPlacing(!placing)} disabled={!store.s.selected.length && !store.s.active}><MapPin size={12} /> {placing ? 'Click the map…' : 'Place selected photos'}</button>
          <button className="btn small" onClick={() => store.updateMany(store.s.selected, () => ({ lat: undefined, lon: undefined }))} disabled={!store.s.selected.length}>Remove location from selected</button>
          <p className="hint">Drag a pin to move it. Click a pin to select that photo.</p>
        </Section>
        <Section title="Photos with a location" id="map-list">
          {tagged.map((p) => <div key={p.id} className={'src-item' + (p.id === active ? ' on' : '')} onClick={() => { store.select(p.id); mapRef.current?.setView([p.lat, p.lon], Math.max(mapRef.current.getZoom(), 12)); }}><MapPin size={12} /><span className="grow">{photoTitle(p)}</span></div>)}
        </Section>
      </aside>
      <main className="center">
        <div ref={ref} className="map-box" style={{ cursor: placing ? 'crosshair' : undefined }} />
        {err && <div className="viewer-msg error">{err}</div>}
      </main>
    </div>
  );
}

// ======================= SLIDESHOW =======================

export function SlideshowModule() {
  const photos = useScope();
  const prefs = useStore((s) => s.prefs);
  const o = { duration: 4, fade: 1, bg: '#000000', caption: 'title', order: 'sort', zoom: true, ...(prefs.slideshow || {}) };
  const set = (p: any) => store.savePrefs({ slideshow: { ...o, ...p } });
  const [playing, setPlaying] = useState(false);
  const [music, setMusic] = useState<string | null>(null);
  return (
    <div className="module slideshow">
      <aside className="left-panel">
        <Section title="Slides" id="ss-list">
          <p className="hint">{photos.length} slide{photos.length === 1 ? '' : 's'}: {store.s.selected.length > 1 ? 'selected photos' : 'current filter'}.</p>
          <div className="mini-strip">{photos.slice(0, 60).map((p) => <Thumb key={p.id} p={p} />)}</div>
        </Section>
      </aside>
      <main className="center">
        <div className="ss-preview" style={{ background: o.bg }}>
          {photos[0] ? <Thumb p={photos[0]} /> : <p>No photos</p>}
          <button className="btn primary big play" onClick={() => setPlaying(true)} disabled={!photos.length}><Play size={18} /> Play slideshow</button>
        </div>
      </main>
      <aside className="right-panel">
        <Section title="Playback" id="ss-play">
          <Slider label="Slide duration (s)" value={o.duration} min={1} max={20} step={0.5} def={4} onChange={(v) => set({ duration: v })} />
          <Slider label="Fade (s)" value={o.fade} min={0} max={4} step={0.1} def={1} onChange={(v) => set({ fade: v })} />
          <label className="check"><input type="checkbox" checked={o.zoom} onChange={(e) => set({ zoom: e.target.checked })} /> Slow pan and zoom</label>
          <div className="row"><span className="lbl">Order</span><Seg value={o.order} options={[['sort', 'Grid order'], ['random', 'Random']]} onChange={(v) => set({ order: v })} /></div>
        </Section>
        <Section title="Look" id="ss-look">
          <div className="row"><span className="lbl">Background</span><input type="color" value={o.bg} onChange={(e) => set({ bg: e.target.value })} /></div>
          <div className="row"><span className="lbl">Caption</span>
            <select value={o.caption} onChange={(e) => set({ caption: e.target.value })}><option value="none">None</option><option value="title">Title</option><option value="filename">File name</option><option value="caption">Caption</option><option value="exif">Exposure info</option></select></div>
        </Section>
        <Section title="Music" id="ss-music">
          <label className="btn small"><Music size={12} /> Choose audio file<input type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setMusic(URL.createObjectURL(f)); }} /></label>
          {music && <p className="hint">Music will play with the slideshow.</p>}
        </Section>
      </aside>
      {playing && <SlidePlayer photos={o.order === 'random' ? [...photos].sort(() => Math.random() - 0.5) : photos} o={o} music={music} onClose={() => setPlaying(false)} />}
    </div>
  );
}

function SlidePlayer({ photos, o, music, onClose }: { photos: Photo[]; o: any; music: string | null; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [paused, setPaused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const size = Math.round(Math.max(screen.width, screen.height) * Math.min(2, devicePixelRatio));
  useEffect(() => { ref.current?.requestFullscreen?.().catch(() => { /* ignore */ }); audio.current?.play().catch(() => { /* ignore */ }); return () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => { /* ignore */ }); }; }, []);
  useEffect(() => {
    // render the current and next slide
    for (const k of [i, (i + 1) % photos.length]) {
      const p = photos[k];
      if (!p || urls[p.id]) continue;
      renderForDisplay(p, size).then((c) => c.convertToBlob({ type: 'image/jpeg', quality: 0.92 })).then((b) => setUrls((u) => ({ ...u, [p.id]: URL.createObjectURL(b) })));
    }
  }, [i]);
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => setI((x) => (x + 1) % photos.length), o.duration * 1000);
    return () => clearTimeout(t);
  }, [i, paused]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((x) => (x + 1) % photos.length);
      if (e.key === 'ArrowLeft') setI((x) => (x - 1 + photos.length) % photos.length);
      if (e.key === ' ') { e.preventDefault(); setPaused((p) => !p); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const cap = (p: Photo) => o.caption === 'title' ? p.title : o.caption === 'filename' ? photoTitle(p) : o.caption === 'caption' ? p.caption : o.caption === 'exif' ? [p.exif.model, p.exif.focal && `${Math.round(p.exif.focal)}mm`, p.exif.fnumber && `f/${p.exif.fnumber}`, p.exif.iso && `ISO ${p.exif.iso}`].filter(Boolean).join('  ') : '';
  return (
    <div className="slideplayer" ref={ref} style={{ background: o.bg }} onClick={() => setPaused(!paused)}>
      {music && <audio ref={audio} src={music} loop />}
      {photos.map((p, k) => (k === i || k === (i - 1 + photos.length) % photos.length) && (
        <div key={p.id + ':' + (k === i ? i : 'prev')} className="slide" style={{ opacity: k === i ? 1 : 0, transition: `opacity ${o.fade}s` }}>
          {urls[p.id] ? <img src={urls[p.id]} alt="" className={o.zoom && k === i ? 'kenburns' : ''} style={{ animationDuration: `${o.duration + o.fade}s` }} /> : <Thumb p={p} />}
          {cap(p) && <div className="slide-cap">{cap(p)}</div>}
        </div>
      ))}
      <div className="slide-ctl" onClick={(e) => e.stopPropagation()}>
        <button className="icon" onClick={() => setI((i - 1 + photos.length) % photos.length)}><SkipBack size={18} /></button>
        <button className="icon" onClick={() => setPaused(!paused)}>{paused ? <Play size={18} /> : <Pause size={18} />}</button>
        <button className="icon" onClick={() => setI((i + 1) % photos.length)}><SkipForward size={18} /></button>
        <span>{i + 1} / {photos.length}</span>
        <button className="icon" onClick={onClose}><X size={18} /></button>
      </div>
    </div>
  );
}

// ======================= PRINT =======================

const PAGES: Record<string, [number, number]> = { 'Letter (8.5×11 in)': [612, 792], 'Legal (8.5×14 in)': [612, 1008], 'Tabloid (11×17 in)': [792, 1224], 'A4': [595.28, 841.89], 'A3': [841.89, 1190.55], 'A5': [419.53, 595.28], '4×6 in': [288, 432], '5×7 in': [360, 504], '8×10 in': [576, 720], '13×19 in': [936, 1368] };

export function PrintModule() {
  const photos = useScope();
  const prefs = useStore((s) => s.prefs);
  const o = { page: 'Letter (8.5×11 in)', landscape: false, layout: 'single', cols: 4, rows: 5, margin: 36, gap: 12, captions: true, fill: false, dpi: 300, border: 0, sharpen: true, ...(prefs.print || {}) };
  const set = (p: any) => store.savePrefs({ print: { ...o, ...p } });
  const [busy, setBusy] = useState(false);
  const [box, bw, bh] = useBox<HTMLDivElement>();
  let [pw, ph] = PAGES[o.page] || PAGES['Letter (8.5×11 in)'];
  if (o.landscape) [pw, ph] = [ph, pw];
  const cols = o.layout === 'single' ? 1 : o.layout === 'two' ? 1 : o.cols;
  const rows = o.layout === 'single' ? 1 : o.layout === 'two' ? 2 : o.rows;
  const perPage = cols * rows;
  const pages = Math.max(1, Math.ceil(photos.length / perPage));
  const cell = (k: number) => {
    const cw = (pw - o.margin * 2 - o.gap * (cols - 1)) / cols, chh = (ph - o.margin * 2 - o.gap * (rows - 1)) / rows - (o.captions && o.layout === 'contact' ? 14 : 0);
    const c = k % cols, r = Math.floor(k / cols) % rows;
    return { x: o.margin + c * (cw + o.gap), y: o.margin + r * (chh + o.gap + (o.captions && o.layout === 'contact' ? 14 : 0)), w: cw, h: chh };
  };
  const makePdf = async () => {
    setBusy(true);
    try {
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      let page: any = null;
      for (let k = 0; k < photos.length; k++) {
        if (k % perPage === 0) page = pdf.addPage([pw, ph]);
        const p = photos[k], b = cell(k);
        const px = Math.round((Math.max(b.w, b.h) / 72) * (o.layout === 'contact' ? 150 : o.dpi));
        const c = await renderForDisplay(p, Math.min(px, 6000));
        const img = await pdf.embedJpg(await canvasToBytes(c, 0.92));
        const ar = img.width / img.height;
        let w = b.w, h = b.w / ar;
        if (o.fill) { if (h < b.h) { h = b.h; w = h * ar; } } else if (h > b.h) { h = b.h; w = h * ar; }
        const x = b.x + (b.w - w) / 2, y = ph - b.y - b.h + (b.h - h) / 2;
        if (o.fill) {
          page.pushOperators(); // clip to the cell
          const { pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = await import('pdf-lib');
          page.pushOperators(pushGraphicsState(), rectangle(b.x, ph - b.y - b.h, b.w, b.h), clip(), endPath());
          page.drawImage(img, { x, y, width: w, height: h });
          page.pushOperators(popGraphicsState());
        } else page.drawImage(img, { x, y, width: w, height: h });
        if (o.border > 0) page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0, 0, 0), borderWidth: o.border, opacity: 0 });
        if (o.captions && o.layout === 'contact') page.drawText(photoTitle(p).slice(0, 40), { x: b.x, y: ph - b.y - b.h - 11, size: 7, font, color: rgb(0.2, 0.2, 0.2) });
        if (o.captions && o.layout !== 'contact' && p.title) page.drawText(p.title.slice(0, 80), { x: b.x, y: Math.max(8, ph - b.y - b.h - 16), size: 10, font, color: rgb(0.2, 0.2, 0.2) });
      }
      const bytes = await pdf.save();
      return new Blob([bytes], { type: 'application/pdf' });
    } finally { setBusy(false); }
  };
  // Fit the page preview inside the space it has (leaves room for the page counter).
  const scale = bw && bh ? Math.max(0.05, Math.min((bw - 24) / pw, (bh - 48) / ph, 560 / Math.max(pw, ph))) : 420 / Math.max(pw, ph);
  return (
    <div className="module print">
      <aside className="left-panel">
        <Section title="Layout style" id="pr-style">
          <Seg value={o.layout} options={[['single', 'Single'], ['two', 'Two up'], ['contact', 'Contact sheet']]} onChange={(v) => set({ layout: v })} />
          {o.layout === 'contact' && <><Slider label="Columns" value={o.cols} min={1} max={10} def={4} onChange={(v) => set({ cols: v })} /><Slider label="Rows" value={o.rows} min={1} max={12} def={5} onChange={(v) => set({ rows: v })} /></>}
        </Section>
        <Section title="Page" id="pr-page">
          <select value={o.page} onChange={(e) => set({ page: e.target.value })}>{Object.keys(PAGES).map((k) => <option key={k}>{k}</option>)}</select>
          <label className="check"><input type="checkbox" checked={o.landscape} onChange={(e) => set({ landscape: e.target.checked })} /> Landscape</label>
          <Slider label="Margins (pt)" value={o.margin} min={0} max={108} def={36} onChange={(v) => set({ margin: v })} />
          <Slider label="Gutter (pt)" value={o.gap} min={0} max={72} def={12} onChange={(v) => set({ gap: v })} />
        </Section>
      </aside>
      <main className="center">
        <div className="print-preview" ref={box}>
          <div className="paper" style={{ width: pw * scale, height: ph * scale }}>
            {photos.slice(0, perPage).map((p, k) => { const b = cell(k); return <div key={p.id} className="paper-cell" style={{ left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale }}><Thumb p={p} style={{ objectFit: o.fill ? 'cover' : 'contain' }} /></div>; })}
          </div>
          <p className="hint">Page 1 of {pages} · {photos.length} photo{photos.length === 1 ? '' : 's'}</p>
        </div>
      </main>
      <aside className="right-panel">
        <Section title="Image settings" id="pr-img">
          <label className="check"><input type="checkbox" checked={o.fill} onChange={(e) => set({ fill: e.target.checked })} /> Zoom to fill cell</label>
          <label className="check"><input type="checkbox" checked={o.captions} onChange={(e) => set({ captions: e.target.checked })} /> Captions (file name or title)</label>
          <Slider label="Stroke border (pt)" value={o.border} min={0} max={10} step={0.5} def={0} onChange={(v) => set({ border: v })} />
          <Slider label="Print resolution (ppi)" value={o.dpi} min={150} max={600} step={10} def={300} onChange={(v) => set({ dpi: v })} />
        </Section>
        <div className="panel-foot col">
          <button className="btn primary" disabled={busy || !photos.length} onClick={async () => { const b = await makePdf(); download(b, `ANCHOR Abyss print ${new Date().toISOString().slice(0, 10)}.pdf`); }}><Download size={14} /> {busy ? 'Rendering…' : 'Save as PDF'}</button>
          <button className="btn" disabled={busy || !photos.length} onClick={async () => { const b = await makePdf(); const u = URL.createObjectURL(b); const w = window.open(u); if (!w) download(b, 'print.pdf'); }}><Printer size={14} /> Print…</button>
        </div>
      </aside>
    </div>
  );
}

// ======================= BOOK =======================

const BOOK_SIZES: Record<string, [number, number]> = { 'Square 8×8 in': [576, 576], 'Square 12×12 in': [864, 864], 'Landscape 10×8 in': [720, 576], 'Landscape 13×11 in': [936, 792], 'Portrait 8×10 in': [576, 720], 'A4 Portrait': [595.28, 841.89] };
type BookPage = { layout: '1' | '2h' | '2v' | '3' | '4' | 'text'; ids: string[]; text?: string };

export function BookModule() {
  const photos = useScope();
  const prefs = useStore((s) => s.prefs);
  const o = { size: 'Square 8×8 in', title: 'My Photo Book', subtitle: '', margin: 36, gap: 10, bg: '#ffffff', auto: '1', ...(prefs.book || {}) };
  const set = (p: any) => store.savePrefs({ book: { ...o, ...p } });
  const [pages, setPages] = useState<BookPage[]>(() => prefs.bookPages || []);
  const [busy, setBusy] = useState(false);
  useEffect(() => { store.savePrefs({ bookPages: pages }); }, [pages]);
  const [pw, ph] = BOOK_SIZES[o.size];
  const autoLayout = () => {
    const per: Record<string, number> = { '1': 1, '2h': 2, '2v': 2, '3': 3, '4': 4 };
    const n = per[o.auto] || 1;
    const out: BookPage[] = [];
    for (let i = 0; i < photos.length; i += n) out.push({ layout: o.auto as any, ids: photos.slice(i, i + n).map((p) => p.id) });
    setPages(out);
  };
  const cells = (layout: BookPage['layout']) => {
    const m = o.margin, g = o.gap, W = pw - 2 * m, H = ph - 2 * m;
    switch (layout) {
      case '1': return [[m, m, W, H]];
      case '2h': return [[m, m, (W - g) / 2, H], [m + (W + g) / 2, m, (W - g) / 2, H]];
      case '2v': return [[m, m, W, (H - g) / 2], [m, m + (H + g) / 2, W, (H - g) / 2]];
      case '3': return [[m, m, W, (H - g) * 0.6], [m, m + (H - g) * 0.6 + g, (W - g) / 2, (H - g) * 0.4], [m + (W + g) / 2, m + (H - g) * 0.6 + g, (W - g) / 2, (H - g) * 0.4]];
      case '4': return [[m, m, (W - g) / 2, (H - g) / 2], [m + (W + g) / 2, m, (W - g) / 2, (H - g) / 2], [m, m + (H + g) / 2, (W - g) / 2, (H - g) / 2], [m + (W + g) / 2, m + (H + g) / 2, (W - g) / 2, (H - g) / 2]];
      default: return [];
    }
  };
  const exportPdf = async () => {
    setBusy(true);
    try {
      const { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = await import('pdf-lib');
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.HelveticaBold), font2 = await pdf.embedFont(StandardFonts.Helvetica);
      const bg = o.bg.match(/\w\w/g)!.map((h: string) => parseInt(h, 16) / 255);
      const cover = pdf.addPage([pw, ph]);
      cover.drawRectangle({ x: 0, y: 0, width: pw, height: ph, color: rgb(bg[0], bg[1], bg[2]) });
      const tw = font.widthOfTextAtSize(o.title, 28);
      cover.drawText(o.title, { x: (pw - tw) / 2, y: ph / 2, size: 28, font, color: rgb(0.1, 0.1, 0.12) });
      if (o.subtitle) { const sw = font2.widthOfTextAtSize(o.subtitle, 14); cover.drawText(o.subtitle, { x: (pw - sw) / 2, y: ph / 2 - 30, size: 14, font: font2, color: rgb(0.35, 0.35, 0.4) }); }
      for (const pg of pages) {
        const page = pdf.addPage([pw, ph]);
        page.drawRectangle({ x: 0, y: 0, width: pw, height: ph, color: rgb(bg[0], bg[1], bg[2]) });
        if (pg.layout === 'text') { page.drawText(pg.text || '', { x: o.margin, y: ph - o.margin - 14, size: 14, font: font2, maxWidth: pw - 2 * o.margin, lineHeight: 20, color: rgb(0.15, 0.15, 0.18) }); continue; }
        const cs = cells(pg.layout);
        for (let k = 0; k < cs.length; k++) {
          const p = store.s.photos.get(pg.ids[k]); if (!p) continue;
          const [x, y, w, h] = cs[k];
          const c = await renderForDisplay(p, Math.round((Math.max(w, h) / 72) * 300));
          const img = await pdf.embedJpg(await canvasToBytes(c));
          const ar = img.width / img.height;
          let iw = w, ih = w / ar; if (ih < h) { ih = h; iw = h * ar; }
          page.pushOperators(pushGraphicsState(), rectangle(x, ph - y - h, w, h), clip(), endPath());
          page.drawImage(img, { x: x + (w - iw) / 2, y: ph - y - h + (h - ih) / 2, width: iw, height: ih });
          page.pushOperators(popGraphicsState());
        }
      }
      download(new Blob([await pdf.save()], { type: 'application/pdf' }), `${o.title || 'Photo book'}.pdf`);
    } finally { setBusy(false); }
  };
  const sc = 180 / Math.max(pw, ph);
  return (
    <div className="module book">
      <aside className="left-panel">
        <Section title="Book settings" id="bk-set">
          <select value={o.size} onChange={(e) => set({ size: e.target.value })}>{Object.keys(BOOK_SIZES).map((k) => <option key={k}>{k}</option>)}</select>
          <label className="field small">Title<input value={o.title} onChange={(e) => set({ title: e.target.value })} /></label>
          <label className="field small">Subtitle<input value={o.subtitle} onChange={(e) => set({ subtitle: e.target.value })} /></label>
          <div className="row"><span className="lbl">Page colour</span><input type="color" value={o.bg} onChange={(e) => set({ bg: e.target.value })} /></div>
          <Slider label="Margins (pt)" value={o.margin} min={0} max={90} def={36} onChange={(v) => set({ margin: v })} />
          <Slider label="Gap (pt)" value={o.gap} min={0} max={40} def={10} onChange={(v) => set({ gap: v })} />
        </Section>
        <Section title="Auto layout" id="bk-auto">
          <select value={o.auto} onChange={(e) => set({ auto: e.target.value })}><option value="1">One photo per page</option><option value="2h">Two side by side</option><option value="2v">Two stacked</option><option value="3">Three (one large)</option><option value="4">Four grid</option></select>
          <button className="btn small" onClick={autoLayout} disabled={!photos.length}>Auto layout {photos.length} photos</button>
          <button className="btn small" onClick={() => setPages([...pages, { layout: 'text', ids: [], text: 'Your text here' }])}>Add text page</button>
          <button className="btn small" onClick={() => setPages([])}>Clear layout</button>
        </Section>
      </aside>
      <main className="center">
        <div className="book-pages">
          <div className="book-page cover" style={{ width: pw * sc, height: ph * sc, background: o.bg }}><b>{o.title}</b><span>{o.subtitle}</span></div>
          {pages.map((pg, i) => (
            <div key={i} className="book-page" style={{ width: pw * sc, height: ph * sc, background: o.bg }}>
              {pg.layout === 'text' ? <textarea value={pg.text} onChange={(e) => setPages(pages.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                : cells(pg.layout).map(([x, y, w, h], k) => { const p = store.s.photos.get(pg.ids[k]); return <div key={k} className="paper-cell" style={{ left: x * sc, top: y * sc, width: w * sc, height: h * sc }}
                  onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const ids = JSON.parse(e.dataTransfer.getData('text/abyss-ids') || '[]'); if (ids[0]) setPages(pages.map((xx, j) => { if (j !== i) return xx; const n = [...xx.ids]; n[k] = ids[0]; return { ...xx, ids: n }; })); }}>
                  {p ? <Thumb p={p} style={{ objectFit: 'cover' }} /> : <span className="hint">Drop a photo</span>}</div>; })}
              <div className="page-tools">
                <span>{i + 1}</span>
                <select value={pg.layout} onChange={(e) => setPages(pages.map((x, j) => (j === i ? { ...x, layout: e.target.value as any } : x)))}><option value="1">1</option><option value="2h">2 ↔</option><option value="2v">2 ↕</option><option value="3">3</option><option value="4">4</option><option value="text">Text</option></select>
                <button className="icon" onClick={() => setPages(pages.filter((_, j) => j !== i))}><X size={12} /></button>
              </div>
            </div>
          ))}
          {!pages.length && <p className="hint">Use Auto layout, then drag photos from the filmstrip onto pages to swap them.</p>}
        </div>
      </main>
      <aside className="right-panel">
        <div className="panel-foot col"><p className="hint">{pages.length + 1} pages including the cover.</p>
          <button className="btn primary" disabled={busy || !pages.length} onClick={exportPdf}><Download size={14} /> {busy ? 'Rendering…' : 'Export book as PDF'}</button></div>
      </aside>
    </div>
  );
}

// ======================= WEB =======================

export function WebModule() {
  const photos = useScope();
  const prefs = useStore((s) => s.prefs);
  const o = { title: 'My Gallery', subtitle: '', contact: '', size: 2048, thumb: 400, theme: 'dark', captions: true, layout: 'grid', ...(prefs.web || {}) };
  const set = (p: any) => store.savePrefs({ web: { ...o, ...p } });
  const [busy, setBusy] = useState<string | null>(null);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const build = async () => {
    const JSZip = (await import('jszip')).default;
    const z = new JSZip();
    const items: string[] = [];
    for (let k = 0; k < photos.length; k++) {
      setBusy(`Rendering ${k + 1} of ${photos.length}`);
      const p = photos[k];
      const big = await renderForDisplay(p, o.size);
      const small = await renderForDisplay(p, o.thumb);
      const n = String(k + 1).padStart(3, '0');
      z.file(`images/${n}.jpg`, await big.convertToBlob({ type: 'image/jpeg', quality: 0.88 }));
      z.file(`thumbs/${n}.jpg`, await small.convertToBlob({ type: 'image/jpeg', quality: 0.82 }));
      const cap = esc(p.title || p.caption || photoTitle(p));
      items.push(`<a href="images/${n}.jpg" data-cap="${cap}"><img loading="lazy" src="thumbs/${n}.jpg" alt="${cap}">${o.captions ? `<span>${cap}</span>` : ''}</a>`);
    }
    const dark = o.theme === 'dark';
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title)}</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:${dark ? '#0d1117' : '#f6f7f9'};color:${dark ? '#e6edf3' : '#1b1f24'}}header{padding:32px 24px 8px}h1{margin:0;font-weight:600}p{opacity:.7;margin:6px 0}
.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;padding:16px 24px 40px}.g a{display:block;text-decoration:none;color:inherit}.g img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;display:block}.g span{font-size:13px;opacity:.75;display:block;padding:4px 2px}
#lb{position:fixed;inset:0;background:rgba(0,0,0,.92);display:none;align-items:center;justify-content:center;flex-direction:column}#lb img{max-width:94vw;max-height:86vh}#lb div{color:#ddd;margin-top:10px;font-size:14px}footer{padding:24px;opacity:.6;font-size:13px}</style></head>
<body><header><h1>${esc(o.title)}</h1>${o.subtitle ? `<p>${esc(o.subtitle)}</p>` : ''}</header><main class="g">${items.join('\n')}</main>${o.contact ? `<footer>${esc(o.contact)}</footer>` : ''}
<div id="lb"><img><div></div></div><script>const a=[...document.querySelectorAll('.g a')],lb=document.getElementById('lb'),im=lb.querySelector('img'),cp=lb.querySelector('div');let i=0;function show(k){i=(k+a.length)%a.length;im.src=a[i].href;cp.textContent=a[i].dataset.cap;lb.style.display='flex'}a.forEach((x,k)=>x.onclick=e=>{e.preventDefault();show(k)});lb.onclick=()=>lb.style.display='none';onkeydown=e=>{if(lb.style.display!=='flex')return;if(e.key==='ArrowRight')show(i+1);if(e.key==='ArrowLeft')show(i-1);if(e.key==='Escape')lb.style.display='none'}</script></body></html>`;
    z.file('index.html', html);
    setBusy('Packaging…');
    download(await z.generateAsync({ type: 'blob' }), `${o.title || 'gallery'}.zip`);
    setBusy(null);
  };
  return (
    <div className="module web">
      <aside className="left-panel">
        <Section title="Site info" id="web-info">
          <label className="field small">Title<input value={o.title} onChange={(e) => set({ title: e.target.value })} /></label>
          <label className="field small">Subtitle<input value={o.subtitle} onChange={(e) => set({ subtitle: e.target.value })} /></label>
          <label className="field small">Contact / footer<input value={o.contact} onChange={(e) => set({ contact: e.target.value })} /></label>
        </Section>
      </aside>
      <main className="center">
        <div className={'web-preview ' + o.theme}>
          <h1>{o.title}</h1>{o.subtitle && <p>{o.subtitle}</p>}
          <div className="web-grid">{photos.slice(0, 48).map((p) => <div key={p.id}><Thumb p={p} />{o.captions && <span>{p.title || photoTitle(p)}</span>}</div>)}</div>
        </div>
      </main>
      <aside className="right-panel">
        <Section title="Appearance" id="web-look">
          <Seg value={o.theme} options={[['dark', 'Dark'], ['light', 'Light']]} onChange={(v) => set({ theme: v })} />
          <label className="check"><input type="checkbox" checked={o.captions} onChange={(e) => set({ captions: e.target.checked })} /> Show captions</label>
          <Slider label="Large image size (px)" value={o.size} min={800} max={4096} step={64} def={2048} onChange={(v) => set({ size: v })} />
          <Slider label="Thumbnail size (px)" value={o.thumb} min={200} max={800} step={20} def={400} onChange={(v) => set({ thumb: v })} />
        </Section>
        <div className="panel-foot col"><p className="hint">Creates a self-contained gallery (HTML + images) you can upload to any web host.</p>
          <button className="btn primary" disabled={!!busy || !photos.length} onClick={build}><Download size={14} /> {busy || `Export gallery (${photos.length})`}</button></div>
      </aside>
    </div>
  );
}
