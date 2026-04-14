/**
 * consistencyEngine.ts — Multi-image visual consistency enforcement
 * 
 * Provides structured consistency mechanisms for maintaining character identity,
 * wardrobe, environment, and style across all generated images in a project.
 * 
 * This engine works at the prompt-engineering level (the strongest mechanism
 * available without model-level reference conditioning like IP-Adapter).
 * 
 * Strategy:
 * 1. Character Identity Lock — face/body description injected FIRST in every prompt
 * 2. Wardrobe Lock — outfit description carried across shots in same scene
 * 3. Environment Lock — location topology enforced per scene
 * 4. Style Lock — color palette + lighting + lens language unified
 * 5. Seed Strategy — deterministic seeds with scene-based offsets (not just one seed)
 * 6. Shot Memory — approved image URL becomes reference for next shot (Flux Redux)
 */

import { StoryEntity, CharacterBible, StyleBible, Shot, Scene, ContinuityConfig } from '../types';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface ConsistencyProfile {
  character_lock: string;      // Full character description block
  wardrobe_lock: string;       // Current outfit description
  environment_lock: string;    // Scene location topology
  style_lock: string;          // Visual style enforcement
  negative_lock: string;       // Things to explicitly avoid
  seed: number;                // Computed seed for this shot
  reference_image_url?: string; // Previous approved image for Flux Redux
}

export interface ConsistencyConfig {
  character_bible?: CharacterBible;
  style_bible?: StyleBible;
  story_entities?: StoryEntity[];
  character_anchor?: string;
  visual_style?: string;
  project_type?: string;
  reference_image_url?: string; // Global anchor image
  approved_shot_images?: Map<string, string>; // shot_id → approved image URL
}

// ═══════════════════════════════════════════════════════════════
// Seed strategy
// ═══════════════════════════════════════════════════════════════

const BASE_SEED = 142857;

/**
 * Generate a deterministic seed for a specific scene/shot combination.
 * Uses scene number and shot number as offsets to ensure variety
 * while maintaining per-shot reproducibility.
 */
export function computeSeed(sceneNumber: number, shotNumber: number, variant: number = 0): number {
  // Mix scene and shot into a deterministic but varied seed
  const mixed = BASE_SEED + (sceneNumber * 10007) + (shotNumber * 1009) + (variant * 101);
  return Math.abs(mixed) % 2147483647; // Keep within 32-bit int range
}

// ═══════════════════════════════════════════════════════════════
// Character identity extraction
// ═══════════════════════════════════════════════════════════════

/**
 * Build the character identity lock string from all available sources.
 * Priority: character_bible > story_entities > character_anchor
 */
function buildCharacterLock(config: ConsistencyConfig): string {
  const parts: string[] = [];

  // 1. From CharacterBible (most detailed)
  if (config.character_bible) {
    const b = config.character_bible;
    const traits = [
      b.face_traits && `face: ${b.face_traits}`,
      b.age && `age: ${b.age}`,
      b.body_type && `body: ${b.body_type}`,
      b.hair && `hair: ${b.hair}`,
      b.skin_tone && `skin: ${b.skin_tone}`,
      b.eye_shape && `eyes: ${b.eye_shape}`,
      b.nose_lips && `nose/lips: ${b.nose_lips}`,
      b.signature_accessories && `accessories: ${b.signature_accessories}`,
    ].filter(Boolean);

    if (traits.length > 0) {
      parts.push(`[CHARACTER BIBLE] ${b.name}: ${traits.join(', ')}`);
    }
  }

  // 2. From StoryEntities (locked characters)
  if (config.story_entities?.length) {
    const locked = config.story_entities.filter(e =>
      e.is_locked && (e.type === 'character' || e.type === 'prop')
    );
    for (const entity of locked) {
      parts.push(`[${entity.type.toUpperCase()} LOCK: ${entity.name}] ${entity.description}`);
    }
  }

  // 3. From character_anchor (legacy fallback)
  if (parts.length === 0 && config.character_anchor) {
    parts.push(`[IDENTITY LOCK] ${config.character_anchor}`);
  }

  if (parts.length === 0) return '';

  return parts.join(' | ') + 
    '. IDENTITY LOCK: same person throughout, identical face, identical hairstyle, identical outfit and accessories, same skin tone, same body proportions.';
}

// ═══════════════════════════════════════════════════════════════
// Wardrobe tracking
// ═══════════════════════════════════════════════════════════════

/**
 * Extract wardrobe description for the current scene.
 * If character_bible has outfit info, use that.
 * Otherwise extract from shot action/art_direction fields.
 */
function buildWardrobeLock(config: ConsistencyConfig, shot?: Shot): string {
  if (config.character_bible?.outfit) {
    return `[WARDROBE LOCK] ${config.character_bible.outfit}. DO NOT change clothing between shots.`;
  }
  if (shot?.art_direction) {
    return `[WARDROBE CONTINUITY] Maintain exact same wardrobe as described: ${shot.art_direction}`;
  }
  return '';
}

// ═══════════════════════════════════════════════════════════════
// Environment lock
// ═══════════════════════════════════════════════════════════════

