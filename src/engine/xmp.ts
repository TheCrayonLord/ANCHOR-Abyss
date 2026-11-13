import { defaultSettings, normalize, type Settings, type Pt } from './settings';

// Read and write develop settings in the XMP "crs" (Camera Raw Settings) vocabulary, the open format
// raw editors use for presets and sidecar files. Masks and spot removal are not exchanged.

const BANDS = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'];

export function parseXmpFields(xml: string): { fields: Record<string, string>; curves: Record<string, Pt[]> } {
  const fields: Record<string, string> = {};
  const curves: Record<string, Pt[]> = {};
  for (const m of xml.matchAll(/crs:(\w+)\s*=\s*"([^"]*)"/g)) fields[m[1]] = m[2];
  for (const m of xml.matchAll(/<crs:(\w+)>([^<]*)<\/crs:\1>/g)) fields[m[1]] = m[2];
  for (const m of xml.matchAll(/<crs:(ToneCurvePV2012(?:Red|Green|Blue)?)>([\s\S]*?)<\/crs:\1>/g)) {
    const pts: Pt[] = [];
    for (const li of m[2].matchAll(/<rdf:li>\s*([\d.]+)\s*,\s*([\d.]+)\s*<\/rdf:li>/g)) pts.push([+li[1] / 255, +li[2] / 255]);
    if (pts.length >= 2) curves[m[1]] = pts;
  }
  return { fields, curves };
}

