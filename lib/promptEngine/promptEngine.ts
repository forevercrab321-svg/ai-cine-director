/**
 * Extreme Precision Shot-Control Engine
 * 
 * Replaces the old v1/v2 generation logic with a strict PromptCompiler.
 * It compiles 6 distinct sections and forces models to treat the reference frame
 * as absolute physical truth, scrubbing out vague cinematic "fluff" words.
 */

import { AnchorPackage, GenerationMode } from '../../types';
import { classifyShotIntent, getRoutingRules } from './entityRouter';

export type VideoPromptInput = {
  scene_text: string;
  anchorPackage?: AnchorPackage;
  [key: string]: any;
};

export type VideoPromptOptions = {
  shotType?: string;
  cameraMotion?: string;
  lens?: string;
  lighting?: string;
  colorGrade?: string;
  negatives?: string[];
  generationMode?: GenerationMode;
  contains_character?: boolean; // UI override for character presence
};

// Vague cinematic adjectives that cause hallucination and model drift.
const FLUFF_WORDS = [
  'epic', 'stunning', 'dramatic', 'intense', 'blockbuster', 'emotional',
  'shocking', 'apocalyptic', 'breathtaking', 'cinematic', 'masterpiece',
  'mind-blowing', 'unbelievable', 'spectacular', 'jaw-dropping', 'highly romanticized'
];

/**
 * Removes vague emotive adjectives to force physical precision.
 */
function fluffFilter(text: string): string {
  if (!text) return '';
  let cleaned = text;
  FLUFF_WORDS.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    cleaned = cleaned.replace(regex, '');
  });
  // Cleanup double spaces and leading/trailing commas
  cleaned = cleaned.replace(/\s+/g, ' ').replace(/\s+,/g, ',').replace(/^,\s*/, '').trim();
  return cleaned;
}

function joinNegatives(...arrs: (string[] | undefined)[]): string {
  return Array.from(new Set(arrs.flat().filter(Boolean))).join(', ');
}

/**
 * The core compiler that orchestrates the 6 physical layers of generation.
 */
export function buildVideoPrompt(
  input: VideoPromptInput,
  options: VideoPromptOptions = {}
): string {
  const isStrict = options.generationMode === 'strict_reference' || options.generationMode === 'extreme_lock';
  const isExtreme = options.generationMode === 'extreme_lock';

  const rawSceneText = input.scene_text || '';
  const filteredSceneText = fluffFilter(rawSceneText);

  // Intent Classification & Routing
  const { intent, presence } = classifyShotIntent(rawSceneText);
  const routing = getRoutingRules(intent, presence, options.contains_character);

  // Section 1: Scene Facts
  let sceneFacts = `[SCENE FACTS]\n${filteredSceneText}`;

  // Section 2: Immutable Elements
  let immutableElements = '[IMMUTABLE ELEMENTS]\n';

  // Section 3: Camera Instruction
  let cameraInstruction = '[CAMERA INSTRUCTION]\n';

  // Section 4: Allowed Motion
  let allowedMotion = '[ALLOWED MOTION]\n';

  // Section 5: Negative Constraints
  let negativesArr = options.negatives ? [...options.negatives] : [];

  // Section 6: Output Intent
  let outputIntent = '[OUTPUT INTENT]\nYou must animate exactly what is present in the frame. No reinterpretation.';

  // Populate constraints from Anchor Package if present
  if (isStrict && input.anchorPackage) {
    const pkg = input.anchorPackage;

    sceneFacts = `[SCENE FACTS]\nSubject: ${pkg.anchor_subject_description}\nEnvironment: ${pkg.anchor_environment_description}`;

    immutableElements += `Do not change these elements: ${pkg.immutable_elements.join(', ')}.\n`;
    if (isExtreme) {
      immutableElements += `Keep exact background geometry unchanged. Keep exact subject design unchanged.\n`;
    }

    cameraInstruction += `${pkg.anchor_camera_description}. No drastic camera movements.\n`;

    allowedMotion += `Only allow the following motion: ${pkg.allowed_motion_only}.\n`;
    if (isExtreme) {
      allowedMotion += `No dramatic secondary motion. No new spectacles. No explosions or fire unless already present.\n`;
    }

    if (pkg.negative_constraints) {
      negativesArr.push(pkg.negative_constraints);
    }

    outputIntent = '[OUTPUT INTENT]\nAnimate this exact frame with restrained realistic motion. The result should feel like the still image came alive, not like a new scene was invented. Maintain 100% identity and structural continuity.';
  } else {
    // Fallback or Loose mode
    immutableElements += 'Maintain general character design and environment.\n';
    cameraInstruction += [options.shotType, options.cameraMotion, options.lens].filter(Boolean).join('; ');
    allowedMotion += `Motion based on: ${filteredSceneText}`;
  }

  // Default System Negatives
  const defaultNegatives = [
    'cheap CGI', 'plastic skin', 'overexposed glow', 'low-res', 'jitter', 'warped hands', 'distorted face',
    'text artifacts', 'logo', 'watermark', 'subtitle overlay', 'flicker'
  ];

  // Dynamically inject Entity Router's forbidden leakage terms
  if (routing.forbiddenEntities.length > 0) {
    defaultNegatives.push(...routing.forbiddenEntities);
  }

  if (isStrict) {
    defaultNegatives.push(
      'different building', 'different skyline', 'different creature design', 'different perspective',
      'different lighting setup', 'alternate composition', 'scene drift', 'redesign', 'new architecture',
      'changing time of day', 'identity replacement'
    );
  }

  const finalNegatives = joinNegatives(defaultNegatives, negativesArr);
  const negativeConstraints = `[NEGATIVE CONSTRAINTS]\n${finalNegatives}`;

  // Compile the final prompt string
  const compiledPrompt = [
    sceneFacts,
    '',
    immutableElements,
    '',
    cameraInstruction,
    '',
    allowedMotion,
    '',
    negativeConstraints,
    '',
    outputIntent
  ].join('\n');

  return compiledPrompt.trim();
}
