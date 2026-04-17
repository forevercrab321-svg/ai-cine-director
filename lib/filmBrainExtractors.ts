/**
 * lib/filmBrainExtractors.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 2 activation layer.
 *
 * Converts raw Script Brain / Director Brain output structures into the
 * typed inputs that composeAllPrompts() consumes.
 *
 * Exports:
 *   extractCharacterBibles(sources)           → CharacterBibleEntry[]
 *   extractDirectorBrainForShot(params)       → DirectorBrainInput
 *   buildCharacterAnchorFromBibles(bibles)    → string  (legacy fallback format)
 */

import type { CharacterBibleEntry, DirectorBrainInput } from './shotPromptCompiler.js';

// ─────────────────────────────────────────────────────────────────────────────
// Character Bible Extraction
// ─────────────────────────────────────────────────────────────────────────────

/** Sources we can extract CharacterBibleEntry[] from, in priority order */
export interface CharacterBibleSources {
  /** Raw array from parsedBrain.character_bible or project.character_bible */
  rawCharacterBible?: any[];
  /** project.story_entities — each may have .structured_data with full raw bible */
  storyEntities?: any[];
  /** project.character_identity_law — deepest level */
  characterIdentityLaw?: {
    character_registry?: Array<{ character_id: string; name: string }>;
    profiles?: Array<{
      character_id: string;
      canonical_description?: string;
      appearance_anchors?: string[];
      voice_anchors?: string[];
      motion_anchors?: string[];
      emotion_range_constraints?: string[];
      forbidden_drift_rules?: string[];
    }>;
    identity_lock_bundle?: {
      outfit_memory?: Record<string, string>;
    };
  };
  /** Legacy flat anchor string — used only when nothing else is available */
  characterAnchor?: string;
}

/**
 * Converts any available data source into CharacterBibleEntry[].
 *
 * Priority:
 *   1. rawCharacterBible[] — richest, direct from Gemini Script Brain
 *   2. storyEntities[].structured_data — same data, preserved in story entity
 *   3. characterIdentityLaw.profiles[] — derived, less granular
 *   4. characterAnchor string — last resort, produces single-entry array
 */
export function extractCharacterBibles(sources: CharacterBibleSources): CharacterBibleEntry[] {
  // ── Source 1: rawCharacterBible ───────────────────────────────────────────
  if (sources.rawCharacterBible?.length) {
    const bibles = sources.rawCharacterBible
      .map((c: any) => fromRawBibleObject(c))
      .filter((b): b is CharacterBibleEntry => Boolean(b?.name));
    if (bibles.length > 0) return bibles;
  }

  // ── Source 2: storyEntities[].structured_data ─────────────────────────────
  if (sources.storyEntities?.length) {
    const fromStructured = sources.storyEntities
      .filter((e: any) => e?.type === 'character' && e?.structured_data)
      .map((e: any) => fromRawBibleObject(e.structured_data, e.name))
      .filter((b): b is CharacterBibleEntry => Boolean(b?.name));
    if (fromStructured.length > 0) return fromStructured;

    // Fallback: build from flat description string
    const fromFlat = sources.storyEntities
      .filter((e: any) => e?.type === 'character')
      .map((e: any): CharacterBibleEntry => ({
        character_id: e.id || slugify(e.name || 'char'),
        name: e.name || 'Unknown',
        face_traits: e.description || '',
        hair: '',
        wardrobe: '',
        continuity_rules: [`Lock appearance: ${e.description || e.name}`],
      }))
      .filter((b) => Boolean(b.name));
    if (fromFlat.length > 0) return fromFlat;
  }

  // ── Source 3: characterIdentityLaw.profiles ───────────────────────────────
  if (sources.characterIdentityLaw?.profiles?.length) {
    const registry = sources.characterIdentityLaw.character_registry || [];
    const outfitMemory = sources.characterIdentityLaw.identity_lock_bundle?.outfit_memory || {};

    const bibles = sources.characterIdentityLaw.profiles.map((p: any): CharacterBibleEntry => {
      const registryEntry = registry.find((r: any) => r.character_id === p.character_id);
      const name = registryEntry?.name || p.character_id;
      return {
        character_id: p.character_id,
        name,
        face_traits: [
          p.canonical_description || '',
          ...(p.appearance_anchors || []),
        ].filter(Boolean).join('. '),
        hair: '',
        wardrobe: outfitMemory[p.character_id] || '',
        body_language: (p.motion_anchors || []).join('. '),
        emotional_signature: (p.emotion_range_constraints || []).join('. '),
        continuity_rules: [
          ...(p.forbidden_drift_rules || []),
          ...(p.appearance_anchors || []),
        ],
        voice_profile: p.voice_anchors?.length
          ? { preset: 'en_male_james', tone: p.voice_anchors[0] }
          : undefined,
      };
    }).filter((b) => Boolean(b.name));
    if (bibles.length > 0) return bibles;
  }

  // ── Source 4: characterAnchor string fallback ────────────────────────────
  if (sources.characterAnchor?.trim()) {
    return [{
      character_id: 'protagonist',
      name: 'Protagonist',
      face_traits: sources.characterAnchor.trim(),
      hair: '',
      wardrobe: '',
      continuity_rules: [`Identity lock: ${sources.characterAnchor.trim().slice(0, 200)}`],
    }];
  }

  return [];
}

