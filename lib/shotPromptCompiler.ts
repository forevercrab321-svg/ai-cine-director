/**
 * lib/shotPromptCompiler.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SINGLE SOURCE OF TRUTH for all prompt construction in AI Cine Director.
 *
 * This file is the ONLY place that builds:
 *   • image prompts   (for Replicate Flux / image models)
 *   • video prompts   (for Replicate Wan / Kling / Veo / Sora / Seedance)
 *   • voice direction (for ElevenLabs character dubbing)
 *   • bgm direction   (for MusicGen / Replicate music models)
 *
 * All other prompt-building code has been deleted or redirected here.
 * Do NOT add prompt construction logic anywhere else.
 *
 * Exports (public API):
 *   composeAllPrompts(input)   → ComposeAllPromptsOutput   ← PRIMARY ENTRY POINT
 *   buildShotImagePrompt(input) → CompiledShotPrompt        ← used by batch pipeline
 *   buildShotGenerationPayload(compiled, refs) → payload    ← used by batch pipeline
 *   validateShotPromptVariance(...)  → PromptVarianceReport
 */

// ─────────────────────────────────────────────────────────────────────────────
// Internal utilities
// ─────────────────────────────────────────────────────────────────────────────

type Primitive = string | number | boolean | null | undefined;

const norm = (value: Primitive): string =>
  String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();

const normalizeTextForSim = (value: string): string =>
  norm(value).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

const tokenize = (value: string): Set<string> => {
  const cleaned = normalizeTextForSim(value);
  return new Set(cleaned.split(' ').filter((t) => t.length > 2));
};

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((term) => { if (b.has(term)) inter += 1; });
  return inter / new Set([...a, ...b]).size;
};

const toListString = (value: any): string => {
  if (Array.isArray(value)) return value.map((v) => norm(v)).filter(Boolean).join(', ');
  return norm(value);
};

const getField = (shot: any, scene: any, candidates: string[], fallback = ''): string => {
  for (const key of candidates) {
    if (shot?.[key] != null && String(shot[key]).trim()) return String(shot[key]).trim();
    if (scene?.[key] != null && String(scene[key]).trim()) return String(scene[key]).trim();
  }
  return fallback;
};

const clamp = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max).replace(/\s+\S*$/, '…') : s;

// ─────────────────────────────────────────────────────────────────────────────
// Character Bible — structure consumed from Script Brain / Director Brain output
// ─────────────────────────────────────────────────────────────────────────────

export interface CharacterBibleEntry {
  /** Stable ID used to match bible entry to shot.characters[] */
  character_id: string;
  name: string;
  age?: string;
  gender_presentation?: string;
  /** Full facial description: bone structure, eye shape/color, skin tone, distinctive marks */
  face_traits: string;
  hair: string;
  wardrobe: string;
  body_language?: string;
  /** Core emotional register: what does this character's face default to? */
  emotional_signature?: string;
  /** Voice characteristics for ElevenLabs */
  voice_profile?: {
    /** ElevenLabs preset key, e.g. 'en_male_adam' */
    preset: string;
    /** 0–1 */
    stability?: number;
    /** 0–1 */
    similarity_boost?: number;
    /** e.g. 'calm', 'intense', 'warm', 'gravelly' */
    tone?: string;
  };
  /** Free-text continuity rules, e.g. "always wears red scarf" */
  continuity_rules?: string[];
}

/** Build a compact identity-lock string from a character bible entry.
 *  Capped at 250 chars — enough to anchor the character, not dominate the prompt.
 *  The full description (face traits, hair, wardrobe) is condensed into the most
 *  distinctive markers only so that shot-specific screenplay content can lead.
 */
function characterToIdentityLock(bible: CharacterBibleEntry): string {
  // Detect non-human species from face_traits / wardrobe description
  const combinedTraits = `${bible.face_traits || ''} ${(bible as any).outfit || bible.wardrobe || ''}`.toLowerCase();
  const nonHumanSpeciesMatch = combinedTraits.match(
    /\b(cat|dog|rabbit|fox|bear|wolf|tiger|lion|panda|deer|owl|eagle|dragon|anime|cartoon|creature|monster|alien|robot|cyborg|anthropomorphic|furry|humanoid animal)\b/
  );
  const isNonHuman = !!nonHumanSpeciesMatch;
  const speciesLabel = isNonHuman ? nonHumanSpeciesMatch![0].toUpperCase() : '';

  const faceShort = bible.face_traits ? clamp(bible.face_traits, 90) : '';
  const hairShort = bible.hair ? `hair/fur: ${clamp(bible.hair, 45)}` : '';
  const wardrobeShort = ((bible as any).outfit || bible.wardrobe)
    ? `wearing: ${clamp((bible as any).outfit || bible.wardrobe, 55)}`
    : '';
  const bodyShort = (bible as any).body_type ? `build: ${clamp((bible as any).body_type, 40)}` : '';

  const nonHumanDirective = isNonHuman
    ? `[NON-HUMAN ${speciesLabel}] Render as ${speciesLabel} species — do NOT humanise. Preserve animal anatomy, proportions, and species-specific facial features exactly.`
    : 'DO NOT alter face, race, gender, or wardrobe.';

  const parts = [
    `[${bible.name.toUpperCase()} IDENTITY LOCK]`,
    faceShort,
    hairShort,
    bodyShort,
    wardrobeShort,
    nonHumanDirective,
  ].filter(Boolean).join('. ');
  return clamp(parts, 300);
}

