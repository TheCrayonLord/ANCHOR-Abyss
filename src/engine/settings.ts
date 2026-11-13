// Develop settings: the complete, non-destructive description of an edit.
// Every slider uses the same ranges people know from desktop raw editors:
// most are -100..100, exposure is -5..+5 stops.

export type Pt = [number, number];

export interface LocalAdj {
  temp: number; tint: number;
  exposure: number; contrast: number; highlights: number; shadows: number; whites: number; blacks: number;
  texture: number; clarity: number; dehaze: number;
  hue: number; saturation: number;
  sharpness: number; noise: number;
  colorH: number; colorS: number; // tint colour (0..360, 0..100)
}

export type MaskMode = 'add' | 'subtract' | 'intersect';

export interface BrushStroke { pts: number[]; size: number; feather: number; flow: number; density: number; erase: boolean; autoMask: boolean }

export type MaskComp =
  | { kind: 'brush'; mode: MaskMode; strokes: BrushStroke[] }
  | { kind: 'linear'; mode: MaskMode; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'radial'; mode: MaskMode; cx: number; cy: number; rx: number; ry: number; angle: number; feather: number; invert: boolean }
  | { kind: 'sky'; mode: MaskMode; strength: number }
  | { kind: 'subject'; mode: MaskMode; strength: number }
  | { kind: 'all'; mode: MaskMode };

export interface ColorRange { on: boolean; r: number; g: number; b: number; tol: number }
export interface LumRange { on: boolean; lo: number; hi: number; feather: number }

export interface Mask {
  id: string; name: string; visible: boolean; invert: boolean; amount: number;
  comps: MaskComp[];
  colorRange: ColorRange; lumRange: LumRange;
  adj: LocalAdj;
}

export interface Spot { id: string; mode: 'heal' | 'clone'; x: number; y: number; sx: number; sy: number; r: number; feather: number; opacity: number }
export interface RedEye { id: string; x: number; y: number; r: number; pupil: number; darken: number; pet: boolean }

export interface Settings {
  v: 1;
  profile: string; profileAmount: number;
  treatment: 'color' | 'bw';
  wb: 'asShot' | 'auto' | 'custom' | 'daylight' | 'cloudy' | 'shade' | 'tungsten' | 'fluorescent' | 'flash';
  temp: number; tint: number;
  exposure: number; contrast: number; highlights: number; shadows: number; whites: number; blacks: number;
  texture: number; clarity: number; dehaze: number; vibrance: number; saturation: number;
  curve: { highlights: number; lights: number; darks: number; shadows: number; s1: number; s2: number; s3: number; master: Pt[]; red: Pt[]; green: Pt[]; blue: Pt[] };
  hsl: { hue: number[]; sat: number[]; lum: number[] };
  bw: number[];
  grade: { sh: [number, number, number]; mid: [number, number, number]; hi: [number, number, number]; global: [number, number, number]; blending: number; balance: number };
  sharpen: { amount: number; radius: number; detail: number; masking: number };
  nr: { lum: number; lumDetail: number; lumContrast: number; color: number; colorDetail: number; colorSmooth: number };
  lens: { profile: boolean; distortion: number; vignette: number; vignetteMid: number; ca: boolean; caRed: number; caBlue: number; purple: number; purpleLo: number; purpleHi: number; green: number; greenLo: number; greenHi: number };
  transform: { upright: 'off' | 'level' | 'vertical' | 'auto' | 'guided'; vertical: number; horizontal: number; rotate: number; aspect: number; scale: number; x: number; y: number; constrain: boolean };
  crop: { cx: number; cy: number; w: number; h: number; angle: number; aspect: string; constrain: boolean };
  orient: number; flipH: boolean; flipV: boolean;
  vignette: { amount: number; midpoint: number; roundness: number; feather: number; highlights: number; style: 'highlight' | 'color' | 'paint' };
  grain: { amount: number; size: number; roughness: number };
  calib: { shadowTint: number; redHue: number; redSat: number; greenHue: number; greenSat: number; blueHue: number; blueSat: number };
  masks: Mask[];
  spots: Spot[];
  redeye: RedEye[];
}

export const HSL_BANDS = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'];

export const LOCAL_ZERO: LocalAdj = {
  temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  texture: 0, clarity: 0, dehaze: 0, hue: 0, saturation: 0, sharpness: 0, noise: 0, colorH: 0, colorS: 0,
};

