// Generates synthetic test photos (and app icons) with Chromium, then adds EXIF with piexifjs.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const piexif = require('piexifjs');
const out = path.join(__dirname, 'fixtures');

const scene = `
function scene(W, H, ev, shiftX, wide) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const k = Math.pow(2, ev);
  const S = wide || W;
  x.save(); x.translate(-shiftX, 0);
  const sky = x.createLinearGradient(0, 0, 0, H * 0.6);
  sky.addColorStop(0, 'rgb(40,90,170)'); sky.addColorStop(1, 'rgb(170,200,230)');
  x.fillStyle = sky; x.fillRect(0, 0, S, H);
  x.fillStyle = 'rgba(255,240,200,0.95)'; x.beginPath(); x.arc(S * 0.72, H * 0.18, H * 0.06, 0, 7); x.fill();
  for (let i = 0; i < 6; i++) { x.fillStyle = 'rgba(255,255,255,0.75)'; x.beginPath(); x.ellipse(S * (0.1 + i * 0.16), H * (0.12 + (i % 3) * 0.05), H * 0.09, H * 0.03, 0, 0, 7); x.fill(); }
  x.fillStyle = 'rgb(70,80,100)'; x.beginPath(); x.moveTo(0, H * 0.6);
  for (let i = 0; i <= 24; i++) x.lineTo((S * i) / 24, H * (0.42 + 0.1 * Math.sin(i * 1.7) + 0.05 * Math.cos(i * 3.1)));
  x.lineTo(S, H * 0.6); x.fill();
  const g = x.createLinearGradient(0, H * 0.58, 0, H); g.addColorStop(0, 'rgb(60,120,50)'); g.addColorStop(1, 'rgb(30,60,25)');
  x.fillStyle = g; x.fillRect(0, H * 0.58, S, H);
  for (let i = 0; i < 40; i++) { const tx = (S * ((i * 37) % 100)) / 100, ty = H * (0.62 + ((i * 13) % 30) / 100); x.fillStyle = 'rgb(20,' + (50 + (i * 7) % 40) + ',20)'; x.beginPath(); x.moveTo(tx, ty - H * 0.08); x.lineTo(tx - H * 0.025, ty); x.lineTo(tx + H * 0.025, ty); x.fill(); }
  x.fillStyle = 'rgb(180,60,40)'; x.fillRect(S * 0.3, H * 0.66, H * 0.12, H * 0.09);
  x.fillStyle = 'rgb(120,40,30)'; x.beginPath(); x.moveTo(S * 0.3 - H * 0.01, H * 0.66); x.lineTo(S * 0.3 + H * 0.06, H * 0.61); x.lineTo(S * 0.3 + H * 0.13, H * 0.66); x.fill();
  x.restore();
  // noise + exposure
  const d = x.getImageData(0, 0, W, H);
  for (let i = 0; i < d.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    for (let ch = 0; ch < 3; ch++) { const lin = Math.pow(d.data[i + ch] / 255, 2.2) * k; d.data[i + ch] = Math.min(255, Math.max(0, Math.pow(lin, 1 / 2.2) * 255 + n)); }
  }
  x.putImageData(d, 0, 0);
  return c.toDataURL('image/jpeg', 0.92);
}
function portrait(W, H) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = 'rgb(200,205,210)'; x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgb(225,180,150)'; x.beginPath(); x.ellipse(W / 2, H * 0.45, W * 0.22, H * 0.3, 0, 0, 7); x.fill();
  for (const ex of [W * 0.42, W * 0.58]) { x.fillStyle = '#fff'; x.beginPath(); x.ellipse(ex, H * 0.4, W * 0.04, H * 0.02, 0, 0, 7); x.fill(); x.fillStyle = 'rgb(210,30,30)'; x.beginPath(); x.arc(ex, H * 0.4, W * 0.015, 0, 7); x.fill(); }
  x.fillStyle = 'rgb(160,70,70)'; x.fillRect(W * 0.45, H * 0.56, W * 0.1, H * 0.015);
  for (let i = 0; i < 8; i++) { x.fillStyle = 'rgb(120,70,50)'; x.beginPath(); x.arc(W * (0.38 + (i * 0.031)), H * (0.5 + (i % 2) * 0.03), W * 0.006, 0, 7); x.fill(); }
  return c.toDataURL('image/jpeg', 0.92);
}
`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent('<html><body></body></html>');
  await p.addScriptTag({ content: scene });
  const save = (name, dataUrl, exif) => {
    let bin = Buffer.from(dataUrl.split(',')[1], 'base64').toString('binary');
    if (exif) bin = piexif.insert(piexif.dump(exif), bin);
    fs.writeFileSync(path.join(out, name), Buffer.from(bin, 'binary'));
  };
  const ex = (o) => {
    const z = {}, e = {}, g = {};
    z[piexif.ImageIFD.Make] = 'Fathom'; z[piexif.ImageIFD.Model] = o.model || 'Fathom X1';
    e[piexif.ExifIFD.DateTimeOriginal] = o.date || '2026:06:21 19:42:10';
    e[piexif.ExifIFD.ISOSpeedRatings] = o.iso || 200; e[piexif.ExifIFD.FNumber] = [56, 10]; e[piexif.ExifIFD.ExposureTime] = [1, 250];
    e[piexif.ExifIFD.FocalLength] = [240, 10]; e[piexif.ExifIFD.FocalLengthIn35mmFilm] = 24; e[piexif.ExifIFD.LensModel] = 'Fathom 24mm F2.8';
    if (o.gps) { g[piexif.GPSIFD.GPSLatitudeRef] = 'N'; g[piexif.GPSIFD.GPSLatitude] = [[64, 1], [8, 1], [0, 1]]; g[piexif.GPSIFD.GPSLongitudeRef] = 'W'; g[piexif.GPSIFD.GPSLongitude] = [[21, 1], [56, 1], [0, 1]]; }
    return { '0th': z, Exif: e, GPS: g };
  };
  save('landscape.jpg', await p.evaluate(() => scene(2400, 1600, 0, 0)), ex({ gps: true }));
  save('landscape-dark.jpg', await p.evaluate(() => scene(1800, 1200, -1.6, 0)), ex({ iso: 3200, date: '2026:06:22 21:10:00' }));
  save('portrait.jpg', await p.evaluate(() => portrait(1200, 1600)), ex({ model: 'Fathom P2' }));
  for (const [i, ev] of [[1, -1.5], [2, 0], [3, 1.5]]) save(`bracket-${i}.jpg`, await p.evaluate(([e, s]) => scene(1500, 1000, e, s, 1500), [ev, i === 3 ? 6 : 0]), ex({}));
  for (const i of [0, 1, 2]) save(`pano-${i + 1}.jpg`, await p.evaluate((k) => scene(1000, 900, 0, k * 650, 2300), i), ex({}));
  // icons
  const svg = fs.readFileSync(path.join(__dirname, '../public/icon.svg'), 'utf8');
  for (const s of [192, 512]) {
    await p.setViewportSize({ width: s, height: s });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
    await p.screenshot({ path: path.join(__dirname, `../public/icon-${s}.png`), omitBackground: true });
  }
  await b.close();
  console.log(fs.readdirSync(out));
})();