/** Convert a raw Gemini character_bible object to CharacterBibleEntry */
function fromRawBibleObject(c: any, fallbackName?: string): CharacterBibleEntry | null {
  if (!c || typeof c !== 'object') return null;
  const name = c.name || fallbackName || '';
  if (!name) return null;

  // Build continuity rules from all available specifics
  const continuityRules: string[] = [];
  if (c.face_traits) continuityRules.push(`Face: ${c.face_traits}`);
  if (c.hair) continuityRules.push(`Hair: ${c.hair}`);
  if (c.outfit || c.wardrobe) continuityRules.push(`Wardrobe: ${c.outfit || c.wardrobe}`);
  if (c.signature_accessories) continuityRules.push(`Accessories: ${c.signature_accessories}`);
  if (c.skin_tone) continuityRules.push(`Skin: ${c.skin_tone}`);
  continuityRules.push('DO NOT change face, body proportions, wardrobe, or hairstyle between shots.');

  // Voice profile from Gemini output
  const voiceProfile = (c.voice_pattern || c.voice_characteristics || c.voice)
    ? {
        preset: inferVoicePreset(c.voice_pattern || c.voice_characteristics || ''),
        tone: c.voice_pattern || c.voice_characteristics || 'neutral',
        stability: 0.65,
        similarity_boost: 0.75,
      }
    : undefined;

  return {
    character_id: c.character_id || slugify(name),
    name,
    age: c.age,
    gender_presentation: c.gender || c.gender_presentation,
    face_traits: buildFaceTraits(c),
    hair: c.hair || '',
    wardrobe: c.outfit || c.wardrobe || c.costume || '',
    body_language: c.body_language || c.physical_signature || '',
    emotional_signature: c.emotional_signature || c.emotional_core || c.arc_summary || '',
    voice_profile: voiceProfile,
    continuity_rules: continuityRules,
  };
}

function buildFaceTraits(c: any): string {
  return [
    c.face_traits,
    c.eye_shape ? `Eyes: ${c.eye_shape}` : '',
    c.nose_lips ? `Mouth: ${c.nose_lips}` : '',
    c.skin_tone ? `Skin: ${c.skin_tone}` : '',
    c.age ? `Age: ${c.age}` : '',
    c.body_type ? `Build: ${c.body_type}` : '',
  ].filter(Boolean).join('. ');
}