export const LINEAR: Pt[] = [[0, 0], [1, 1]];

export function defaultSettings(): Settings {
  return {
    v: 1,
    profile: 'color', profileAmount: 100,
    treatment: 'color',
    wb: 'asShot', temp: 0, tint: 0,
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0,
    curve: { highlights: 0, lights: 0, darks: 0, shadows: 0, s1: 25, s2: 50, s3: 75, master: [[0, 0], [1, 1]], red: [[0, 0], [1, 1]], green: [[0, 0], [1, 1]], blue: [[0, 0], [1, 1]] },
    hsl: { hue: [0, 0, 0, 0, 0, 0, 0, 0], sat: [0, 0, 0, 0, 0, 0, 0, 0], lum: [0, 0, 0, 0, 0, 0, 0, 0] },
    bw: [-12, -6, 6, -18, -14, 8, 12, 6],
    grade: { sh: [0, 0, 0], mid: [0, 0, 0], hi: [0, 0, 0], global: [0, 0, 0], blending: 50, balance: 0 },
    sharpen: { amount: 40, radius: 1.0, detail: 25, masking: 0 },
    nr: { lum: 0, lumDetail: 50, lumContrast: 0, color: 25, colorDetail: 50, colorSmooth: 50 },
    lens: { profile: false, distortion: 0, vignette: 0, vignetteMid: 50, ca: false, caRed: 0, caBlue: 0, purple: 0, purpleLo: 270, purpleHi: 320, green: 0, greenLo: 75, greenHi: 115 },
    transform: { upright: 'off', vertical: 0, horizontal: 0, rotate: 0, aspect: 0, scale: 100, x: 0, y: 0, constrain: false },
    crop: { cx: 0.5, cy: 0.5, w: 1, h: 1, angle: 0, aspect: 'original', constrain: true },
    orient: 0, flipH: false, flipV: false,
    vignette: { amount: 0, midpoint: 50, roundness: 0, feather: 50, highlights: 0, style: 'highlight' },
    grain: { amount: 0, size: 25, roughness: 50 },
    calib: { shadowTint: 0, redHue: 0, redSat: 0, greenHue: 0, greenSat: 0, blueHue: 0, blueSat: 0 },
    masks: [], spots: [], redeye: [],
  };
}

export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