// ─────────────────────────────────────────────────────────────────────────────
// Director Brain — structured output consumed from Director Brain layer
// ─────────────────────────────────────────────────────────────────────────────

export interface DirectorBrainInput {
  /** e.g. "slow burn psychological thriller" */
  global_pacing?: string;
  /** Array of free-text directorial rules, e.g. "never shoot below eye-line in act 1" */
  directorial_rules?: string[];
  /** Per-shot emotional beat from Director Brain */
  emotional_beat_for_shot?: string;
  /** Lighting intention from Director Brain */
  lighting_intention?: string;
  /** Edit rhythm hint, e.g. "hold 3 seconds, cut on exhale" */
  edit_rhythm?: string;
  /** Transition logic to NEXT shot */
  transition_to_next?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Composer input/output contracts
// ─────────────────────────────────────────────────────────────────────────────

export interface ComposeAllPromptsInput {
  // ── Core shot & scene data ────────────────────────────────────────────────
  shot: any;
  scene?: any;

  // ── Style ─────────────────────────────────────────────────────────────────
  styleBible?: {
    color_palette?: string;
    lens_language?: string;
    art_direction?: string;
    lighting?: string;
    visual_style?: string;
  };
  styleLabel?: string;

  // ── Character layer ───────────────────────────────────────────────────────
  /** Full character bibles. Matched to shot.characters[] by name (case-insensitive). */
  characterBibles?: CharacterBibleEntry[];
  /** Legacy flat anchor string — used when characterBibles not available */
  characterAnchor?: string;

  // ── Director Brain layer ──────────────────────────────────────────────────
  directorBrain?: DirectorBrainInput;

  // ── Continuity context ────────────────────────────────────────────────────
  previousShot?: any;
  previousPrompt?: string;
  continuityState?: any;

  // ── Shot graph node (Director OS temporal guidance) ───────────────────────
  shotGraphNode?: {
    temporal_guidance?: {
      previous_visual_state?: string;
      start_frame_intent?: string;
      mid_frame_intent?: string;
      end_frame_intent?: string;
      next_visual_target_state?: string;
    };
    continuity_in?: string;
    continuity_out?: string;
    motion_bridge?: string;
    expression_bridge?: string;
    environment_bridge?: string;
  };
}

export interface VoiceDirection {
  /** The exact text to send to ElevenLabs */
  text: string;
  /** ElevenLabs preset key, e.g. 'en_male_adam' */
  voice_preset: string;
  /** 0–1 */
  stability: number;
  /** 0–1 */
  similarity_boost: number;
  /** Mapped to ElevenLabs style_exaggeration via emotionToStyle() */
  emotion: string;
  /** Human-readable performance note for director reference */
  performance_note: string;
}

export interface BgmDirection {
  /** Full music generation vibe string — sent directly to MusicGen prompt */
  vibe: string;
  /** 0–100, drives the music style selection */
  tension_level: number;
  /** Estimated scene duration in seconds — sets MusicGen duration param */
  duration_sec: number;
  /** Named instrumentation intent */
  instrumentation: string;
}

export interface ComposeAllPromptsOutput {
  // ── Image generation prompt (Replicate Flux / image models) ───────────────
  /** Full model prompt — send as `prompt` to Replicate image API */
  image_prompt: string;
  /** Negative prompt — send as `negative_prompt` */
  image_negative_prompt: string;

  // ── Video generation prompt (Replicate Wan / Kling / Veo) ─────────────────
  /** Temporal motion prompt — send as `prompt` or `video_prompt` to Replicate video API */
  video_prompt: string;
  /** Alias for models that use `motion_prompt` field */
  motion_prompt: string;
  /** Per-frame expression direction (optional, for models that support it) */
  expression_prompt: string;

  // ── Voice dubbing (ElevenLabs) ────────────────────────────────────────────
  /** Null when shot has no dialogue */
  voice_direction: VoiceDirection | null;

  // ── Background music (MusicGen / Replicate) ───────────────────────────────
  bgm_direction: BgmDirection;

