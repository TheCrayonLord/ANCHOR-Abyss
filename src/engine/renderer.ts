import { VERT, GEOM, DOWN, GAUSS, BILATERAL, MAIN } from './shaders';
import { type Settings, profileDef } from './settings';
import { type Geom } from './geometry';
import { bakeCurveLUT, isIdentity, LUT_SIZE } from './curve';

type Tex = { tex: WebGLTexture; w: number; h: number; fmt: number };
type FB = { fb: WebGLFramebuffer; tex: Tex[]; key: string; busy: boolean };

export interface RenderOpts {
  outW: number; outH: number;
  win?: [number, number, number, number];
  target: 'screen' | 'read';
  clip?: boolean;
  overlayMask?: number;
  overlayColor?: [number, number, number];
  bg?: [number, number, number];
  neutral?: boolean;
  level?: 'preview' | 'full';
}

// half-float conversion table for 16-bit encoded input
let HALF: Uint16Array | null = null;
function halfTable() {
  if (HALF) return HALF;
  HALF = new Uint16Array(65536);
  const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  for (let i = 0; i < 65536; i++) {
    f[0] = i / 65535;
    const x = u[0];
    const sign = (x >>> 16) & 0x8000;
    let e = ((x >>> 23) & 0xff) - 127 + 15;
    let m = (x >>> 13) & 0x3ff;
    if (e <= 0) { m = ((x & 0x7fffff) | 0x800000) >>> (1 - e + 13); e = 0; m &= 0x3ff; }
    else if (e >= 31) { e = 31; m = 0; }
    HALF[i] = sign | (e << 10) | m;
  }
  return HALF;
}

export function toHalf(data: Uint16Array): Uint16Array {
  const t = halfTable();
  const out = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = t[data[i]];
  return out;
}

function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}
const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export function tintOffset(h: number, s: number, k: number): [number, number, number] {
  const c = hsv2rgb(((h % 360) + 360) % 360 / 360, 1, 1);
  const l = luma(c);
  return [(c[0] - l) * s * k, (c[1] - l) * s * k, (c[2] - l) * s * k];
}

/** Camera calibration: rotate/saturate the three primaries, keep white neutral. */
export function calibMatrix(c: Settings['calib']): number[] {
  const cols: number[][] = [];
  const prim = [[0, c.redHue, c.redSat], [1 / 3, c.greenHue, c.greenSat], [2 / 3, c.blueHue, c.blueSat]];
  for (const [h, dh, ds] of prim) {
    const s = Math.max(0, 1 + (ds / 100) * 0.5);
    const rgb = hsv2rgb((((h + (dh / 100) * (25 / 360)) % 1) + 1) % 1, 1, 1);
    const l = 1 / 3;
    cols.push(rgb.map((v) => l + (v - l) * s));
  }
  // M has primaries as columns; normalise rows so white stays white
  const M = [0, 1, 2].map((r) => [cols[0][r], cols[1][r], cols[2][r]]);
  // blend toward identity so the default is exact identity
  const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const id = [0, 1, 2].map((r) => [0, 1, 2].map((cc) => I[r][cc]));
  const base = [0, 1, 2].map((r) => [hsv2rgb(0, 1, 1)[r], hsv2rgb(1 / 3, 1, 1)[r], hsv2rgb(2 / 3, 1, 1)[r]]);
  const out: number[][] = [0, 1, 2].map((r) => [0, 1, 2].map((cc) => id[r][cc] + (M[r][cc] - base[r][cc])));
  for (const row of out) { const sum = row[0] + row[1] + row[2]; for (let i = 0; i < 3; i++) row[i] /= sum || 1; }
  return out.flat();
}