/** Fill in anything missing (older catalogs, partial presets). */
export function normalize(s: Partial<Settings> | undefined): Settings {
  const d = defaultSettings();
  if (!s) return d;
  const out: any = clone(d);
  for (const k of Object.keys(s) as (keyof Settings)[]) {
    const v: any = (s as any)[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof (d as any)[k] === 'object' && !Array.isArray((d as any)[k])) out[k] = { ...(d as any)[k], ...v };
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function newMask(name: string, comp: MaskComp): Mask {
  return { id: uid(), name, visible: true, invert: false, amount: 100, comps: [comp], colorRange: { on: false, r: 0.5, g: 0.5, b: 0.5, tol: 30 }, lumRange: { on: false, lo: 0, hi: 1, feather: 0.1 }, adj: { ...LOCAL_ZERO } };
}

/** True when the settings differ from defaults in anything visible. */
export function isEdited(s: Settings): boolean {
  const d = defaultSettings();
  return JSON.stringify(s) !== JSON.stringify(d);
}

// ---------- Setting groups (used by copy/paste/sync, presets and history labels) ----------

export const GROUPS: Record<string, (keyof Settings)[]> = {
  'Profile': ['profile', 'profileAmount'],
  'Treatment': ['treatment'],
  'White balance': ['wb', 'temp', 'tint'],
  'Basic tone': ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'],
  'Presence': ['texture', 'clarity', 'dehaze', 'vibrance', 'saturation'],
  'Tone curve': ['curve'],
  'Color mixer': ['hsl', 'bw'],
  'Color grading': ['grade'],
  'Sharpening': ['sharpen'],
  'Noise reduction': ['nr'],
  'Lens corrections': ['lens'],
  'Transform': ['transform'],
  'Crop': ['crop', 'orient', 'flipH', 'flipV'],
  'Effects': ['vignette', 'grain'],
  'Calibration': ['calib'],
  'Masking': ['masks'],
  'Spot removal': ['spots', 'redeye'],
};

export function pick(s: Settings, groups: string[]): Partial<Settings> {
  const out: any = {};
  for (const g of groups) for (const k of GROUPS[g] || []) out[k] = clone((s as any)[k]);
  return out;
}

export function apply(base: Settings, part: Partial<Settings>): Settings {
  const out: any = clone(base);
  for (const k of Object.keys(part)) out[k] = clone((part as any)[k]);
  return normalize(out);
}

/** Short label for history: what changed between a and b. */
export function describeChange(a: Settings, b: Settings): string {
  const changed: string[] = [];
  const simple: (keyof Settings)[] = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'texture', 'clarity', 'dehaze', 'vibrance', 'saturation', 'temp', 'tint'];
  for (const k of simple) if ((a as any)[k] !== (b as any)[k]) {
    const v = (b as any)[k] as number;
    changed.push(`${label(k)} ${v > 0 ? '+' : ''}${k === 'exposure' ? v.toFixed(2) : Math.round(v)}`);
  }
  if (changed.length) return changed.slice(0, 2).join(', ');
  for (const [g, keys] of Object.entries(GROUPS)) if (keys.some((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))) return g;
  return 'Edit';
}

export function label(k: string): string {
  return ({ temp: 'Temp', tint: 'Tint' } as any)[k] || k.charAt(0).toUpperCase() + k.slice(1);
}

// ---------- Profiles ----------
// A profile is a starting look applied underneath the sliders. Amount (0..200) scales it.

export interface ProfileDef { id: string; name: string; group: string; bw?: boolean; contrast?: number; saturation?: number; vibrance?: number; curve?: Pt[]; temp?: number; tint?: number; grade?: Partial<Settings['grade']>; hslSat?: number[]; hslHue?: number[]; hslLum?: number[]; fade?: number }

export const PROFILES: ProfileDef[] = [
  { id: 'color', name: 'Abyss Color', group: 'Basic' },
  { id: 'monochrome', name: 'Abyss Monochrome', group: 'Basic', bw: true },
  { id: 'neutral', name: 'Abyss Neutral', group: 'Basic', contrast: -18, saturation: -8 },
  { id: 'vivid', name: 'Abyss Vivid', group: 'Basic', contrast: 14, saturation: 12, vibrance: 18 },
  { id: 'portrait', name: 'Abyss Portrait', group: 'Basic', contrast: -4, saturation: -4, hslSat: [-6, -12, -6, 0, 0, 0, 0, 0], hslLum: [4, 8, 0, 0, 0, 0, 0, 0] },
  { id: 'landscape', name: 'Abyss Landscape', group: 'Basic', contrast: 10, vibrance: 14, hslSat: [0, 0, 6, 14, 10, 14, 0, 0], hslLum: [0, 0, 0, 0, 0, -8, 0, 0] },
  { id: 'matte', name: 'Matte', group: 'Artistic', contrast: -12, fade: 0.08, saturation: -10 },
  { id: 'chrome', name: 'Chrome', group: 'Artistic', contrast: 18, saturation: -14, grade: { sh: [200, 12, 0], hi: [45, 10, 0] } },
  { id: 'tidal', name: 'Tidal', group: 'Artistic', contrast: 6, temp: -10, grade: { sh: [195, 22, 0], hi: [35, 14, 0] }, hslSat: [0, 6, -10, -16, 10, 10, 0, 0] },
  { id: 'ember', name: 'Ember', group: 'Artistic', temp: 14, contrast: 8, grade: { sh: [20, 10, 0], hi: [45, 18, 0] }, hslHue: [0, -6, -10, 0, 0, 0, 0, 0] },
  { id: 'kelp', name: 'Kelp', group: 'Vintage', fade: 0.06, temp: 6, tint: -8, saturation: -16, grade: { sh: [130, 12, 0], hi: [55, 12, 0] } },
  { id: 'brine', name: 'Brine', group: 'Vintage', fade: 0.1, contrast: -8, saturation: -22, grade: { mid: [190, 8, 0] } },
  { id: 'bw-high', name: 'B&W High Contrast', group: 'B&W', bw: true, contrast: 30 },
  { id: 'bw-soft', name: 'B&W Soft', group: 'B&W', bw: true, contrast: -14, fade: 0.05 },
  { id: 'bw-sepia', name: 'B&W Sepia', group: 'B&W', bw: true, grade: { global: [38, 22, 0] } },
];

export function profileDef(id: string): ProfileDef {
  return PROFILES.find((p) => p.id === id) || PROFILES[0];
}