function inferVoicePreset(voicePattern: string): string {
  const v = voicePattern.toLowerCase();
  if (v.includes('deep') || v.includes('low') || v.includes('gravelly')) return 'en_male_arnold';
  if (v.includes('soft') || v.includes('warm') || v.includes('gentle')) return 'en_female_emma';
  if (v.includes('sharp') || v.includes('crisp') || v.includes('precise')) return 'en_male_josh';
  if (v.includes('emotional') || v.includes('melodic')) return 'en_female_sarah';
  return 'en_male_james';
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

/**
 * Build a legacy flat character anchor string from bibles.
 * Used as fallback in routes that haven't been updated to pass full bibles.
 */
export function buildCharacterAnchorFromBibles(bibles: CharacterBibleEntry[]): string {
  if (!bibles.length) return '';
  return bibles
    .map(b => `[${b.name.toUpperCase()}] ${b.face_traits}. Hair: ${b.hair}. Wardrobe: ${b.wardrobe}.${b.continuity_rules?.length ? ' ' + b.continuity_rules.slice(0, 2).join(' ') : ''}`)
    .join(' | ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Director Brain Extraction
// ─────────────────────────────────────────────────────────────────────────────

export interface DirectorBrainSummaryInput {
  story_arc?: {
    opening?: string;
    development?: string;
    climax?: string;
    resolution?: string;
  };
  emotional_beats?: Array<{
    beat_id?: string;
    scene_id?: string;
    intensity?: number;
    emotion?: string;
    intent?: string;
  }>;
  visual_beats?: Array<{
    beat_id?: string;
    scene_id?: string;
    framing?: string;
    camera_angle?: string;
    lens?: string;
    lighting?: string;
  }>;
  pacing_strategy?: {
    global_pacing?: string;
    rhythm_notes?: string[];
  };
  directorial_rules?: string[];
  character_focus_rules?: Array<{
    character_id?: string;
    focus_style?: string;
    prohibited_drift?: string[];
  }>;
  continuity_rules?: string[];
}

/**
 * Extracts a shot-specific DirectorBrainInput from a DirectorBrainSummary.
 *
 * Matches emotional_beats and visual_beats by scene_id (if available),
 * otherwise uses the first available beat (global application).
 *
 * This is how Director Brain stops being display-only and actually enters prompts.
 */
export function extractDirectorBrainForShot(params: {
  directorBrain: DirectorBrainSummaryInput | null | undefined;
  sceneId?: string;
  sceneNumber?: number;
  shotRole?: string;
}): DirectorBrainInput | undefined {
  const { directorBrain, sceneId, sceneNumber } = params;
  if (!directorBrain) return undefined;

  // ── Match emotional beat for this scene ───────────────────────────────────
  let emotionalBeat = directorBrain.emotional_beats?.[0];
  if (sceneId && directorBrain.emotional_beats?.length) {
    const matched = directorBrain.emotional_beats.find(
      b => b.scene_id === sceneId ||
           (sceneNumber !== undefined && b.beat_id?.includes(String(sceneNumber)))
    );
    if (matched) emotionalBeat = matched;
  }

  // ── Match visual beat for this scene ─────────────────────────────────────
  let visualBeat = directorBrain.visual_beats?.[0];
  if (sceneId && directorBrain.visual_beats?.length) {
    const matched = directorBrain.visual_beats.find(
      b => b.scene_id === sceneId ||
           (sceneNumber !== undefined && b.beat_id?.includes(String(sceneNumber)))
    );
    if (matched) visualBeat = matched;
  }

  // ── Build DirectorBrainInput ──────────────────────────────────────────────
  const emotionalBeatStr = emotionalBeat
    ? `${emotionalBeat.emotion || ''} — ${emotionalBeat.intent || ''}`.trim().replace(/^—\s*/, '')
    : undefined;

  const lightingIntention = visualBeat?.lighting || undefined;

  const editRhythm = directorBrain.pacing_strategy?.global_pacing
    ? `Global pacing: ${directorBrain.pacing_strategy.global_pacing}${
        directorBrain.pacing_strategy.rhythm_notes?.length
          ? '. ' + directorBrain.pacing_strategy.rhythm_notes[0]
          : ''
      }`
    : undefined;

  // Global directorial rules (top 4 most important)
  const directorialRules = directorBrain.directorial_rules?.slice(0, 4) || [];
  // Append continuity rules
  const continuityRules = directorBrain.continuity_rules?.slice(0, 2) || [];
  const allRules = [...directorialRules, ...continuityRules].filter(Boolean);

  // Framing from visual beat
  const framingNote = [
    visualBeat?.framing,
    visualBeat?.camera_angle,
    visualBeat?.lens,
  ].filter(Boolean).join(', ');

  if (!emotionalBeatStr && !lightingIntention && !allRules.length) return undefined;

  return {
    global_pacing: directorBrain.pacing_strategy?.global_pacing,
    directorial_rules: allRules.length ? allRules : undefined,
    emotional_beat_for_shot: emotionalBeatStr,
    lighting_intention: lightingIntention,
    edit_rhythm: editRhythm,
    transition_to_next: framingNote || undefined,
  };
}
