/**
 * Director Prompt Engine — v2 prompt builder for cinematic video generation
 *
 * Usage:
 *   import { buildVideoPrompt, VIDEO_PROMPT_PRESETS } from './lib/promptEngine/promptEngine';
 *
 * - buildVideoPrompt(input, options?)
 * - input: { scene_text: string, ... }
 * - options: { stylePreset, shotType, cameraMotion, lens, lighting, colorGrade, negatives, continuityLock }
 */

export type VideoPromptInput = {
  scene_text: string;
  [key: string]: any;
};

export type VideoPromptOptions = {
  stylePreset?: keyof typeof VIDEO_PROMPT_PRESETS;
  shotType?: string;
  cameraMotion?: string;
  lens?: string;
  lighting?: string;
  colorGrade?: string;
  negatives?: string[];
  continuityLock?: string;
};

export const VIDEO_PROMPT_PRESETS = {
  cinematic_realism: {
    shotType: 'Wide, medium, and close-up shots, naturalistic camera movement',
    lighting: 'Soft key light, practicals, natural daylight, balanced contrast',
    colorGrade: 'Subtle teal-orange, filmic LUT, gentle highlight rolloff',
    texture: 'Visible skin pores, micro-expressions, realistic cloth physics, subtle motion blur',
    negatives: [
      'cheap CGI', 'plastic skin', 'overexposed glow', 'low-res', 'jitter', 'warped hands', 'distorted face',
      'text artifacts', 'logo', 'watermark', 'subtitle overlay', 'inconsistent character', 'flicker',
    ],
  },
  neo_noir: {
    shotType: 'Low angle, Dutch tilt, long lens, slow push-in',
    lighting: 'High contrast, hard shadows, neon rim light, rainy reflections',
    colorGrade: 'Desaturated, blue-green, deep blacks, neon accents',
    texture: 'Wet surfaces, sharp reflections, film grain, smoke haze',
    negatives: ['cartoonish', 'flat lighting', 'washed out', 'posterization'],
  },
  warm_romance: {
    shotType: 'Soft focus, handheld, gentle dolly',
    lighting: 'Golden hour, backlight, soft fill, warm practicals',
    colorGrade: 'Warm pastel, creamy highlights, low contrast',
    texture: 'Smooth skin, soft bokeh, gentle lens flare',
    negatives: ['harsh shadows', 'cold color', 'overexposed', 'plastic look'],
  },
  documentary_handheld: {
    shotType: 'Handheld, observational, zooms, whip pans',
    lighting: 'Available light, practical, uncorrected white balance',
    colorGrade: 'Natural, minimal grading, true-to-life',
    texture: 'Visible grain, motion blur, imperfect focus',
    negatives: ['cinematic over-stylization', 'artificial lighting', 'CGI'],
  },
  anime_liveaction_hybrid: {
    shotType: 'Dynamic angles, exaggerated perspective, fast dolly',
    lighting: 'Cel-shaded, rim light, saturated highlights',
    colorGrade: 'Vivid, high saturation, anime palette',
    texture: 'Clean lines, painterly shading, stylized motion blur',
    negatives: ['muddy colors', 'uncanny valley', 'photorealism'],
  },
};

const DEFAULT_PRESET = 'cinematic_realism';

function joinNegatives(...arrs: (string[] | undefined)[]): string {
  return Array.from(new Set(arrs.flat().filter(Boolean))).join(', ');
}

export function buildVideoPrompt(
  input: VideoPromptInput,
  options: VideoPromptOptions = {}
): string {
  const preset = VIDEO_PROMPT_PRESETS[options.stylePreset || DEFAULT_PRESET];
  const shotType = options.shotType || preset.shotType;
  const cameraMotion = options.cameraMotion || '';
  const lens = options.lens || '';
  const lighting = options.lighting || preset.lighting;
  const colorGrade = options.colorGrade || preset.colorGrade;
  const texture = preset.texture;
  const continuityLock = options.continuityLock || 'Maintain same character face, outfit, and proportions throughout.';
  const negatives = joinNegatives(preset.negatives, options.negatives, [
    'cheap CGI', 'plastic skin', 'overexposed glow', 'low-res', 'jitter', 'warped hands', 'distorted face',
    'text artifacts', 'logo', 'watermark', 'subtitle overlay', 'inconsistent character', 'flicker',
  ]);

  // Five-layer structure
  return [
    '[Narrative Layer]',
    input.scene_text || '(No scene text provided)',
    '',
    '[Cinematic Layer]',
    [shotType, cameraMotion, lens].filter(Boolean).join('; '),
    '',
    '[Lighting & Color Layer]',
    [lighting, colorGrade].filter(Boolean).join('; '),
    '',
    '[Texture Realism Layer]',
    texture,
    '',
    '[Continuity Lock + Negative Constraints]',
    continuityLock,
    'Negatives (soft constraints): ' + negatives,
  ].join('\n');
}