export function xmpToSettings(xml: string, base: Settings = defaultSettings()): { settings: Settings; name?: string; count: number } {
  const { fields: f, curves } = parseXmpFields(xml);
  const s: any = JSON.parse(JSON.stringify(base));
  let count = 0;
  const num = (k: string) => (f[k] !== undefined && f[k] !== '' && !isNaN(+f[k]) ? +f[k] : undefined);
  const set = (k: string, fn: (v: number) => void) => { const v = num(k); if (v !== undefined) { fn(v); count++; } };
  set('Exposure2012', (v) => (s.exposure = v));
  set('Contrast2012', (v) => (s.contrast = v));
  set('Highlights2012', (v) => (s.highlights = v));
  set('Shadows2012', (v) => (s.shadows = v));
  set('Whites2012', (v) => (s.whites = v));
  set('Blacks2012', (v) => (s.blacks = v));
  set('Texture', (v) => (s.texture = v));
  set('Clarity2012', (v) => (s.clarity = v));
  set('Dehaze', (v) => (s.dehaze = v));
  set('Vibrance', (v) => (s.vibrance = v));
  set('Saturation', (v) => (s.saturation = v));
  set('IncrementalTemperature', (v) => { s.temp = v; s.wb = 'custom'; });
  set('IncrementalTint', (v) => { s.tint = v; s.wb = 'custom'; });
  set('Temperature', (v) => { s.temp = Math.max(-100, Math.min(100, Math.round(((v - 5500) / 5500) * 100))); s.wb = 'custom'; });
  set('Tint', (v) => { if (num('IncrementalTint') === undefined) s.tint = Math.max(-100, Math.min(100, v)); });
  set('ParametricShadows', (v) => (s.curve.shadows = v));
  set('ParametricDarks', (v) => (s.curve.darks = v));
  set('ParametricLights', (v) => (s.curve.lights = v));
  set('ParametricHighlights', (v) => (s.curve.highlights = v));
  set('ParametricShadowSplit', (v) => (s.curve.s1 = v));
  set('ParametricMidtoneSplit', (v) => (s.curve.s2 = v));
  set('ParametricHighlightSplit', (v) => (s.curve.s3 = v));
  if (curves.ToneCurvePV2012) { s.curve.master = curves.ToneCurvePV2012; count++; }
  if (curves.ToneCurvePV2012Red) { s.curve.red = curves.ToneCurvePV2012Red; count++; }
  if (curves.ToneCurvePV2012Green) { s.curve.green = curves.ToneCurvePV2012Green; count++; }
  if (curves.ToneCurvePV2012Blue) { s.curve.blue = curves.ToneCurvePV2012Blue; count++; }
  BANDS.forEach((b, i) => {
    set('HueAdjustment' + b, (v) => (s.hsl.hue[i] = v));
    set('SaturationAdjustment' + b, (v) => (s.hsl.sat[i] = v));
    set('LuminanceAdjustment' + b, (v) => (s.hsl.lum[i] = v));
    set('GrayMixer' + b, (v) => (s.bw[i] = v));
  });
  if (f.ConvertToGrayscale === 'True') { s.treatment = 'bw'; count++; }
  if (f.ConvertToGrayscale === 'False') s.treatment = 'color';
  set('Sharpness', (v) => (s.sharpen.amount = v));
  set('SharpenRadius', (v) => (s.sharpen.radius = v));
  set('SharpenDetail', (v) => (s.sharpen.detail = v));
  set('SharpenEdgeMasking', (v) => (s.sharpen.masking = v));
  set('LuminanceSmoothing', (v) => (s.nr.lum = v));
  set('LuminanceNoiseReductionDetail', (v) => (s.nr.lumDetail = v));
  set('LuminanceNoiseReductionContrast', (v) => (s.nr.lumContrast = v));
  set('ColorNoiseReduction', (v) => (s.nr.color = v));
  set('ColorNoiseReductionDetail', (v) => (s.nr.colorDetail = v));
  set('ColorNoiseReductionSmoothness', (v) => (s.nr.colorSmooth = v));
  set('PostCropVignetteAmount', (v) => (s.vignette.amount = v));
  set('PostCropVignetteMidpoint', (v) => (s.vignette.midpoint = v));
  set('PostCropVignetteRoundness', (v) => (s.vignette.roundness = v));
  set('PostCropVignetteFeather', (v) => (s.vignette.feather = v));
  set('PostCropVignetteHighlightContrast', (v) => (s.vignette.highlights = v));
  set('PostCropVignetteStyle', (v) => (s.vignette.style = v === 2 ? 'color' : v === 3 ? 'paint' : 'highlight'));
  set('GrainAmount', (v) => (s.grain.amount = v));
  set('GrainSize', (v) => (s.grain.size = v));
  set('GrainFrequency', (v) => (s.grain.roughness = v));
  const zones: [string, string][] = [['Shadow', 'sh'], ['Midtone', 'mid'], ['Highlight', 'hi'], ['Global', 'global']];
  for (const [z, k] of zones) {
    set(`ColorGrade${z}Hue`, (v) => (s.grade[k][0] = v));
    set(`ColorGrade${z}Sat`, (v) => (s.grade[k][1] = v));
    set(`ColorGrade${z}Lum`, (v) => (s.grade[k][2] = v));
  }
  // older split toning
  if (num('ColorGradeShadowHue') === undefined) {
    set('SplitToningShadowHue', (v) => (s.grade.sh[0] = v));
    set('SplitToningShadowSaturation', (v) => (s.grade.sh[1] = v));
    set('SplitToningHighlightHue', (v) => (s.grade.hi[0] = v));
    set('SplitToningHighlightSaturation', (v) => (s.grade.hi[1] = v));
  }
  set('ColorGradeBlending', (v) => (s.grade.blending = v));
  set('SplitToningBalance', (v) => (s.grade.balance = v));
  set('LensManualDistortionAmount', (v) => (s.lens.distortion = -v));
  set('VignetteAmount', (v) => (s.lens.vignette = v));
  set('VignetteMidpoint', (v) => (s.lens.vignetteMid = v));
  set('DefringePurpleAmount', (v) => (s.lens.purple = v));
  set('DefringePurpleHueLo', (v) => (s.lens.purpleLo = 200 + v * 1.4));
  set('DefringePurpleHueHi', (v) => (s.lens.purpleHi = 200 + v * 1.4));
  set('DefringeGreenAmount', (v) => (s.lens.green = v));
  set('DefringeGreenHueLo', (v) => (s.lens.greenLo = 40 + v * 1.1));
  set('DefringeGreenHueHi', (v) => (s.lens.greenHi = 40 + v * 1.1));
  if (f.AutoLateralCA === '1') { s.lens.ca = true; count++; }
  if (f.LensProfileEnable === '1') { s.lens.profile = true; count++; }
  set('PerspectiveVertical', (v) => (s.transform.vertical = v));
  set('PerspectiveHorizontal', (v) => (s.transform.horizontal = v));
  set('PerspectiveRotate', (v) => (s.transform.rotate = v));
  set('PerspectiveScale', (v) => (s.transform.scale = v));
  set('PerspectiveAspect', (v) => (s.transform.aspect = v));
  set('PerspectiveX', (v) => (s.transform.x = v));
  set('PerspectiveY', (v) => (s.transform.y = v));
  set('ShadowTint', (v) => (s.calib.shadowTint = v));
  set('RedHue', (v) => (s.calib.redHue = v));
  set('RedSaturation', (v) => (s.calib.redSat = v));
  set('GreenHue', (v) => (s.calib.greenHue = v));
  set('GreenSaturation', (v) => (s.calib.greenSat = v));
  set('BlueHue', (v) => (s.calib.blueHue = v));
  set('BlueSaturation', (v) => (s.calib.blueSat = v));
  if (f.HasCrop === 'True') {
    const L = num('CropLeft') ?? 0, T = num('CropTop') ?? 0, R = num('CropRight') ?? 1, B = num('CropBottom') ?? 1;
    s.crop = { ...s.crop, cx: (L + R) / 2, cy: (T + B) / 2, w: R - L, h: B - T, angle: num('CropAngle') ?? 0, aspect: 'free' };
    count++;
  }
  // preset name, if present
  const nm = xml.match(/<crs:Name>[\s\S]*?<rdf:li[^>]*>([^<]*)<\/rdf:li>/) || xml.match(/crs:Name="([^"]*)"/);
  return { settings: normalize(s), name: nm ? nm[1] : undefined, count };
}

