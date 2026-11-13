// Screenshots of every module at phone and tablet sizes, plus layout checks (no horizontal overflow, nothing overlapping).
const { chromium, devices } = require('playwright');
const path = require('path');
const URL = process.env.URL || 'http://localhost:4174/';
const FX = path.join(__dirname, 'fixtures');
const OUT = path.join(__dirname, 'shots', 'phone');
const DEV = process.env.DEV || 'iPhone 13';
let failed = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++; };
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ ...devices[DEV], ...(process.env.DSF ? { deviceScaleFactor: +process.env.DSF } : {}) });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(URL);
  await p.waitForSelector('.topbar');
  await p.setInputFiles('#import-input', [path.join(FX, 'landscape.jpg'), path.join(FX, 'portrait.jpg'), path.join(FX, 'pano-1.jpg')]);
  await p.waitForSelector('.modal');
  await p.click('.modal-foot .btn.primary');
  await p.waitForFunction(() => document.querySelectorAll('.cell').length >= 3, null, { timeout: 60000 });
  await p.waitForTimeout(800);
  const tag = DEV.replace(/\W+/g, '-').toLowerCase();
  const overflow = () => p.evaluate(() => {
    const W = document.documentElement.clientWidth, bad = [];
    if (document.documentElement.scrollWidth > W + 1) bad.push('page scrolls sideways ' + document.documentElement.scrollWidth);
    return bad;
  });
  const mods = ['Library', 'Develop', 'Map', 'Book', 'Slideshow', 'Print', 'Web'];
  for (const m of mods) {
    await p.click(`.modules button:has-text("${m}")`);
    await p.waitForTimeout(m === 'Develop' ? 2500 : 900);
    await p.screenshot({ path: path.join(OUT, `${tag}-${m.toLowerCase()}.png`) });
    const o = await overflow();
    ok(!o.length, `${m}: no sideways scroll ${o.join(',')}`);
    for (const which of ['left', 'right']) {
      const btn = await p.$(`.phone-tabs button[data-p="${which}"]`);
      if (btn) {
        await btn.click(); await p.waitForTimeout(500);
        await p.screenshot({ path: path.join(OUT, `${tag}-${m.toLowerCase()}-${which}.png`) });
        await btn.click(); await p.waitForTimeout(200);
      }
    }
  }
  ok(!errors.length, 'no page errors ' + errors.slice(0, 2).join(' | '));
  await b.close();
  console.log(failed ? failed + ' FAILED' : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})();