function buildEnvironmentLock(scene?: Scene, shot?: Shot): string {
  const parts: string[] = [];

  if (scene?.scene_setting) {
    parts.push(`Scene setting: ${scene.scene_setting}`);
  }
  if (shot?.location) {
    parts.push(`Location: ${shot.location}`);
  }
  if (shot?.time_of_day) {
    parts.push(`Time: ${shot.time_of_day}`);
  }

  if (parts.length === 0) return '';

  return `[SCENE TOPOLOGY LOCK] ${parts.join(', ')}. Keep exact architectural geometry, room layout, and background elements stable. DO NOT drift or hallucinate new environment structures.`;
}

// ═══════════════════════════════════════════════════════════════
// Style lock
// ═══════════════════════════════════════════════════════════════

function buildStyleLock(config: ConsistencyConfig): string {
  const parts: string[] = [];

  if (config.style_bible) {
    const s = config.style_bible;
    if (s.color_palette) parts.push(`color palette: ${s.color_palette}`);
    if (s.lens_language) parts.push(`lens: ${s.lens_language}`);
    if (s.lighting) parts.push(`lighting: ${s.lighting}`);
    if (s.realism_level) parts.push(`realism: ${s.realism_level}`);
    if (s.mood) parts.push(`mood: ${s.mood}`);
    if (s.rendering_style) parts.push(`rendering: ${s.rendering_style}`);
  }

  if (config.visual_style) {
    parts.push(`style: ${config.visual_style}`);
  }

  if (parts.length === 0) {
    return '[STYLE LOCK] Professional cinematic photography, consistent warm lighting, unified color grading, photorealistic, high quality, 35mm film grain.';
  }

  return `[STYLE LOCK] ${parts.join(', ')}. Maintain exact color temperature, shadow direction, film grain, and art direction across all frames.`;
}

// ═══════════════════════════════════════════════════════════════
// Negative constraints
// ═══════════════════════════════════════════════════════════════

function buildNegativeLock(config: ConsistencyConfig): string {
  const negatives = [
    'blurry', 'low quality', 'worst quality', 'deformed', 'disfigured',
    'extra limbs', 'mutation', 'bad anatomy', 'watermark', 'text',
    'duplicate characters', 'inconsistent lighting',
  ];

  if (config.project_type === 'environment_driven' || config.project_type === 'architecture_driven') {
    negatives.push('people', 'human figures', 'faces', 'crowds');
  }

  return negatives.join(', ');
}

// ═══════════════════════════════════════════════════════════════
// Main API
// ═══════════════════════════════════════════════════════════════

/**
 * Build a complete consistency profile for a specific shot.
 * This profile contains all the prompt fragments and settings needed
 * to maintain visual consistency with the rest of the project.
 */
export function buildConsistencyProfile(
  config: ConsistencyConfig,
  sceneNumber: number,
  shotNumber: number,
  scene?: Scene,
  shot?: Shot,
): ConsistencyProfile {
  return {
    character_lock: buildCharacterLock(config),
    wardrobe_lock: buildWardrobeLock(config, shot),
    environment_lock: buildEnvironmentLock(scene, shot),
    style_lock: buildStyleLock(config),
    negative_lock: buildNegativeLock(config),
    seed: computeSeed(sceneNumber, shotNumber),
    reference_image_url: findReferenceImage(config, sceneNumber, shotNumber),
  };
}

/**
 * Find the best reference image for a given shot.
 * Priority: 
 * 1. Previous shot's approved image (for in-scene continuity)
 * 2. Global anchor image (project-level reference)
 * 3. undefined (no reference)
 */
function findReferenceImage(
  config: ConsistencyConfig,
  sceneNumber: number,
  shotNumber: number,
): string | undefined {
  if (!config.approved_shot_images) return config.reference_image_url;

  // Try to find the previous shot's approved image
  // Convention: shot IDs are like "shot-{scene}-{shot}"
  if (shotNumber > 1) {
    const prevKey = `shot-${sceneNumber}-${shotNumber - 1}`;
    const prevImage = config.approved_shot_images.get(prevKey);
    if (prevImage) return prevImage;
  }

  // Fall back to global anchor
  return config.reference_image_url;
}

/**
 * Compose the final image prompt with all consistency locks applied.
 * This is the master function that assembles all pieces in the correct
 * attention-priority order.
 */
export function composeConsistentPrompt(
  basePrompt: string,
  profile: ConsistencyProfile,
): string {
  const sections: string[] = [];

  // Position 1: STYLE (highest attention weight)
  if (profile.style_lock) {
    sections.push(profile.style_lock);
  }

  // Position 2: CHARACTER IDENTITY
  if (profile.character_lock) {
    sections.push(profile.character_lock);
  }

  // Position 3: WARDROBE
  if (profile.wardrobe_lock) {
    sections.push(profile.wardrobe_lock);
  }

  // Position 4: ENVIRONMENT
  if (profile.environment_lock) {
    sections.push(profile.environment_lock);
  }

  // Position 5: SHOT-SPECIFIC CONTENT
  sections.push(basePrompt);

  return sections.filter(Boolean).join('. ');
}

/**
 * Build consistency-enhanced parameters for the batch image generation API.
 * Returns the fields that should be merged into each shot's generation request.
 */
export function getConsistencyParams(
  profile: ConsistencyProfile,
): {
  seed: number;
  negative_prompt: string;
  reference_image_url?: string;
} {
  return {
    seed: profile.seed,
    negative_prompt: profile.negative_lock,
    reference_image_url: profile.reference_image_url,
  };
}
