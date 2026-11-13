// Builds a small, valid Bayer DNG from a fixture JPEG so the RAW decode path can be tested offline.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const src = fs.readFileSync(path.join(__dirname, 'fixtures/landscape.jpg')).toString('base64');
  const { w, h, px } = await p.evaluate(async (s) => {
    const img = new Image(); img.src = 'data:image/jpeg;base64,' + s; await img.decode();
    const W = 1200, H = 800; const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0, W, H);
    return { w: W, h: H, px: Array.from(x.getImageData(0, 0, W, H).data) };
  }, src);
  await b.close();
  const black = 512, white = 16383;
  const cfa = Buffer.alloc(w * h * 2);
  const neutral = [0.5, 1, 0.7]; // camera-native white balance (R and B sensitivities)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = (y % 2 === 0) ? (x % 2 === 0 ? 0 : 1) : (x % 2 === 0 ? 1 : 2); // RGGB
    const v = Math.pow(px[(y * w + x) * 4 + ch] / 255, 2.2) * neutral[ch] * 0.8;
    cfa.writeUInt16LE(Math.round(black + v * (white - black)), (y * w + x) * 2);
  }
  // ---- TIFF writer ----
  const entries = [];
  const extra = [];
  let extraOff = 0;
  const T = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5, SRATIONAL: 10 };
  const add = (tag, type, vals) => entries.push({ tag, type, vals });
  add(254, T.LONG, [0]); add(256, T.LONG, [w]); add(257, T.LONG, [h]); add(258, T.SHORT, [16]); add(259, T.SHORT, [1]);
  add(262, T.SHORT, [32803]); add(271, T.ASCII, 'Fathom\0'); add(272, T.ASCII, 'Fathom RAW1\0'); add(273, T.LONG, [0]);
  add(274, T.SHORT, [1]); add(277, T.SHORT, [1]); add(278, T.LONG, [h]); add(279, T.LONG, [cfa.length]); add(284, T.SHORT, [1]);
  add(33421, T.SHORT, [2, 2]); add(33422, T.BYTE, [0, 1, 1, 2]);
  add(50706, T.BYTE, [1, 4, 0, 0]); add(50707, T.BYTE, [1, 1, 0, 0]); add(50708, T.ASCII, 'Fathom RAW1\0');
  add(50714, T.LONG, [black]); add(50717, T.LONG, [white]);
  // ColorMatrix1: XYZ -> camera (sRGB-like with the neutral scaling folded in)
  const M = [[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]].map((r, i) => r.map((v) => v * neutral[i] * 0.8));
  add(50721, T.SRATIONAL, M.flat().map((v) => [Math.round(v * 10000), 10000]));
  add(50778, T.SHORT, [21]);
  add(50728, T.RATIONAL, neutral.map((v) => [Math.round(v * 10000), 10000]));
  entries.sort((a, b) => a.tag - b.tag);
  const sizeOf = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 10: 8 };
  const ifdSize = 2 + entries.length * 12 + 4;
  const ifdOff = 8;
  let dataOff = ifdOff + ifdSize;
  const ifd = Buffer.alloc(ifdSize);
  ifd.writeUInt16LE(entries.length, 0);
  const blobs = [];
  entries.forEach((e, i) => {
    const count = e.type === T.ASCII ? e.vals.length : e.vals.length;
    const bytes = sizeOf[e.type] * count;
    const buf = Buffer.alloc(Math.max(4, bytes));
    if (e.type === T.ASCII) buf.write(e.vals, 0, 'latin1');
    else e.vals.forEach((v, k) => {
      if (e.type === T.BYTE) buf.writeUInt8(v, k);
      else if (e.type === T.SHORT) buf.writeUInt16LE(v, k * 2);
      else if (e.type === T.LONG) buf.writeUInt32LE(v, k * 4);
      else if (e.type === T.RATIONAL) { buf.writeUInt32LE(v[0], k * 8); buf.writeUInt32LE(v[1], k * 8 + 4); }
      else if (e.type === T.SRATIONAL) { buf.writeInt32LE(v[0], k * 8); buf.writeInt32LE(v[1], k * 8 + 4); }
    });
    const o = 2 + i * 12;
    ifd.writeUInt16LE(e.tag, o); ifd.writeUInt16LE(e.type, o + 2); ifd.writeUInt32LE(count, o + 4);
    if (bytes <= 4) buf.copy(ifd, o + 8, 0, 4);
    else { ifd.writeUInt32LE(dataOff, o + 8); blobs.push(buf); dataOff += buf.length + (buf.length % 2); if (buf.length % 2) blobs.push(Buffer.alloc(1)); }
    if (e.tag === 273) e.patch = o + 8;
  });
  const stripOff = dataOff;
  ifd.writeUInt32LE(stripOff, entries.find((e) => e.tag === 273).patch);
  const head = Buffer.from([0x49, 0x49, 42, 0, 8, 0, 0, 0]);
  fs.writeFileSync(path.join(__dirname, 'fixtures/raw-test.dng'), Buffer.concat([head, ifd, ...blobs, cfa]));
  console.log('wrote raw-test.dng', w, h);
})();
