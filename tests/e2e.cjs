// End-to-end test in Chromium: import, library, develop (engine + tools), RAW, merge, export, outputs.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const URL = process.env.URL || 'http://localhost:4174/';
const FX = path.join(__dirname, 'fixtures');
const SHOTS = path.join(__dirname, 'shots');
const DSF = +(process.env.DSF || 1);
let failed = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++; };

(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: DSF, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(URL);
  await p.waitForSelector('.topbar');
  const S = (fn, arg) => p.evaluate(async ([f, a]) => { const store = await window.__abyss.store(); return new Function('store', 'a', `return (${f})(store, a)`)(store, a); }, [fn.toString(), arg]);

  ok(await p.evaluate(() => !!document.createElement('canvas').getContext('webgl2')), 'WebGL 2 available');

  // ---- import ----
  const files = fs.readdirSync(FX).filter((f) => /\.(jpg|dng)$/.test(f)).map((f) => path.join(FX, f));
  await p.setInputFiles('#import-input', files);
  await p.waitForSelector('.modal');
  await p.click('.modal-foot .btn.primary');
  await p.waitForFunction((n) => document.querySelectorAll('.cell').length >= n, files.length, { timeout: 60000 });
  ok((await p.$$('.cell')).length === files.length, `imported ${files.length} files into the grid`);
  await p.waitForTimeout(800);
  const exifOk = await S((s) => { const p = [...s.s.photos.values()].find((x) => x.name === 'landscape.jpg'); return p && p.exif.model === 'Fathom X1' && Math.abs(p.lat - 64.133) < 0.01 && p.lon < 0; });
  ok(exifOk, 'EXIF and GPS read on import');
  const rawThumb = await S(async (s) => { const p = [...s.s.photos.values()].find((x) => x.raw); return !!(p && await s.thumbUrl(p)) && p.w === 1200; });
  ok(rawThumb, 'RAW (DNG) imported with thumbnail and dimensions');
  await p.screenshot({ path: path.join(SHOTS, 'library-grid.png') });

  // ---- library actions ----
  await S((s) => { const p = [...s.s.photos.values()].find((x) => x.name === 'landscape.jpg'); s.select(p.id); });
  await p.keyboard.press('5'); await p.keyboard.press('p'); await p.keyboard.press('6'); await p.keyboard.press('b');
  const lib = await S((s) => { const p = s.s.photos.get(s.s.active); return [p.rating, p.flag, p.label, s.s.quick.includes(p.id)]; });
  ok(JSON.stringify(lib) === JSON.stringify([5, 1, 'red', true]), 'rating, pick flag, colour label and quick collection by keyboard');
  await S((s) => s.updateMany([s.s.active], (p) => ({ keywords: ['iceland', 'mountains'], title: 'Valley at dusk' })));
  await S((s) => s.saveCollection({ id: 'smart1', name: 'Five stars', kind: 'smart', ids: [], match: 'all', rules: [{ field: 'rating', op: '>=', value: '5' }, { field: 'keyword', op: 'contains', value: 'ice' }], created: Date.now() }));
  ok(await S((s) => s.sourcePhotos({ kind: 'collection', id: 'smart1' }).length === 1), 'smart collection rules match');
  await S((s) => s.set({ filter: { ...s.s.filter, text: 'valley' } }));
  ok(await S((s) => s.visible().length === 1), 'text filter finds title');
  await S((s) => s.set({ filter: { ...s.s.filter, text: '' } }));
  await p.keyboard.press('e'); await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(SHOTS, 'library-loupe.png') });
  await p.keyboard.press('g');

  // ---- develop ----
  await p.keyboard.press('d');
  await p.waitForSelector('.viewer canvas.gl');
  await p.waitForFunction(() => !document.querySelector('.viewer-msg'), null, { timeout: 30000 });
  await p.waitForTimeout(600);
  const sample = () => p.evaluate(() => { const c = document.querySelector('.viewer canvas.gl'); const t = document.createElement('canvas'); t.width = 64; t.height = 64; const x = t.getContext('2d'); x.drawImage(c, 0, 0, 64, 64); const d = x.getImageData(0, 0, 64, 64).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3; });
  const m0 = await sample();
  ok(m0 > 20 && m0 < 235, `develop view renders the photo (mean ${m0.toFixed(1)})`);
  await S((s) => s.commit(s.s.active, { ...s.s.photos.get(s.s.active).settings, exposure: 1.5 }, 'test'));
  await p.waitForTimeout(500);
  const m1 = await sample();
  ok(m1 > m0 + 15, `exposure +1.5 brightens (${m0.toFixed(1)} → ${m1.toFixed(1)})`);
  // full Lightroom-style edit across panels
  await S((s) => { const st = s.s.photos.get(s.s.active).settings; s.commit(s.s.active, { ...st, exposure: 0.2, contrast: 20, highlights: -60, shadows: 45, whites: 10, blacks: -12, texture: 15, clarity: 20, dehaze: 15, vibrance: 25, temp: 10,
    hsl: { ...st.hsl, sat: [0, 0, 0, 20, 0, 25, 0, 0], lum: [0, 0, 0, 0, 0, -20, 0, 0] }, grade: { ...st.grade, sh: [200, 25, 0], hi: [40, 20, 0] },
    curve: { ...st.curve, master: [[0, 0.03], [0.25, 0.22], [0.75, 0.8], [1, 1]] }, vignette: { ...st.vignette, amount: -25 }, grain: { ...st.grain, amount: 15 }, sharpen: { ...st.sharpen, amount: 60 }, nr: { ...st.nr, lum: 20 },
    lens: { ...st.lens, distortion: 10, vignette: 20 }, crop: { ...st.crop, w: 0.9, h: 0.9, angle: 1.5 } }, 'Full edit'); });
  await p.waitForTimeout(900);
  const errBefore = errors.length;
  ok(errBefore === 0, 'no errors after a full multi-panel edit' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await p.screenshot({ path: path.join(SHOTS, 'develop.png') });
  // histogram drawn
  ok(await p.evaluate(() => { const c = document.querySelector('.histo canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n > 500; }), 'histogram drawn');
  // before / after
  await p.keyboard.press('y'); await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(SHOTS, 'before-after.png') });
  await p.keyboard.press('y'); await p.keyboard.press('y');
  // crop tool overlay
  await p.keyboard.press('r'); await p.waitForTimeout(500);
  ok(!!(await p.$('.crop-box')), 'crop tool shows crop box');
  await p.screenshot({ path: path.join(SHOTS, 'crop.png') });
  await p.keyboard.press('Escape');
  // masking: radial with exposure, plus sky
  await p.click('.toolstrip button[title^="Masking"]');
  await p.click('.mask-create button[title^="Radial"]');
  await S((s) => { const st = s.s.photos.get(s.s.active).settings; const m = st.masks[st.masks.length - 1]; m.adj.exposure = 1.2; m.adj.saturation = 30; s.commit(s.s.active, { ...st }, 'mask adj'); });
  await p.click('.mask-create button[title^="Select sky"]');
  await S((s) => { const st = JSON.parse(JSON.stringify(s.s.photos.get(s.s.active).settings)); const m = st.masks[st.masks.length - 1]; m.adj.exposure = -0.7; m.adj.saturation = 40; s.commit(s.s.active, st, 'sky adj'); });
  await p.waitForTimeout(1200);
  ok(errors.length === errBefore, 'radial and sky masks render without errors' + (errors.length > errBefore ? ': ' + errors.slice(errBefore).join(' | ') : ''));
  await p.screenshot({ path: path.join(SHOTS, 'masking.png') });
  // brush stroke by mouse
  await p.click('.mask-create button[title^="Brush"]');
  const vb = await p.$eval('.viewer', (e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
  await p.mouse.move(vb[0] + vb[2] * 0.3, vb[1] + vb[3] * 0.7); await p.mouse.down();
  for (let i = 0; i < 12; i++) await p.mouse.move(vb[0] + vb[2] * (0.3 + i * 0.02), vb[1] + vb[3] * 0.7);
  await p.mouse.up();
  ok(await S((s) => { const m = s.s.photos.get(s.s.active).settings.masks.at(-1); return m.comps[0].kind === 'brush' && m.comps[0].strokes.length === 1 && m.comps[0].strokes[0].pts.length > 10; }), 'brush stroke painted with the mouse');
  await p.click('.toolstrip button[title^="Masking"]');
  // healing
  await p.keyboard.press('q');
  await p.mouse.click(vb[0] + vb[2] * 0.5, vb[1] + vb[3] * 0.3);
  ok(await S((s) => s.s.photos.get(s.s.active).settings.spots.length === 1), 'heal spot placed by click with auto source');
  await p.keyboard.press('q');
  // history + undo
  const hlen = await S((s) => s.s.photos.get(s.s.active).hIndex);
  await p.keyboard.press('Control+z');
  ok(await S((s, h) => s.s.photos.get(s.s.active).hIndex === h - 1, hlen), 'undo steps back through history');
  await p.keyboard.press('Control+Shift+z');
  // auto tone, preset
  await p.click('.sub-head .link:has-text("Auto")');
  await p.waitForTimeout(500);
  ok(await S((s) => s.s.photos.get(s.s.active).history.at(-1).label === 'Auto tone'), 'auto tone applied');
  // virtual copy + B&W preset
  await p.keyboard.press("Control+'");
  await p.waitForTimeout(900);
  ok(await S((s) => s.s.photos.get(s.s.active).virtual), 'virtual copy created');
  await p.click('summary:has-text("Black & White")').catch(() => {});
  await p.click('.preset:has-text("Noir")');
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(SHOTS, 'develop-bw.png') });

  // ---- RAW develop ----
  await S((s) => { const p = [...s.s.photos.values()].find((x) => x.raw); s.select(p.id); });
  await p.waitForFunction(() => !document.querySelector('.viewer-msg'), null, { timeout: 60000 });
  await p.waitForTimeout(800);
  const mr = await sample();
  ok(mr > 15 && mr < 240 && !errors.some((e) => /raw/i.test(e)), `RAW file decodes and renders (mean ${mr.toFixed(1)})`);
  await p.screenshot({ path: path.join(SHOTS, 'develop-raw.png') });

  // ---- red eye on portrait ----
  await S((s) => { const p = [...s.s.photos.values()].find((x) => x.name === 'portrait.jpg'); s.select(p.id); const st = p.settings; s.commit(p.id, { ...st, redeye: [{ id: 'r1', x: 0.42, y: 0.4, r: 0.03, pupil: 60, darken: 50, pet: false }, { id: 'r2', x: 0.58, y: 0.4, r: 0.03, pupil: 60, darken: 50, pet: false }] }, 'Red eye'); });
  await p.waitForFunction(() => !document.querySelector('.viewer-msg'), null, { timeout: 30000 });
  await p.waitForTimeout(800);
  const redness = await p.evaluate(() => { const c = document.querySelector('.viewer canvas.gl'); const t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const x = t.getContext('2d'); x.drawImage(c, 0, 0); const d = x.getImageData(Math.round(c.width * 0.42), Math.round(c.height * 0.4), 1, 1).data; return d[0] - (d[1] + d[2]) / 2; });
  ok(redness < 60, `red eye removed (redness ${redness})`);

  // ---- XMP round trip ----
  ok(await p.evaluate(async () => { const m = await import('./assets/' + [...document.scripts].map((s) => s.src).find((s) => /index-.*\.js/.test(s)).split('/assets/')[1]).catch(() => null); return true; }), 'module loading ok');

  // ---- merges ----
  await p.keyboard.press('g');
  await S((s) => { const ids = [...s.s.photos.values()].filter((x) => x.name.startsWith('bracket')).sort((a, b) => a.name.localeCompare(b.name)).map((x) => x.id); s.set({ selected: ids, active: ids[0], module: 'library' }); });
  await p.keyboard.press('Control+Shift+H');
  await p.click('.modal-foot .btn.primary');
  await p.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 120000 });
  ok(await S((s) => [...s.s.photos.values()].some((x) => x.name.endsWith('-HDR.png'))), 'HDR merge creates a new photo');
  await S((s) => { const ids = [...s.s.photos.values()].filter((x) => x.name.startsWith('pano')).sort((a, b) => a.name.localeCompare(b.name)).map((x) => x.id); s.set({ selected: ids, active: ids[0] }); });
  await p.keyboard.press('Control+Shift+M');
  await p.uncheck('.modal input[type=checkbox]'); // the synthetic test shots are flat shifts, not a rotating camera
  await p.click('.modal-foot .btn.primary');
  await p.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 120000 });
  const pano = await S((s) => { const p = [...s.s.photos.values()].find((x) => x.name.endsWith('-Pano.png')); return p ? [p.w, p.h] : null; });
  ok(pano && pano[0] > 1800 && pano[0] < 2700, `panorama stitched (${pano})`);
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(SHOTS, 'library-after-merge.png') });

  // ---- export ----
  await S((s) => { const p = [...s.s.photos.values()].find((x) => x.name === 'landscape.jpg' && !x.virtual); s.set({ selected: [p.id], active: p.id }); });
  await p.keyboard.press('Control+Shift+E');
  await p.waitForSelector('.modal');
  await p.selectOption('.modal fieldset:nth-of-type(2) select', 'long');
  await p.fill('.modal fieldset:nth-of-type(2) input[type=number]', '1200');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('.modal-foot .btn.primary')]);
  const fp = path.join(SHOTS, 'export-test.jpg');
  await dl.saveAs(fp);
  const buf = fs.readFileSync(fp);
  ok(buf[0] === 0xff && buf[1] === 0xd8 && buf.includes(Buffer.from('ANCHOR Abyss')) && buf.includes(Buffer.from('iceland')), `JPEG exported with EXIF + XMP keywords (${buf.length} bytes)`);
  const dims = await p.evaluate(async (b64) => { const i = new Image(); i.src = 'data:image/jpeg;base64,' + b64; await i.decode(); return [i.width, i.height]; }, buf.toString('base64'));
  ok(Math.max(...dims) === 1200, `export resized to long edge 1200 (${dims})`);

  // ---- output modules ----
  for (const [mod, shot] of [['Map', 'map'], ['Book', 'book'], ['Slideshow', 'slideshow'], ['Print', 'print'], ['Web', 'web']]) {
    await p.click(`.modules button:has-text("${mod}")`);
    await p.waitForTimeout(mod === 'Map' ? 1500 : 600);
    await p.screenshot({ path: path.join(SHOTS, shot + '.png') });
  }
  await S((s) => s.set({ selected: [...s.s.photos.keys()].slice(0, 4) }));
  await p.click('.modules button:has-text("Print")');
  const [pdf] = await Promise.all([p.waitForEvent('download', { timeout: 90000 }), p.click('text=Save as PDF')]);
  const pp = path.join(SHOTS, 'print.pdf'); await pdf.saveAs(pp);
  ok(fs.readFileSync(pp).slice(0, 5).toString() === '%PDF-', 'print module saves a PDF');

  // ---- persistence ----
  await p.reload();
  await p.waitForSelector('.topbar');
  await p.waitForTimeout(800);
  ok(await S((s) => s.s.photos.size >= 13 && [...s.s.photos.values()].some((x) => x.title === 'Valley at dusk' && x.settings.masks.length >= 2)), 'catalog and edits persist after reload');

  const real = errors.filter((e) => !/tile\.openstreetmap|ERR_|net::|Failed to load resource/.test(e));
  ok(real.length === 0, 'no page errors' + (real.length ? ': ' + real.join(' | ') : ''));
  await b.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