export class Renderer {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  progs: Record<string, { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> }> = {};
  vao: WebGLVertexArrayObject;
  pool: FB[] = [];
  src: Record<string, Tex | null> = { preview: null, full: null };
  srcDims: Record<string, [number, number]> = {};
  maskA: Tex; maskB: Tex; lut: Tex;
  lutKey = '';
  air: [number, number, number] = [0.9, 0.92, 0.95];
  floatOK: boolean;
  maxTex: number;
  lost = false;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL 2 is not available in this browser. ANCHOR Abyss needs it for image processing.');
    this.gl = gl;
    this.floatOK = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    for (const [k, fs] of Object.entries({ geom: GEOM, down: DOWN, gauss: GAUSS, bil: BILATERAL, main: MAIN })) this.progs[k] = this.compile(VERT, fs);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    for (const k of Object.keys(this.progs)) {
      const loc = gl.getAttribLocation(this.progs[k].p, 'a_pos');
      if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); }
    }
    this.maskA = this.makeTex(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.maskB = this.makeTex(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.lut = this.makeTex(LUT_SIZE, 1, gl.RGBA16F, gl.RGBA, gl.FLOAT, bakeCurveLUT({ highlights: 0, lights: 0, darks: 0, shadows: 0, s1: 25, s2: 50, s3: 75, master: [[0, 0], [1, 1]], red: [[0, 0], [1, 1]], green: [[0, 0], [1, 1]], blue: [[0, 0], [1, 1]] }));
    if ('addEventListener' in canvas) (canvas as HTMLCanvasElement).addEventListener('webglcontextlost', () => { this.lost = true; });
  }

  compile(vs: string, fs: string) {
    const gl = this.gl;
    const mk = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'a_pos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
    return { p, u: new Map<string, WebGLUniformLocation | null>() };
  }

  makeTex(w: number, h: number, internal: number, format: number, type: number, data: ArrayBufferView | null): Tex {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { tex, w, h, fmt: internal };
  }

  /** data: RGB, 16-bit gamma-encoded (0..65535). */
  setSource(level: 'preview' | 'full', w: number, h: number, data: Uint16Array) {
    const gl = this.gl;
    const old = this.src[level];
    if (old) gl.deleteTexture(old.tex);
    this.src[level] = this.makeTex(w, h, gl.RGB16F, gl.RGB, gl.HALF_FLOAT, toHalf(data));
    this.srcDims[level] = [w, h];
  }

  hasSource(level: 'preview' | 'full') { return !!this.src[level]; }

  dropSource(level: 'preview' | 'full') {
    const t = this.src[level];
    if (t) this.gl.deleteTexture(t.tex);
    this.src[level] = null;
  }

  setMasks(w: number, h: number, A: Uint8Array | null, B: Uint8Array | null) {
    const gl = this.gl;
    gl.deleteTexture(this.maskA.tex); gl.deleteTexture(this.maskB.tex);
    if (!A || !B) { w = 1; h = 1; A = new Uint8Array(4); B = new Uint8Array(4); }
    this.maskA = this.makeTex(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, A);
    this.maskB = this.makeTex(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, B);
  }

  setAir(a: [number, number, number]) { this.air = a; }

  fb(w: number, h: number, n = 1, fmt?: number): FB {
    const gl = this.gl;
    const f = fmt ?? (this.floatOK ? gl.RGBA16F : gl.RGBA8);
    const key = `${w}x${h}x${n}x${f}`;
    let e = this.pool.find((p) => p.key === key && !p.busy);
    if (!e) {
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      const tex: Tex[] = [];
      for (let i = 0; i < n; i++) {
        const fi = i === 0 ? f : gl.RGBA8;
        const t = this.makeTex(w, h, fi, gl.RGBA, fi === gl.RGBA8 ? gl.UNSIGNED_BYTE : gl.HALF_FLOAT, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t.tex, 0);
        tex.push(t);
      }
      e = { fb, tex, key, busy: false };
      this.pool.push(e);
      // keep the pool bounded
      if (this.pool.length > 40) {
        const idle = this.pool.filter((p) => !p.busy && p !== e);
        for (const p of idle.slice(0, idle.length - 20)) { gl.deleteFramebuffer(p.fb); p.tex.forEach((t) => gl.deleteTexture(t.tex)); this.pool.splice(this.pool.indexOf(p), 1); }
      }
    }
    e.busy = true;
    return e;
  }

  releaseAll() { for (const p of this.pool) p.busy = false; }

  purge() {
    const gl = this.gl;
    for (const p of this.pool) { gl.deleteFramebuffer(p.fb); p.tex.forEach((t) => gl.deleteTexture(t.tex)); }
    this.pool = [];
  }

  use(name: string) {
    const pr = this.progs[name];
    this.gl.useProgram(pr.p);
    return (n: string) => {
      if (!pr.u.has(n)) pr.u.set(n, this.gl.getUniformLocation(pr.p, n));
      return pr.u.get(n)!;
    };
  }

  bindTex(unit: number, t: Tex | null, loc: WebGLUniformLocation | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t ? t.tex : null);
    gl.uniform1i(loc, unit);
  }

  draw(target: FB | null, w: number, h: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    if (target) gl.drawBuffers(target.tex.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  blur(src: Tex, sigma: number): Tex {
    const gl = this.gl;
    let cur = src, f = 1;
    while (sigma / f > 3 && cur.w > 16 && cur.h > 16) {
      const w = Math.max(1, Math.ceil(cur.w / 2)), h = Math.max(1, Math.ceil(cur.h / 2));
      const t = this.fb(w, h);
      const u = this.use('down');
      this.bindTex(0, cur, u('u_tex'));
      gl.uniform2f(u('u_texel'), 1 / cur.w, 1 / cur.h);
      this.draw(t, w, h);
      cur = t.tex[0]; f *= 2;
    }
    const s = sigma / f;
    const a = this.fb(cur.w, cur.h), b = this.fb(cur.w, cur.h);
    let u = this.use('gauss');
    this.bindTex(0, cur, u('u_tex'));
    gl.uniform2f(u('u_dir'), 1 / cur.w, 0); gl.uniform1f(u('u_sigma'), s);
    this.draw(a, cur.w, cur.h);
    u = this.use('gauss');
    this.bindTex(0, a.tex[0], u('u_tex'));
    gl.uniform2f(u('u_dir'), 0, 1 / cur.h); gl.uniform1f(u('u_sigma'), s);
    this.draw(b, cur.w, cur.h);
    return b.tex[0];
  }

  render(s: Settings, g: Geom, o: RenderOpts): Uint8Array | null {
    if (this.lost) return null;
    const gl = this.gl;
    const level = o.level && this.src[o.level] ? o.level : this.src.preview ? 'preview' : 'full';
    const src = this.src[level];
    if (!src) return null;
    const win = o.win || [0, 0, 1, 1];
    const W = Math.max(1, Math.round(o.outW)), H = Math.max(1, Math.round(o.outH));
    const prof = profileDef(s.profile);
    const pa = s.profileAmount / 100;

    // ---- pass 1: geometry ----
    const geo = this.fb(W, H, 3);
    let u = this.use('geom');
    this.bindTex(0, src, u('u_src'));
    this.bindTex(1, this.maskA, u('u_maskA'));
    this.bindTex(2, this.maskB, u('u_maskB'));
    gl.uniform4f(u('u_win'), win[0], win[1], win[2], win[3]);
    gl.uniform2f(u('u_cropC'), g.cropC[0], g.cropC[1]);
    gl.uniform2f(u('u_axisU'), g.axisU[0], g.axisU[1]);
    gl.uniform2f(u('u_axisV'), g.axisV[0], g.axisV[1]);
    const m = g.Hinv;
    gl.uniformMatrix3fv(u('u_Hinv'), false, [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
    gl.uniform1f(u('u_k'), o.neutral ? 0 : g.k); gl.uniform1f(u('u_rnorm'), g.rnorm);
    gl.uniform1f(u('u_caR'), o.neutral ? 0 : g.caR); gl.uniform1f(u('u_caB'), o.neutral ? 0 : g.caB);
    gl.uniform1f(u('u_A'), g.A);
    gl.uniform3f(u('u_or0'), g.orient[0], g.orient[1], g.orient[2]);
    gl.uniform3f(u('u_or1'), g.orient[3], g.orient[4], g.orient[5]);
    gl.uniform2f(u('u_lensVig'), o.neutral ? 0 : s.lens.vignette / 100, (s.lens.vignetteMid - 50) / 25);
    gl.uniform1i(u('u_flipY'), 0);
    this.draw(geo, W, H);
    const img = geo.tex[0];

    // ---- blurs ----
    const L = Math.max(g.OW, g.OH);
    const outScale = W / (win[2] * g.outW);
    const loc = s.masks.filter((mk) => mk.visible).slice(0, 8);
    const anyLoc = (k: keyof Settings['masks'][0]['adj']) => loc.some((mk) => mk.adj[k] !== 0);
    const need = {
      small: !o.neutral && (s.sharpen.amount > 0 || anyLoc('sharpness') || s.lens.purple > 0 || s.lens.green > 0),
      tex: !o.neutral && (s.texture !== 0 || anyLoc('texture') || s.nr.color > 0 || s.nr.lum > 0 || s.sharpen.amount > 0),
      clar: !o.neutral && (s.clarity !== 0 || anyLoc('clarity')),
      base: !o.neutral && (s.highlights !== 0 || s.shadows !== 0 || anyLoc('highlights') || anyLoc('shadows')),
      haze: !o.neutral && (s.dehaze !== 0 || anyLoc('dehaze')),
      den: !o.neutral && (s.nr.lum > 0 || anyLoc('noise')),
    };
    const bSmall = need.small ? this.blur(img, Math.max(0.5, s.sharpen.radius * Math.min(outScale, 1.5) * 0.9)) : img;
    const bTex = need.tex ? this.blur(img, Math.max(0.8, 0.0022 * L * outScale)) : img;
    const bClar = need.clar ? this.blur(img, Math.max(1.5, 0.018 * L * outScale)) : img;
    const bBase = need.base ? this.blur(img, Math.max(2, 0.03 * L * outScale)) : img;
    const bHaze = need.haze ? this.blur(img, Math.max(3, 0.05 * L * outScale)) : img;
    let den = img;
    if (need.den) {
      const d = this.fb(W, H);
      u = this.use('bil');
      this.bindTex(0, img, u('u_tex'));
      gl.uniform2f(u('u_texel'), 1 / W, 1 / H);
      const nr = Math.max(s.nr.lum, ...loc.map((mk) => mk.adj.noise * mk.amount / 100));
      gl.uniform1f(u('u_range'), 0.02 + (nr / 100) * 0.12);
      gl.uniform1f(u('u_step'), Math.max(1, Math.min(3, outScale * 1.5)));
      this.draw(d, W, H);
      den = d.tex[0];
    }

    // ---- curve LUT ----
    const fade = prof.fade ? prof.fade * pa : 0;
    const ckey = JSON.stringify([s.curve, fade]);
    const hasCurve = !isIdentity(s.curve) || fade > 0;
    if (hasCurve && ckey !== this.lutKey) {
      gl.deleteTexture(this.lut.tex);
      this.lut = this.makeTex(LUT_SIZE, 1, gl.RGBA16F, gl.RGBA, gl.FLOAT, bakeCurveLUT(s.curve, fade));
      this.lutKey = ckey;
    }

    // ---- main pass ----
    const out = o.target === 'screen' ? null : this.fb(W, H, 1, gl.RGBA8);
    u = this.use('main');
    const texs: [string, Tex][] = [['u_img', img], ['u_ma', geo.tex[1]], ['u_mb', geo.tex[2]], ['u_bSmall', bSmall], ['u_bTex', bTex], ['u_bClar', bClar], ['u_bBase', bBase], ['u_bHaze', bHaze], ['u_den', den], ['u_lut', this.lut]];
    texs.forEach(([n, t], i) => this.bindTex(i, t, u(n)));
    gl.uniform4f(u('u_win'), win[0], win[1], win[2], win[3]);
    gl.uniform1i(u('u_flipY'), o.target === 'screen' ? 1 : 0);
    gl.uniform1i(u('u_neutral'), o.neutral ? 1 : 0);
    const P = (k: keyof typeof prof) => ((prof[k] as number) || 0) * pa;
    gl.uniform4f(u('u_g0'), (s.temp + P('temp')) / 100, (s.tint + P('tint')) / 100, s.exposure, (s.contrast + P('contrast')) / 100);
    gl.uniform4f(u('u_g1'), s.highlights / 100, s.shadows / 100, s.whites / 100, s.blacks / 100);
    gl.uniform4f(u('u_g2'), s.texture / 100, s.clarity / 100, s.dehaze / 100, (s.vibrance + P('vibrance')) / 100);
    gl.uniform4f(u('u_g3'), (s.saturation + P('saturation')) / 100, s.sharpen.amount / 100 * Math.min(1, outScale * 1.2 + 0.2), s.sharpen.detail / 100, s.sharpen.masking / 100);
    gl.uniform4f(u('u_g4'), s.nr.lum / 100, s.nr.lumDetail / 100, s.nr.color / 100, s.nr.lumContrast / 100);
    gl.uniform3f(u('u_wbBase'), 1, 1, 1);
    const arr = (a: number[], extra?: number[]) => a.map((v, i) => (v + (extra ? extra[i] * pa : 0)) / 100);
    gl.uniform1fv(u('u_hue'), arr(s.hsl.hue, prof.hslHue));
    gl.uniform1fv(u('u_sat'), arr(s.hsl.sat, prof.hslSat));
    gl.uniform1fv(u('u_lum'), arr(s.hsl.lum, prof.hslLum));
    gl.uniform1fv(u('u_bw'), arr(s.bw));
    gl.uniform1i(u('u_bwMode'), s.treatment === 'bw' || prof.bw ? 1 : 0);
    gl.uniform1i(u('u_hasCurve'), hasCurve ? 1 : 0);
    const gr = s.grade, pg = prof.grade || {};
    const zone = (z: [number, number, number], pz?: [number, number, number]) => {
      const t = tintOffset(z[0], z[1] / 100, 0.22);
      const out4 = [...t, (z[2] / 100) * 0.35];
      if (pz) { const t2 = tintOffset(pz[0], (pz[1] / 100) * pa, 0.22); for (let i = 0; i < 3; i++) out4[i] += t2[i]; }
      return out4;
    };
    gl.uniform4fv(u('u_gSh'), zone(gr.sh, pg.sh as any));
    gl.uniform4fv(u('u_gMid'), zone(gr.mid, pg.mid as any));
    gl.uniform4fv(u('u_gHi'), zone(gr.hi, pg.hi as any));
    gl.uniform4fv(u('u_gGl'), zone(gr.global, pg.global as any));
    gl.uniform2f(u('u_gBal'), 0.5 - (gr.balance / 100) * 0.3, 0.12 + (gr.blending / 100) * 0.45);
    const cm = calibMatrix(s.calib);
    gl.uniformMatrix3fv(u('u_calib'), false, [cm[0], cm[3], cm[6], cm[1], cm[4], cm[7], cm[2], cm[5], cm[8]]);
    gl.uniform1f(u('u_shadowTint'), s.calib.shadowTint / 100);
    const v = s.vignette;
    gl.uniform4f(u('u_vig'), v.amount / 100, v.midpoint / 100, v.roundness / 100, v.feather / 100);
    gl.uniform2f(u('u_vig2'), v.highlights / 100, v.style === 'highlight' ? 0 : v.style === 'color' ? 1 : 2);
    gl.uniform1f(u('u_fullAspect'), g.outW / g.outH);
    gl.uniform4f(u('u_grain'), s.grain.amount / 100, s.grain.size / 100, s.grain.roughness / 100, 7.31);
    gl.uniform2f(u('u_fullSize'), g.outW, g.outH);
    gl.uniform4f(u('u_fringe'), s.lens.purple / 20, s.lens.purpleLo, s.lens.purpleHi, s.lens.green / 20);
    gl.uniform2f(u('u_fringe2'), s.lens.greenLo, s.lens.greenHi);
    gl.uniform3f(u('u_air'), this.air[0], this.air[1], this.air[2]);
    gl.uniform1i(u('u_maskCount'), loc.length);
    const L40 = new Float32Array(160), R24 = new Float32Array(96);
    loc.forEach((mk, i) => {
      const a = mk.adj;
      const c = tintOffset(a.colorH, a.colorS / 100, 0.18);
      L40.set([a.temp / 100, a.tint / 100, a.exposure, a.contrast / 100, a.highlights / 100, a.shadows / 100, a.whites / 100, a.blacks / 100, a.texture / 100, a.clarity / 100, a.dehaze / 100, a.hue / 100, a.saturation / 100, a.sharpness / 100, Math.max(0, a.noise) / 100, mk.amount / 100, c[0], c[1], c[2], a.colorS / 100], i * 20);
      const lr = mk.lumRange, cr = mk.colorRange;
      R24.set([lr.on ? 1 : 0, lr.lo, lr.hi, lr.feather, cr.on ? 1 : 0, cr.r, cr.g, cr.b, 0.04 + (cr.tol / 100) * 0.6, 0, 0, 0], i * 12);
    });
    gl.uniform4fv(u('u_loc'), L40);
    gl.uniform4fv(u('u_rng'), R24);
    gl.uniform1i(u('u_clip'), o.clip ? 1 : 0);
    gl.uniform1i(u('u_overlay'), o.overlayMask ?? -1);
    const oc = o.overlayColor || [1, 0.15, 0.25];
    gl.uniform3f(u('u_overlayColor'), oc[0], oc[1], oc[2]);
    const bg = o.bg || [0.08, 0.09, 0.12];
    gl.uniform3f(u('u_bg'), bg[0], bg[1], bg[2]);
    if (!out) {
      if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    }
    this.draw(out, W, H);
    let px: Uint8Array | null = null;
    if (out) {
      px = new Uint8Array(W * H * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.fb);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    this.releaseAll();
    return px;
  }
}