  // ── Metadata ──────────────────────────────────────────────────────────────
  shot_id: string;
  scene_id: string;
  /** Human-readable summary for UI display */
  shot_summary: string;
  variance_report: PromptVarianceReport;
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy types (kept for batch pipeline compatibility)
// ─────────────────────────────────────────────────────────────────────────────

export interface ShotPromptCompilerInput extends ComposeAllPromptsInput {}

export interface ShotDeltaReport {
  changed_fields: string[];
  summary: string;
}

export interface PromptVarianceReport {
  similarity_score: number;
  overlap_score: number;
  requires_substantive_change: boolean;
  has_substantive_change: boolean;
  pass: boolean;
  fail_reasons: string[];
  delta: ShotDeltaReport;
}

export interface CompiledShotPrompt {
  shot_id: string;
  scene_id: string;
  shot_summary: string;
  user_readable_prompt: string;
  model_prompt: string;
  negative_prompt: string;
  continuity_notes: string[];
  variance_report: PromptVarianceReport;
  generation_payload: {
    prompt: string;
    negative_prompt: string;
    reference_policy: string;
    continuity_notes: string[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Variance / delta helpers
// ─────────────────────────────────────────────────────────────────────────────

const getShotDelta = (currentShot: any, previousShot?: any): ShotDeltaReport => {
  if (!previousShot) {
    return { changed_fields: ['initial_shot'], summary: 'First shot in sequence' };
  }

  const comparePairs: Array<{ key: string; current: string; previous: string }> = [
    { key: 'location', current: norm(currentShot?.location || currentShot?.scene_setting), previous: norm(previousShot?.location || previousShot?.scene_setting) },
    { key: 'characters', current: toListString(currentShot?.characters), previous: toListString(previousShot?.characters) },
    { key: 'image_prompt', current: norm(currentShot?.image_prompt), previous: norm(previousShot?.image_prompt) },
    { key: 'action', current: norm(currentShot?.action || currentShot?.visual_description), previous: norm(previousShot?.action || previousShot?.visual_description) },
    { key: 'emotion', current: norm(currentShot?.emotion || currentShot?.mood || currentShot?.emotional_beat), previous: norm(previousShot?.emotion || previousShot?.mood || previousShot?.emotional_beat) },
    { key: 'camera_framing', current: norm(currentShot?.camera_framing || currentShot?.composition || currentShot?.framing), previous: norm(previousShot?.camera_framing || previousShot?.composition || previousShot?.framing) },
    { key: 'camera_angle', current: norm(currentShot?.camera_angle), previous: norm(previousShot?.camera_angle) },
    { key: 'time_of_day', current: norm(currentShot?.time_of_day), previous: norm(previousShot?.time_of_day) },
    { key: 'lighting', current: norm(currentShot?.lighting), previous: norm(previousShot?.lighting) },
    { key: 'props', current: norm(currentShot?.props || currentShot?.sfx_vfx || currentShot?.art_direction), previous: norm(previousShot?.props || previousShot?.sfx_vfx || previousShot?.art_direction) },
  ];

  const changed = comparePairs.filter((row) => row.current !== row.previous).map((row) => row.key);

  return {
    changed_fields: changed,
    summary: changed.length > 0 ? `Changed: ${changed.join(', ')}` : 'No major structural delta',
  };
};

export function validateShotPromptVariance(
  currentPrompt: string,
  previousPrompt: string | undefined,
  shotDelta: ShotDeltaReport,
): PromptVarianceReport {
  if (!previousPrompt) {
    return {
      similarity_score: 0, overlap_score: 0,
      requires_substantive_change: false, has_substantive_change: true,
      pass: true, fail_reasons: [], delta: shotDelta,
    };
  }

  // ── Strip shared preamble before comparing ────────────────────────────────
  // Phase 2 injects an identical CHARACTER IDENTITY LOCK + DIRECTOR MANDATE
  // block at the top of every prompt. Comparing full prompts inflates
  // similarity scores and causes false positives on the variance check.
  // Only the shot-specific portion (starting at "Scene context:") is
  // meaningful for variance detection.
  const extractShotVariable = (p: string): string => {
    const marker = 'Scene context:';
    const idx = p.indexOf(marker);
    return idx > 0 ? p.slice(idx) : p;
  };
  const varCurrent = extractShotVariable(currentPrompt);
  const varPrevious = extractShotVariable(previousPrompt);

  const similarity = jaccard(tokenize(varCurrent), tokenize(varPrevious));
  const overlap = jaccard(
    tokenize(varCurrent.slice(0, 400)),
    tokenize(varPrevious.slice(0, 400)),
  );

  const requiresChange = shotDelta.changed_fields.length > 0;
  const hasSubstantiveChange = similarity < 0.9 || overlap < 0.92;
  const failReasons: string[] = [];

  if (requiresChange && !hasSubstantiveChange)
    failReasons.push('shot fields changed but prompts remain highly similar');
  if (requiresChange && similarity >= 0.88)
    failReasons.push('prompt similarity too high for changed shot semantics');

  return {
    similarity_score: Number(similarity.toFixed(4)),
    overlap_score: Number(overlap.toFixed(4)),
    requires_substantive_change: requiresChange,
    has_substantive_change: hasSubstantiveChange,
    pass: failReasons.length === 0,
    fail_reasons: failReasons,
    delta: shotDelta,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Character resolution helper
// ─────────────────────────────────────────────────────────────────────────────

function resolveBiblesForShot(
  shotCharacters: string[],
  characterBibles: CharacterBibleEntry[],
): CharacterBibleEntry[] {
  if (!characterBibles?.length || !shotCharacters?.length) return [];
  return shotCharacters
    .map(name =>
      characterBibles.find(b =>
        b.name.toLowerCase() === name.toLowerCase() ||
        b.character_id.toLowerCase() === name.toLowerCase()
      )
    )
    .filter((b): b is CharacterBibleEntry => Boolean(b));
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice direction builder
// ─────────────────────────────────────────────────────────────────────────────

const EMOTION_TO_VOICE_PRESET: Record<string, string> = {
  angry: 'en_male_arnold',
  rage: 'en_male_arnold',
  sad: 'en_female_sarah',
  grief: 'en_female_sarah',
  excited: 'en_male_josh',
  joy: 'en_male_josh',
  calm: 'en_female_emma',
  peaceful: 'en_female_emma',
  resolved: 'en_male_james',
  fear: 'en_female_rachel',
  nervous: 'en_female_rachel',
};

const EMOTION_TO_STABILITY: Record<string, number> = {
  angry: 0.3, sad: 0.4, excited: 0.45, calm: 0.8, neutral: 0.7, fear: 0.35,
};

const EMOTION_TO_SIMILARITY: Record<string, number> = {
  angry: 0.9, sad: 0.6, excited: 0.9, calm: 0.5, neutral: 0.6, fear: 0.85,
};

function buildVoiceDirection(params: {
  dialogue: string;
  speaker: string;
  emotion: string;
  bible?: CharacterBibleEntry;
  subtext?: string;
}): VoiceDirection {
  const { dialogue, speaker, emotion, bible, subtext } = params;
  const emotionKey = emotion.toLowerCase().split(' ')[0] || 'neutral';

  const preset = bible?.voice_profile?.preset
    || EMOTION_TO_VOICE_PRESET[emotionKey]
    || 'en_male_james';

  const stability = bible?.voice_profile?.stability
    ?? EMOTION_TO_STABILITY[emotionKey]
    ?? 0.65;

  const similarityBoost = bible?.voice_profile?.similarity_boost
    ?? EMOTION_TO_SIMILARITY[emotionKey]
    ?? 0.7;

  const voiceTone = bible?.voice_profile?.tone || emotionKey;
  const performanceNote = [
    `Deliver as ${speaker || 'character'} with ${voiceTone} tone`,
    `Emotion: ${emotion}`,
    subtext ? `Subtext: ${subtext}` : '',
    bible?.emotional_signature ? `Character default register: ${bible.emotional_signature}` : '',
  ].filter(Boolean).join('. ');

  return {
    text: dialogue,
    voice_preset: preset,
    stability,
    similarity_boost: similarityBoost,
    emotion: emotionKey,
    performance_note: clamp(performanceNote, 300),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BGM direction builder
// ─────────────────────────────────────────────────────────────────────────────

function buildBgmDirection(params: {
  scene: any;
  shot: any;
  styleBible?: any;
}): BgmDirection {
  const { scene, shot, styleBible } = params;
  const tension: number = Number(scene?.tension_level ?? shot?.tension_level ?? 40);
  const title = scene?.scene_title || shot?.scene_title || '';
  const emotionalBeat = scene?.emotional_beat || shot?.mood || shot?.emotion || '';
  const audioNotes = shot?.audio_notes || scene?.audio_description || '';
  const styleHint = styleBible?.visual_style || styleBible?.art_direction || '';
  const sceneContext = [title, emotionalBeat].filter(Boolean).join(' — ');

  let instrumentation: string;
  let vibeCore: string;

  if (tension >= 80) {
    instrumentation = 'full orchestra, brass stabs, low brass, pounding timpani, string tremolo';
    vibeCore = `Intense cinematic thriller, Hans Zimmer / Junkie XL style. ${sceneContext}`;
  } else if (tension >= 65) {
    instrumentation = 'strings, French horns, rising brass, cinematic tension buildup';
    vibeCore = `Dramatic rising suspense, strings-driven climax build. ${sceneContext}`;
  } else if (tension >= 50) {
    instrumentation = 'cello, violin, muted brass, ambient piano';
    vibeCore = `Mid-tension cinematic underscore, emotional weight. ${sceneContext}`;
  } else if (tension >= 35) {
    instrumentation = 'piano, light strings, subtle electronic texture';
    vibeCore = `Contemplative cinematic ambient, bittersweet. ${sceneContext}`;
  } else if (tension >= 20) {
    instrumentation = 'acoustic guitar, soft piano, light percussion';
    vibeCore = `Gentle emotional warmth, breathing room. ${sceneContext}`;
  } else {
    instrumentation = 'minimal ambient, sparse texture, soft pads';
    vibeCore = `Quiet introspective atmosphere. ${sceneContext}`;
  }

  const vibe = [
    vibeCore,
    audioNotes ? `Audio mood: ${audioNotes}` : '',
    styleHint ? `Visual style: ${styleHint}` : '',
    `Instrumentation: ${instrumentation}`,
    'No lyrics. Cinematic score only.',
  ].filter(Boolean).join('. ');

  const sceneShots = (scene as any)?.shots;
  const durationSec = Array.isArray(sceneShots)
    ? sceneShots.reduce((s: number, sh: any) => s + (sh.duration_sec || 4), 0)
    : Number(shot?.duration_sec ?? 10);

  return {
    vibe: clamp(vibe, 400),
    tension_level: tension,
    duration_sec: Math.max(10, Math.ceil(durationSec)),
    instrumentation,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Image prompt builder (replaces buildProfessionalImagePrompt in api/index.ts)
// ─────────────────────────────────────────────────────────────────────────────

function buildImagePromptFromComposer(params: {
  shot: any;
  scene: any;
  styleBible: any;
  resolvedBibles: CharacterBibleEntry[];
  characterAnchor: string;
  directorBrain?: DirectorBrainInput;
  shotGraphNode?: ComposeAllPromptsInput['shotGraphNode'];
  styleLabel?: string;
}): { prompt: string; negativePrompt: string } {
  const { shot, scene, styleBible, resolvedBibles, characterAnchor, directorBrain, shotGraphNode, styleLabel } = params;

  // ── Core shot fields ──────────────────────────────────────────────────────
  // Shot & scene numbers give each prompt a unique fingerprint even when
  // fields overlap — critical for screenplay-driven multi-shot batches.
  const sceneNumber = shot.scene_number ?? scene?.scene_number ?? '';
  const shotNumber = shot.shot_number ?? '';
  // Finding 4.2: fingerprint is ALWAYS non-empty — use fallback IDs so every prompt is unique
  const shotLabel = `[Scene ${sceneNumber || (shot.scene_id ? shot.scene_id.slice(-4) : '?')} / Shot ${shotNumber || (shot.shot_id ? shot.shot_id.slice(-4) : '?')}]`;

  // perShotImagePrompt is the screenplay-generated visual directive from Gemini.
  // This is the PRIMARY differentiator between shots — it describes THIS specific
  // story moment, not the character in general.
  const perShotImagePrompt = shot.image_prompt ? String(shot.image_prompt).trim() : '';
  const sceneSummary = getField(shot, scene, ['scene_summary', 'scene_synopsis', 'synopsis'], '');
  const shotDescription = getField(shot, scene, ['shot_description', 'visual_description'], '');
  const location = getField(shot, scene, ['location', 'scene_setting'], 'Cinematic environment');
  const timeOfDay = getField(shot, scene, ['time_of_day'], '');
  const action = getField(shot, scene, ['action', 'shot_description', 'visual_description'], '');
  // emotion: Director Brain per-shot beat takes priority (matched by scene), then shot field
  const emotion = directorBrain?.emotional_beat_for_shot
    || getField(shot, scene, ['emotion', 'mood', 'emotional_beat'], '');
  const cameraFraming = getField(shot, scene, ['camera_framing', 'composition', 'framing', 'camera'], 'balanced framing');
  const cameraAngle = getField(shot, scene, ['camera_angle', 'camera'], 'medium shot');
  const lensStyle = getField(shot, scene, ['lens_style', 'lens', 'lens_hint'], styleBible?.lens_language || '35mm cinematic prime');
  // lighting: Director Brain lighting intention takes priority (matched by scene), then shot field
  const lighting = directorBrain?.lighting_intention
    || getField(shot, scene, ['lighting'], styleBible?.lighting || 'motivated cinematic lighting');
  const negativeRaw = getField(shot, scene, ['negative_constraints', 'negative_prompt'], '');

  // ── Primary visual directive — the screenplay moment ─────────────────────
  // Compose the most descriptive, shot-specific statement we have.
  // Priority: screenplay-generated image_prompt > shot_description > action.
  // This block goes FIRST in the prompt so the model weights it highest.
  const primaryVisual = perShotImagePrompt
    || shotDescription
    || action
    || 'Character beat in motion';

  // ── Character identity locks (compact — appear at END as a constraint) ────
  // Placed LAST so screenplay content dominates. The model still enforces
  // identity; it just doesn't let the lock crowd out the story beat.
  // ★ Guard: if perShotImagePrompt already starts with "[... LOCK]", skip the
  //   secondary lock to avoid doubling up (the stored image_prompt from the
  //   pipeline already has the character lock prepended at generation time).
  const imagePromptAlreadyHasLock = /^\[.*\s+LOCK\]/.test(perShotImagePrompt);
  const identityLocks: string[] = [];
  if (!imagePromptAlreadyHasLock) {
    if (resolvedBibles.length > 0) {
      resolvedBibles.forEach(b => identityLocks.push(characterToIdentityLock(b)));
    } else if (characterAnchor) {
      identityLocks.push(`IDENTITY LOCK: ${clamp(characterAnchor, 200)}`);
    }
  }

  // ── Director mandate (brief — rules guide tone, not replace the shot) ─────
  const directorParts: string[] = [];
  if (directorBrain?.directorial_rules?.length) {
    // max 2 rules so they don't crowd out shot-specific content
    directorParts.push(`Director rules: ${directorBrain.directorial_rules.slice(0, 2).join('; ')}`);
  }

  // ── Shot graph temporal guidance ──────────────────────────────────────────
  const tg = shotGraphNode?.temporal_guidance;
  const temporalParts: string[] = [
    tg?.start_frame_intent ? `Frame open: ${tg.start_frame_intent}` : '',
    tg?.end_frame_intent ? `Frame close: ${tg.end_frame_intent}` : '',
    shotGraphNode?.continuity_in ? `Continuity in: ${shotGraphNode.continuity_in}` : '',
  ].filter(Boolean);

  // ── Style mandate ─────────────────────────────────────────────────────────
  const styleParts: string[] = [
    styleBible?.color_palette ? `Colour palette: ${styleBible.color_palette}` : '',
    styleBible?.art_direction ? `Art direction: ${styleBible.art_direction}` : '',
    styleLabel ? `Visual style: ${styleLabel}` : '',
  ].filter(Boolean);

  // ── Characters present ────────────────────────────────────────────────────
  const characters = Array.isArray(shot.characters)
    ? shot.characters.map((c: any) => String(c).trim()).filter(Boolean)
    : [];

  // ── Assemble final prompt — SCREENPLAY CONTENT LEADS ─────────────────────
  //
  // Ordering rationale:
  //   ① Shot identifier + primary visual   → unique per shot, model weights first
  //   ② Scene context (story beat)         → what story moment this serves
  //   ③ Action description                 → what is physically happening
  //   ④ Location + time                    → where and when
  //   ⑤ Emotion / director beat            → how this shot feels
  //   ⑥ Camera + lighting                  → technical execution
  //   ⑦ Temporal / continuity bridge       → link to adjacent shots
  //   ⑧ Style locks                        → film-wide visual language
  //   ⑨ Director rules                     → global constraints (brief)
  //   ⑩ Character identity lock            → LAST: enforces appearance without crowding screenplay
  //   ⑪ Characters present                 → names for final pass
  //   ⑫ Technical quality mandate          → always last line
  //
  const prompt = [
    // ① Shot identifier + screenplay visual directive (most unique content)
    // ★ 600 chars (≈100 words) — enough to preserve full Gemini image_prompt without truncation
    `${shotLabel} ${clamp(primaryVisual, 600)}`.trim(),
    // ② Scene context — the story beat this shot serves
    sceneSummary ? `Scene context: ${clamp(sceneSummary, 220)}` : '',
    // ③ Action — what is physically happening in this frame
    action && action !== primaryVisual ? `Action: ${clamp(action, 180)}` : '',
    // ④ Location + time
    `Location: ${location}${timeOfDay ? `, ${timeOfDay}` : ''}`,
    // ⑤ Emotion / director beat
    emotion ? `Emotion: ${emotion}` : '',
    // ⑥ Camera + lighting
    `Camera: ${cameraAngle}, ${cameraFraming}. Lens: ${lensStyle}`,
    `Lighting: ${clamp(lighting, 180)}`,
    // ⑦ Temporal bridge
    temporalParts.length > 0 ? temporalParts.join('. ') : '',
    // ⑧ Style locks
    styleParts.length > 0 ? styleParts.join('. ') : '',
    // ⑨ Director rules (brief)
    directorParts.length > 0 ? directorParts.join('. ') : '',
    // ⑩ Character identity constraint (at the END — anchor not preamble)
    identityLocks.length > 0
      ? `Character identity — do NOT alter: ${identityLocks.join(' | ')}`
      : characters.length > 0 ? 'Maintain full visual continuity with established film style' : '',
    // ⑪ Characters present
    characters.length > 0 ? `Characters: ${characters.join(', ')}` : '',
    // ⑫ Technical quality mandate
    'Cinematic still frame, high detail, physically plausible lighting. Single coherent film frame — not a collage or split screen.',
  ].filter(Boolean).join('. ');

  // ── Negative prompt (Finding 10.2: always non-empty) ──────────────────────
  const negativePrompt = [
    negativeRaw,
    'identity drift, wrong outfit, costume change, different hairstyle, wrong props',
    'multiple versions of the same character, cloned faces, duplicate figures',
    'generic stock photo look, unrelated background, wrong location',
    'same composition as previous shot when shot context changed',
    'watermark, text overlay, letterbox bars, split screen, collage, blurry',
    'extra limbs, distorted anatomy, deformed hands, missing fingers',
    // Non-human character protection
    'humanised animal face, wrong species anatomy, realistic human face on cartoon character',
  ].filter(Boolean).join(', ');

  return { prompt: clamp(prompt, 1800), negativePrompt: clamp(negativePrompt, 600) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Video prompt builder (replaces buildProfessionalVideoPrompt in api/index.ts)
// ─────────────────────────────────────────────────────────────────────────────

function buildVideoPromptFromComposer(params: {
  shot: any;
  scene: any;
  resolvedBibles: CharacterBibleEntry[];
  characterAnchor: string;
  directorBrain?: DirectorBrainInput;
  shotGraphNode?: ComposeAllPromptsInput['shotGraphNode'];
}): { videoPrompt: string; motionPrompt: string; expressionPrompt: string } {
  const { shot, scene, resolvedBibles, characterAnchor, directorBrain, shotGraphNode } = params;

  // The stored video_prompt / video_motion_prompt from Gemini shot planner is the primary source.
  // We enrich it with identity locks and temporal guidance — we do NOT replace it.
  const rawVideoPrompt = shot.video_prompt || shot.video_motion_prompt || shot.shot_type || '';
  const rawAction = shot.action || scene?.audio_description || '';
  const location = getField(shot, scene, ['location', 'scene_setting'], 'scene location');
  const lighting = directorBrain?.lighting_intention
    || getField(shot, scene, ['lighting'], 'consistent motivated lighting');
  const movement = shot.movement || shot.camera_motion || 'measured';
  const camera = shot.camera || shot.camera_framing || 'medium shot';

  // ── Identity locks ────────────────────────────────────────────────────────
  const identityLock = resolvedBibles.length > 0
    ? resolvedBibles.map(b => `[${b.name.toUpperCase()} LOCK] ${b.face_traits}. Wardrobe: ${b.wardrobe}. ZERO TOLERANCE FOR FACE/BODY DRIFT.`).join(' | ')
    : characterAnchor
    ? `[IDENTITY LOCK] KEEP EXACT SAME SUBJECT IDENTITY AND WARDROBE: ${clamp(characterAnchor, 300)}.`
    : '[IDENTITY LOCK] keep exact same subject identity and wardrobe.';

  // ── Temporal guidance ─────────────────────────────────────────────────────
  const tg = shotGraphNode?.temporal_guidance;
  const temporalGuidance = [
    tg?.start_frame_intent ? `Second 0–1: ${tg.start_frame_intent}` : '',
    tg?.mid_frame_intent ? `Second 1–2: ${tg.mid_frame_intent}` : '',
    tg?.end_frame_intent ? `Final beat: ${tg.end_frame_intent}` : `Final beat: hold for edit point`,
  ].filter(Boolean).join('. ');

  const motionDefault = rawAction
    ? `Second 0–1: settle frame, micro-motion breathing. Second 1–2: ${rawAction}. Final beat: clear head or body secondary action, hold for edit point.`
    : `Second 0–1: settle frame and breathing micro-motion. Second 1–2: subject performs clear physical action. Final beat: hold for edit point.`;

  // ── Director edit rhythm ──────────────────────────────────────────────────
  const editNote = directorBrain?.edit_rhythm || '';

  // ── Assemble ──────────────────────────────────────────────────────────────
  const videoPrompt = [
    rawVideoPrompt ? `[MOTION DIRECTIVE] ${rawVideoPrompt}` : '',
    `[CAMERA PLAN] ${camera}, ${movement} camera movement.`,
    `[TIMED BLOCKING] ${temporalGuidance || motionDefault}`,
    identityLock,
    `[SCENE TOPOLOGY LOCK] Remain in ${location}. Lighting: ${clamp(lighting, 160)}. DO NOT hallucinate new geometry. NO environment jump. NO costume drift.`,
    editNote ? `[EDIT RHYTHM] ${editNote}` : '',
  ].filter(Boolean).join(' ');

  // ── Expression prompt (for models that support facial direction) ──────────
  const emotion = directorBrain?.emotional_beat_for_shot
    || getField(shot, scene, ['emotion', 'mood', 'emotional_beat'], 'neutral resolve');
  const expressionPrompt = [
    `Facial expression: ${emotion}`,
    resolvedBibles.length > 0 ? `Character emotional signature: ${resolvedBibles[0].emotional_signature || emotion}` : '',
    `Micro-expression: genuine, not performed — camera catches the exact transition moment`,
  ].filter(Boolean).join('. ');

  const motionPrompt = clamp(videoPrompt, 1600);

  return {
    videoPrompt: motionPrompt,
    motionPrompt,
    expressionPrompt: clamp(expressionPrompt, 300),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ★ PRIMARY ENTRY POINT: composeAllPrompts()
// ─────────────────────────────────────────────────────────────────────────────
//
// This replaces ALL of the following:
//   • buildProfessionalImagePrompt()  (was in api/index.ts)
//   • buildProfessionalVideoPrompt()  (was in api/index.ts)
//   • inline prompt strings           (were in director-pipeline.ts, SceneCard.tsx)
//
// Call this function whenever you need any prompt. Do not build prompts elsewhere.
//
export function composeAllPrompts(input: ComposeAllPromptsInput): ComposeAllPromptsOutput {
  const shot = input.shot || {};
  const scene = input.scene || {};
  const styleBible = input.styleBible || {};
  const characterBibles = input.characterBibles || [];
  const directorBrain = input.directorBrain;

  // ── Resolve character bibles for this specific shot ───────────────────────
  const shotCharacters = Array.isArray(shot.characters)
    ? shot.characters.map((c: any) => String(c).trim()).filter(Boolean)
    : [];
  const resolvedBibles = resolveBiblesForShot(shotCharacters, characterBibles);

  // ── Build image prompt ────────────────────────────────────────────────────
  const { prompt: imagePrompt, negativePrompt: imageNegativePrompt } = buildImagePromptFromComposer({
    shot, scene, styleBible, resolvedBibles,
    characterAnchor: input.characterAnchor || '',
    directorBrain, shotGraphNode: input.shotGraphNode, styleLabel: input.styleLabel,
  });

  // ── Build video prompts ───────────────────────────────────────────────────
  const { videoPrompt, motionPrompt, expressionPrompt } = buildVideoPromptFromComposer({
    shot, scene, resolvedBibles,
    characterAnchor: input.characterAnchor || '',
    directorBrain, shotGraphNode: input.shotGraphNode,
  });

  // ── Build voice direction ─────────────────────────────────────────────────
  const dialogue = (shot.dialogue_text || shot.dialogue || '').trim();
  let voiceDirection: VoiceDirection | null = null;
  if (dialogue) {
    const speaker = shot.dialogue_speaker || shotCharacters[0] || 'Character';
    const emotion = directorBrain?.emotional_beat_for_shot
      || getField(shot, scene, ['emotion', 'mood', 'emotional_beat'], 'neutral');
    const bible = resolvedBibles.find(b =>
      b.name.toLowerCase() === speaker.toLowerCase()
    ) || resolvedBibles[0];
    voiceDirection = buildVoiceDirection({
      dialogue, speaker, emotion,
      bible,
      subtext: shot.dialogue_subtext || '',
    });
  }

  // ── Build BGM direction ───────────────────────────────────────────────────
  const bgmDirection = buildBgmDirection({ scene, shot, styleBible });

  // ── Variance report (for batch deduplication) ─────────────────────────────
  const shotDelta = getShotDelta(shot, input.previousShot);
  const varianceReport = validateShotPromptVariance(imagePrompt, input.previousPrompt, shotDelta);

  // ── Metadata ──────────────────────────────────────────────────────────────
  const shotId = String(shot.shot_id || '');
  const sceneId = String(shot.scene_id || scene.scene_id || '');
  const location = getField(shot, scene, ['location', 'scene_setting'], 'unknown');
  const timeOfDay = getField(shot, scene, ['time_of_day'], '');
  const shotDesc = getField(shot, scene, ['image_prompt', 'shot_description', 'visual_description', 'action'], 'Shot');

  return {
    image_prompt: imagePrompt,
    image_negative_prompt: imageNegativePrompt,
    video_prompt: videoPrompt,
    motion_prompt: motionPrompt,
    expression_prompt: expressionPrompt,
    voice_direction: voiceDirection,
    bgm_direction: bgmDirection,
    shot_id: shotId,
    scene_id: sceneId,
    shot_summary: `${clamp(shotDesc, 80)} @ ${location}${timeOfDay ? ` (${timeOfDay})` : ''}`,
    variance_report: varianceReport,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildShotImagePrompt() — kept for batch pipeline (BatchImagePanel SSE flow)
// Internally delegates to composeAllPrompts() for the image/negative prompts.
// ─────────────────────────────────────────────────────────────────────────────

export function buildShotImagePrompt(input: ShotPromptCompilerInput): CompiledShotPrompt {
  // Delegate image/negative prompt to the unified composer
  const composed = composeAllPrompts(input);

  const shot = input.shot || {};
  const scene = input.scene || {};
  const styleBible = input.styleBible || {};

  // Rebuild continuity_notes for the legacy CompiledShotPrompt shape
  const characters = Array.isArray(shot.characters)
    ? shot.characters.map((c: any) => String(c).trim()).filter(Boolean)
    : [];
  const continuityConstraints = getField(shot, scene, ['continuity_constraints', 'continuity_notes', 'continuity_from_previous'], 'preserve character identity, wardrobe, and key props');
  const motionBridge = input.shotGraphNode?.motion_bridge || '';
  const expressionBridge = input.shotGraphNode?.expression_bridge || '';

  const continuityNotes = [
    continuityConstraints,
    input.characterAnchor ? `Character identity anchor: ${input.characterAnchor}` : '',
    characters.length ? `Characters in shot: ${characters.join(', ')}` : 'No visible character required if shot is environmental',
    styleBible?.color_palette ? `Style palette lock: ${styleBible.color_palette}` : '',
    styleBible?.lens_language ? `Style lens language: ${styleBible.lens_language}` : '',
    motionBridge ? `Motion bridge: ${motionBridge}` : '',
    expressionBridge ? `Expression bridge: ${expressionBridge}` : '',
  ].filter(Boolean);

  const emotion = getField(shot, scene, ['emotion', 'mood', 'emotional_beat'], 'cinematic tension');
  const cameraAngle = getField(shot, scene, ['camera_angle', 'camera'], 'medium');
  const cameraFraming = getField(shot, scene, ['camera_framing', 'composition', 'framing'], 'balanced framing');
  const location = getField(shot, scene, ['location', 'scene_setting'], 'Unknown location');
  const timeOfDay = getField(shot, scene, ['time_of_day'], 'unspecified time');
  const lighting = getField(shot, scene, ['lighting'], styleBible?.lighting || 'motivated cinematic lighting');
  const shotDescription = getField(shot, scene, ['image_prompt', 'shot_description', 'visual_description', 'action'], 'Character beat in motion');

  const userReadablePrompt = [
    `🎬 ${clamp(shotDescription, 120)}`,
    `📍 ${location} · ${timeOfDay}`,
    `🎭 ${emotion}`,
    `📷 ${cameraAngle} / ${cameraFraming}`,
    `🔦 ${lighting}`,
  ].join('\n');

  return {
    shot_id: composed.shot_id,
    scene_id: composed.scene_id,
    shot_summary: composed.shot_summary,
    user_readable_prompt: userReadablePrompt,
    model_prompt: composed.image_prompt,
    negative_prompt: composed.image_negative_prompt,
    continuity_notes: continuityNotes,
    variance_report: composed.variance_report,
    generation_payload: {
      prompt: composed.image_prompt,
      negative_prompt: composed.image_negative_prompt,
      reference_policy: String(shot.reference_policy || 'anchor'),
      continuity_notes: continuityNotes,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildShotGenerationPayload() — unchanged, used by batch pipeline
// ─────────────────────────────────────────────────────────────────────────────

export function buildShotGenerationPayload(
  compiled: CompiledShotPrompt,
  refs: {
    anchorImage?: string;
    previousFrame?: string;
    firstFrameInScene?: string;
  },
): {
  prompt: string;
  negative_prompt: string;
  reference_image_url?: string;
  reference_policy: string;
  continuity_notes: string[];
  variance_report: PromptVarianceReport;
} {
  const policy = compiled.generation_payload.reference_policy;
  let referenceImageUrl: string | undefined;

  if (policy === 'previous-frame') {
    referenceImageUrl = refs.previousFrame || refs.anchorImage;
  } else if (policy === 'first-frame') {
    referenceImageUrl = refs.firstFrameInScene || refs.anchorImage;
  } else if (policy === 'anchor') {
    referenceImageUrl = refs.anchorImage;
  }

  return {
    prompt: compiled.model_prompt,
    negative_prompt: compiled.negative_prompt,
    reference_image_url: referenceImageUrl,
    reference_policy: policy,
    continuity_notes: compiled.continuity_notes,
    variance_report: compiled.variance_report,
  };
}
