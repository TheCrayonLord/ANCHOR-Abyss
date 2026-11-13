// Touch checks on a phone: sideways swipe on a slider changes it, vertical swipe scrolls the panel instead, pinch zooms the photo.
const { chromium, devices } = require('playwright');
const path = require('path');
const URL = process.env.URL || 'http://localhost:4174/';
let failed = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++; };
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  await p.goto(URL); await p.waitForSelector('.topbar');
  await p.setInputFiles('#import-input', [path.join(__dirname, 'fixtures', 'landscape.jpg')]);
  await p.waitForSelector('.modal'); await p.click('.modal-foot .btn.primary');
  await p.waitForSelector('.cell'); await p.waitForTimeout(500);
  // tap once selects, second tap opens loupe
  await p.tap('.cell'); await p.waitForTimeout(300); if (await p.$('.cell')) { await p.tap('.cell'); await p.waitForTimeout(400); }
  ok(await p.evaluate(async () => (await window.__abyss.store()).s.libView === 'loupe'), 'second tap on a photo opens it large');
  await p.click('.modules button:has-text("Develop")'); await p.waitForTimeout(2500);
  const cdp = await ctx.newCDPSession(p);
  const swipe = async (x0, y0, x1, y1, steps = 8) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(300);
  };
  const expo = () => p.evaluate(async () => { const s = (await window.__abyss.store()); const ph = s.s.photos.get(s.s.active); return ph.history[ph.hIndex].s.exposure; });
  const tr = await p.$('.slider:has(label:text-is("Exposure")) .slider-track');
  await tr.scrollIntoViewIfNeeded(); await p.waitForTimeout(200);
  const bb = await tr.boundingBox();
  console.log('track', JSON.stringify(bb), await p.$eval('.right-panel', (el) => [el.scrollHeight, el.clientHeight, el.scrollTop]));
  await swipe(bb.x + bb.width / 2, bb.y + 2, bb.x + bb.width / 2 + 60, bb.y + 4);
  const e1 = await expo();
  ok(e1 > 0.3, `sideways swipe on Exposure raises it (${e1})`);
  const st0 = await p.$eval('.right-panel', (el) => el.scrollTop);
  await swipe(bb.x + bb.width / 2, bb.y + 2, bb.x + bb.width / 2 + 3, bb.y - 150, 12);
  const st1 = await p.$eval('.right-panel', (el) => el.scrollTop);
  ok(await expo() === e1, 'vertical swipe over a slider leaves it alone');
  ok(st1 > st0, `vertical swipe scrolls the sheet (${st0} → ${st1})`);
  const vb = await (await p.$('.viewer')).boundingBox();
  const cx = vb.x + vb.width / 2, cy = vb.y + vb.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 20, y: cy, id: 1 }, { x: cx + 20, y: cy, id: 2 }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - 20 - i * 10, y: cy, id: 1 }, { x: cx + 20 + i * 10, y: cy, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(500);
  const zoomed = await p.$eval('.nav-zoom, .zoom-label, .viewer', () => true).catch(() => false);
  const fitOn = await p.evaluate(() => [...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Fit' && x.classList.contains('on')));
  ok(!fitOn, 'pinch zooms the photo in');
  await p.screenshot({ path: path.join(__dirname, 'shots', 'phone', 'touch-develop.png') });
  await b.close();
  console.log(failed ? failed + ' FAILED' : 'ALL PASSED'); process.exit(failed ? 1 : 0);
})();