const sgn = (v: number, d = 0) => (v > 0 ? '+' : '') + v.toFixed(d);

export function settingsToXmp(s: Settings, opts: { name?: string; raw?: boolean } = {}): string {
  const a: Record<string, string> = {
    Version: '15.0', ProcessVersion: '11.0', CameraProfile: 'Adobe Standard',
    WhiteBalance: s.wb === 'asShot' ? 'As Shot' : 'Custom',
    IncrementalTemperature: sgn(s.temp), IncrementalTint: sgn(s.tint),
    Exposure2012: sgn(s.exposure, 2), Contrast2012: sgn(s.contrast), Highlights2012: sgn(s.highlights), Shadows2012: sgn(s.shadows),
    Whites2012: sgn(s.whites), Blacks2012: sgn(s.blacks), Texture: sgn(s.texture), Clarity2012: sgn(s.clarity), Dehaze: sgn(s.dehaze),
    Vibrance: sgn(s.vibrance), Saturation: sgn(s.saturation),
    ParametricShadows: String(s.curve.shadows), ParametricDarks: String(s.curve.darks), ParametricLights: String(s.curve.lights), ParametricHighlights: String(s.curve.highlights),
    ParametricShadowSplit: String(s.curve.s1), ParametricMidtoneSplit: String(s.curve.s2), ParametricHighlightSplit: String(s.curve.s3),
    Sharpness: String(s.sharpen.amount), SharpenRadius: sgn(s.sharpen.radius, 1), SharpenDetail: String(s.sharpen.detail), SharpenEdgeMasking: String(s.sharpen.masking),
    LuminanceSmoothing: String(s.nr.lum), LuminanceNoiseReductionDetail: String(s.nr.lumDetail), LuminanceNoiseReductionContrast: String(s.nr.lumContrast),
    ColorNoiseReduction: String(s.nr.color), ColorNoiseReductionDetail: String(s.nr.colorDetail), ColorNoiseReductionSmoothness: String(s.nr.colorSmooth),
    ConvertToGrayscale: s.treatment === 'bw' ? 'True' : 'False',
    PostCropVignetteAmount: sgn(s.vignette.amount), PostCropVignetteMidpoint: String(s.vignette.midpoint), PostCropVignetteRoundness: sgn(s.vignette.roundness),
    PostCropVignetteFeather: String(s.vignette.feather), PostCropVignetteHighlightContrast: String(s.vignette.highlights),
    PostCropVignetteStyle: String(s.vignette.style === 'color' ? 2 : s.vignette.style === 'paint' ? 3 : 1),
    GrainAmount: String(s.grain.amount), GrainSize: String(s.grain.size), GrainFrequency: String(s.grain.roughness),
    ColorGradeBlending: String(s.grade.blending), SplitToningBalance: sgn(s.grade.balance),
    LensManualDistortionAmount: String(-s.lens.distortion), VignetteAmount: sgn(s.lens.vignette), VignetteMidpoint: String(s.lens.vignetteMid),
    DefringePurpleAmount: String(s.lens.purple), DefringeGreenAmount: String(s.lens.green),
    AutoLateralCA: s.lens.ca ? '1' : '0', LensProfileEnable: s.lens.profile ? '1' : '0',
    PerspectiveVertical: String(s.transform.vertical), PerspectiveHorizontal: String(s.transform.horizontal), PerspectiveRotate: s.transform.rotate.toFixed(1),
    PerspectiveScale: String(s.transform.scale), PerspectiveAspect: String(s.transform.aspect), PerspectiveX: s.transform.x.toFixed(2), PerspectiveY: s.transform.y.toFixed(2),
    ShadowTint: String(s.calib.shadowTint), RedHue: String(s.calib.redHue), RedSaturation: String(s.calib.redSat), GreenHue: String(s.calib.greenHue),
    GreenSaturation: String(s.calib.greenSat), BlueHue: String(s.calib.blueHue), BlueSaturation: String(s.calib.blueSat),
  };
  BANDS.forEach((b, i) => {
    a['HueAdjustment' + b] = String(s.hsl.hue[i]); a['SaturationAdjustment' + b] = String(s.hsl.sat[i]); a['LuminanceAdjustment' + b] = String(s.hsl.lum[i]); a['GrayMixer' + b] = String(s.bw[i]);
  });
  for (const [z, k] of [['Shadow', 'sh'], ['Midtone', 'mid'], ['Highlight', 'hi'], ['Global', 'global']] as const) {
    a[`ColorGrade${z}Hue`] = String(s.grade[k][0]); a[`ColorGrade${z}Sat`] = String(s.grade[k][1]); a[`ColorGrade${z}Lum`] = String(s.grade[k][2]);
  }
  const c = s.crop;
  const isCrop = c.w < 0.9999 || c.h < 0.9999 || c.angle !== 0;
  a.HasCrop = isCrop ? 'True' : 'False';
  if (isCrop) { a.CropLeft = (c.cx - c.w / 2).toFixed(6); a.CropRight = (c.cx + c.w / 2).toFixed(6); a.CropTop = (c.cy - c.h / 2).toFixed(6); a.CropBottom = (c.cy + c.h / 2).toFixed(6); a.CropAngle = c.angle.toFixed(2); }
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const attrs = Object.entries(a).map(([k, v]) => `   crs:${k}="${esc(v)}"`).join('\n');
  const seq = (name: string, pts: Pt[]) => `   <crs:${name}>\n    <rdf:Seq>\n${pts.map((p) => `     <rdf:li>${Math.round(p[0] * 255)}, ${Math.round(p[1] * 255)}</rdf:li>`).join('\n')}\n    </rdf:Seq>\n   </crs:${name}>`;
  const name = opts.name ? `   <crs:Name>\n    <rdf:Alt>\n     <rdf:li xml:lang="x-default">${esc(opts.name)}</rdf:li>\n    </rdf:Alt>\n   </crs:Name>\n` : '';
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="ANCHOR Abyss">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
${attrs}>
${name}${seq('ToneCurvePV2012', s.curve.master)}
${seq('ToneCurvePV2012Red', s.curve.red)}
${seq('ToneCurvePV2012Green', s.curve.green)}
${seq('ToneCurvePV2012Blue', s.curve.blue)}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`;
}
