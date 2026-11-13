import type { Settings } from './settings';

export interface BuiltinPreset { id: string; name: string; group: string; part: Partial<Settings> }

const c = (o: Partial<Settings>) => o;

export const BUILTIN_PRESETS: BuiltinPreset[] = [
  { id: 'b-auto-pop', name: 'Clean Pop', group: 'Essentials', part: c({ contrast: 12, highlights: -25, shadows: 20, whites: 10, blacks: -8, clarity: 10, vibrance: 20 }) },
  { id: 'b-soft', name: 'Soft & Airy', group: 'Essentials', part: c({ exposure: 0.3, contrast: -15, highlights: -20, shadows: 25, clarity: -10, vibrance: 10, saturation: -5 }) },
  { id: 'b-crisp', name: 'Crisp Detail', group: 'Essentials', part: c({ texture: 25, clarity: 20, sharpen: { amount: 70, radius: 1, detail: 35, masking: 20 } }) },
  { id: 'b-hdr', name: 'Natural HDR Look', group: 'Essentials', part: c({ highlights: -80, shadows: 70, whites: 15, blacks: -15, clarity: 25, texture: 10, vibrance: 15 }) },
  { id: 'b-dehaze', name: 'Cut Through Haze', group: 'Landscape', part: c({ dehaze: 30, contrast: 10, vibrance: 15, highlights: -20 }) },
  { id: 'b-golden', name: 'Golden Hour', group: 'Landscape', part: c({ temp: 18, tint: 4, vibrance: 15, highlights: -20, grade: { sh: [220, 8, 0], mid: [0, 0, 0], hi: [42, 22, 0], global: [0, 0, 0], blending: 50, balance: 10 } }) },
  { id: 'b-moody', name: 'Moody Teal', group: 'Landscape', part: c({ contrast: 15, highlights: -40, shadows: 10, blacks: -15, vibrance: -10, hsl: { hue: [0, -8, -25, 30, 0, -10, 0, 0], sat: [0, -10, -40, -45, -10, -15, -20, 0], lum: [0, 0, -10, -25, -10, -20, 0, 0] }, grade: { sh: [195, 22, -5], mid: [0, 0, 0], hi: [38, 14, 0], global: [0, 0, 0], blending: 60, balance: 0 }, vignette: { amount: -18, midpoint: 50, roundness: 0, feather: 60, highlights: 0, style: 'highlight' } }) },
  { id: 'b-greens', name: 'Lush Greens', group: 'Landscape', part: c({ hsl: { hue: [0, 0, 15, 10, 0, 0, 0, 0], sat: [0, 0, 20, 25, 10, 0, 0, 0], lum: [0, 0, 10, 5, 0, 0, 0, 0] }, vibrance: 10 }) },
  { id: 'b-blue-sky', name: 'Deep Blue Sky', group: 'Landscape', part: c({ hsl: { hue: [0, 0, 0, 0, 0, -6, 0, 0], sat: [0, 0, 0, 0, 10, 25, 0, 0], lum: [0, 0, 0, 0, -10, -30, 0, 0] } }) },
  { id: 'b-skin', name: 'Smooth Skin Tones', group: 'Portrait', part: c({ texture: -20, clarity: -8, hsl: { hue: [4, 3, 0, 0, 0, 0, 0, 0], sat: [-5, -12, 0, 0, 0, 0, 0, 0], lum: [5, 10, 0, 0, 0, 0, 0, 0] } }) },
  { id: 'b-bright-portrait', name: 'Bright Portrait', group: 'Portrait', part: c({ exposure: 0.35, contrast: -5, shadows: 30, whites: 10, texture: -10, vibrance: 8, vignette: { amount: 15, midpoint: 50, roundness: 0, feather: 70, highlights: 0, style: 'highlight' } }) },
  { id: 'b-film-warm', name: 'Warm Film', group: 'Film', part: c({ temp: 10, contrast: -10, curve: { highlights: 0, lights: 0, darks: 0, shadows: 0, s1: 25, s2: 50, s3: 75, master: [[0, 0.06], [0.25, 0.24], [0.75, 0.8], [1, 0.95]], red: [[0, 0], [1, 1]], green: [[0, 0], [1, 1]], blue: [[0, 0], [1, 1]] }, grain: { amount: 22, size: 30, roughness: 55 }, saturation: -10 }) },
  { id: 'b-film-cool', name: 'Cool Film', group: 'Film', part: c({ temp: -8, tint: 4, curve: { highlights: 0, lights: 0, darks: 0, shadows: 0, s1: 25, s2: 50, s3: 75, master: [[0, 0.05], [0.3, 0.27], [0.7, 0.75], [1, 0.96]], red: [[0, 0], [1, 1]], green: [[0, 0], [1, 1]], blue: [[0, 0.04], [1, 0.97]] }, grain: { amount: 18, size: 25, roughness: 50 } }) },
  { id: 'b-faded', name: 'Faded Matte', group: 'Film', part: c({ contrast: -20, blacks: 20, saturation: -15, curve: { highlights: 0, lights: 0, darks: 0, shadows: 0, s1: 25, s2: 50, s3: 75, master: [[0, 0.12], [0.5, 0.5], [1, 0.92]], red: [[0, 0], [1, 1]], green: [[0, 0], [1, 1]], blue: [[0, 0], [1, 1]] } }) },
  { id: 'b-bw-classic', name: 'Classic B&W', group: 'Black & White', part: c({ treatment: 'bw', contrast: 15, clarity: 10 }) },
  { id: 'b-bw-noir', name: 'Noir', group: 'Black & White', part: c({ treatment: 'bw', contrast: 45, blacks: -25, highlights: -20, clarity: 20, vignette: { amount: -30, midpoint: 40, roundness: 0, feather: 60, highlights: 0, style: 'highlight' }, grain: { amount: 25, size: 20, roughness: 60 } }) },
  { id: 'b-bw-soft', name: 'Soft Silver', group: 'Black & White', part: c({ treatment: 'bw', contrast: -15, shadows: 25, highlights: -15, grade: { sh: [0, 0, 0], mid: [0, 0, 0], hi: [0, 0, 0], global: [210, 6, 0], blending: 50, balance: 0 } }) },
  { id: 'b-sepia', name: 'Sepia Tone', group: 'Black & White', part: c({ treatment: 'bw', grade: { sh: [30, 25, 0], mid: [0, 0, 0], hi: [45, 18, 0], global: [0, 0, 0], blending: 50, balance: 0 } }) },
  { id: 'b-night', name: 'Night Cleanup', group: 'Fixes', part: c({ nr: { lum: 45, lumDetail: 50, lumContrast: 0, color: 50, colorDetail: 50, colorSmooth: 50 }, shadows: 20, highlights: -30, temp: -8 }) },
  { id: 'b-sharpen-landscape', name: 'Sharpen: Landscape', group: 'Fixes', part: c({ sharpen: { amount: 60, radius: 1.0, detail: 50, masking: 10 } }) },
  { id: 'b-sharpen-portrait', name: 'Sharpen: Portrait', group: 'Fixes', part: c({ sharpen: { amount: 35, radius: 1.4, detail: 15, masking: 70 } }) },
  { id: 'b-vignette', name: 'Subtle Vignette', group: 'Fixes', part: c({ vignette: { amount: -20, midpoint: 45, roundness: 0, feather: 70, highlights: 20, style: 'highlight' } }) },
];
