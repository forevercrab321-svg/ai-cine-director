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
// Screenplay binding — canonical rewriter integration
// ─────────────────────────────────────────────────────────────────────────────
import {
  rewriteShot,
  buildShotExplain,
  type CanonicalShotResult,
  type ShotExplain,
  type VerifierResult,
  type ShotDifferenceContract,
} from './canonicalPromptRewriter';

// ─────────────────────────────────────────────────────────────────────────────
// Internal utilities
// ─────────────────────────────────────────────────────────────────────────────

type Primitive = string | number | boolean | null | undefined;

/**
 * safeString — converts ANY runtime value to a clean string.
 * Eliminates [object Object] from ALL prompt output.
 * - null/undefined → ''
 * - string         → as-is
 * - number/boolean → String()
 * - array          → recursively join non-empty string leaves
 * - object         → extract first meaningful text field, or join string values
 */
const safeString = (value: any): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map(v => safeString(v))
      .filter(s => s && s !== '[object Object]')
      .join(', ');
  }
  if (typeof value === 'object') {
    // Try common text-bearing keys first
    for (const k of ['text', 'value', 'description', 'name', 'label', 'content', 'line', 'title', 'summary']) {
      if (typeof value[k] === 'string' && value[k].trim()) return value[k].trim();
    }
    // Join all string leaf values (e.g. {primary: "#FF69B4", secondary: "#00FFFF"})
    const strLeaves = Object.values(value)
      .filter(v => typeof v === 'string')
      .join(', ');
    return strLeaves || '';
  }
  return '';
};

const norm = (value: any): string =>
  safeString(value).toLowerCase().replace(/\s+/g, ' ').trim();

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
  if (Array.isArray(value)) return value.map((v) => safeString(v)).filter(s => s && s !== '[object Object]').join(', ');
  return safeString(value);
};

/**
 * getField — safely extracts a string value from shot or scene.
 * Uses safeString() so arrays and objects never produce [object Object].
 * Skips values that are empty or literally "[object Object]".
 */
const getField = (shot: any, scene: any, candidates: string[], fallback = ''): string => {
  for (const key of candidates) {
    const sv = shot?.[key];
    if (sv != null) {
      const s = safeString(sv).trim();
      if (s && s !== '[object Object]') return s;
    }
    const sc = scene?.[key];
    if (sc != null) {
      const s = safeString(sc).trim();
      if (s && s !== '[object Object]') return s;
    }
  }
  // Fallback: also safeString it in case caller passed an object
  const f = safeString(fallback).trim();
  return (f && f !== '[object Object]') ? f : '';
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

// ─────────────────────────────────────────────────────────────────────────────
// COMPACT IDENTITY LOCK — max 100 chars total.
// Only 3–5 immutable identifiers + 1 costume tag + 1 silhouette tag.
// The long prose block was dominating every prompt in the scene (identical
// 150-word character description repeated shot after shot). Now it's a
// concise anchor at the END of the prompt so shot-specific content leads.
// ─────────────────────────────────────────────────────────────────────────────
function characterToIdentityLock(bible: CharacterBibleEntry): string {
  const faceText  = bible.face_traits || '';
  const wardrobeRaw = ((bible as any).outfit || bible.wardrobe || '');
  const bodyRaw   = ((bible as any).body_type || '');
  const combinedTraits = `${faceText} ${wardrobeRaw}`.toLowerCase();

  // Non-human species detection (unchanged — critical for cartoon/animal chars)
  const nonHumanSpeciesMatch = combinedTraits.match(
    /\b(cat|dog|rabbit|fox|bear|wolf|tiger|lion|panda|deer|owl|eagle|dragon|anime|cartoon|creature|monster|alien|robot|cyborg|anthropomorphic|furry|humanoid animal)\b/
  );
  const isNonHuman = !!nonHumanSpeciesMatch;
  const speciesLabel = isNonHuman ? nonHumanSpeciesMatch![0].toUpperCase() : '';

  if (isNonHuman) {
    // Non-human: species + 2 key distinguishing visual traits + costume
    const bodyKey  = bodyRaw.split(',')[0].trim().slice(0, 40);
    const costume  = wardrobeRaw.split(/[,;]/)[0].trim().slice(0, 40);
    return `[${bible.name.toUpperCase()} NON-HUMAN ${speciesLabel} LOCK: ${[bodyKey, costume].filter(Boolean).join('; ')}. Render as ${speciesLabel} species — DO NOT humanise.]`;
  }

  // Human: extract 3 immutable facial identifiers from face_traits
  const eyeM    = faceText.match(/\b(brown|blue|green|hazel|grey|gray|dark|amber|almond|expressive|wide|narrow)\s+eyes?\b/i);
  const skinM   = faceText.match(/\b(fair|dark|olive|brown|tan|pale|warm|cool)\s*(?:skin|tone|undertone)?[^,]{0,20}/i);
  const markM   = faceText.match(/\b(scar|freckle|mole|birthmark|tattoo|dimple|cleft)[^,]{0,30}/i);
  const hairKey = bible.hair ? bible.hair.split(/[,;]/)[0].trim().slice(0, 35) : '';

  const identifiers = [
    eyeM  ? eyeM[0].trim()  : '',
    skinM ? skinM[0].trim() : '',
    markM ? markM[0].trim() : '',
    hairKey,
  ].filter(Boolean).slice(0, 3).join(', ');

  // Costume: first descriptor only (e.g. "Spider-Man suit" not 80 words)
  const costumeTag  = wardrobeRaw.split(/[,;]/)[0].trim().slice(0, 45);
  // Silhouette: height + build only
  const silhouette  = bodyRaw.split(',').slice(0, 2).join(',').trim().slice(0, 35);

  const lock = [identifiers, costumeTag, silhouette].filter(Boolean).join('; ');
  return `[${bible.name.toUpperCase()} LOCK: ${lock}. DO NOT alter face, gender, wardrobe.]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CINEMATIC FINGERPRINT — per-shot visual identity for contrast guard
// ─────────────────────────────────────────────────────────────────────────────

export interface CinematicFingerprint {
  shot_size:        string;   // ECU|CU|MCU|MS|WS|EWS
  angle:            string;   // LOW-ANGLE|EYE-LEVEL|HIGH-ANGLE|OTS|POV|DUTCH|BIRD-EYE|PROFILE
  subject_position: string;   // frame-left|centered|frame-right|background|foreground|split
  dramatic_purpose: string;   // from shot.dramatic_function or shot.shot_type
  emotional_beat:   string;   // from shot.emotional_beat / emotion
}

function parseShotSize(
  shotType: string,
  cameraAngle: string,
  cameraFraming: string,
  shotNumberInScene?: number,    // 1-based position within scene, for fallback heuristic
  explicitShotSize?: string,     // shot.shot_size field from new planner
): string {
  // Prefer the explicit shot_size field from the new shot planner
  if (explicitShotSize) {
    const e = explicitShotSize.toUpperCase().trim();
    if (['ECU','CU','MCU','MS','WS','EWS'].includes(e)) return e;
  }

  const s = `${shotType} ${cameraAngle} ${cameraFraming}`.toLowerCase();

  // Explicit size tokens
  if (s.match(/\b(ecu|extreme[\s-]?close[\s-]?up|extreme[\s-]?cu)\b/))  return 'ECU';
  if (s.match(/\b(close[\s-]?up|\bcu\b)\b/))                             return 'CU';
  if (s.match(/\b(medium[\s-]?close|mcu|bust[\s-]?shot)\b/))            return 'MCU';
  if (s.match(/\b(medium[\s-]?shot|medium[\s-]?wide|\bms\b|waist|knee)\b/)) return 'MS';
  if (s.match(/\b(extreme[\s-]?wide|aerial|drone|\bews\b)\b/))           return 'EWS';
  if (s.match(/\b(wide[\s-]?shot|full[\s-]?shot|long[\s-]?shot|\bws\b|establishing|master)\b/)) return 'WS';

  // Infer from composition/framing content (handles "medium" without "shot" suffix)
  if (s.match(/\bshallow\s+depth|isolate[sd]?\s+\w+\s+from\b/))         return 'MCU'; // shallow DoF = closer
  if (s.match(/\bfills?\s+(the\s+)?entire\s+frame|frame\s+filling\b/))  return 'ECU'; // fill frame = ECU
  if (s.match(/\bfull\s+body|head\s+to\s+toe\b/))                       return 'WS';
  // NOTE: "two characters" / "two-shot" removed — caused S1.1 and S1.3 to both
  // resolve WS, collapsing unique shot sizes to 2/4. Position heuristic handles variety.
  if (s.match(/\bmonster|creature|giant|kaiju\b/))                       return 'WS'; // scale shots = wide
  if (s.match(/\bclose\b/))                                              return 'CU';
  if (s.match(/\bwide|establish\b/))                                     return 'WS';

  // SHOT-POSITION HEURISTIC FALLBACK:
  // When the shot data carries no size signal, force variety by scene position.
  // This guarantees no 3 consecutive MS shots even with flat legacy data.
  if (shotNumberInScene != null) {
    const pos = ((shotNumberInScene - 1) % 4);
    return pos === 0 ? 'WS' : pos === 1 ? 'MS' : pos === 2 ? 'CU' : 'MCU';
  }

  return 'MS'; // absolute last resort
}

function parseCameraAngle(
  cameraAngle: string,
  cameraFraming: string,
  shotNumberInScene?: number,
): string {
  const s = `${cameraAngle} ${cameraFraming}`.toLowerCase();
  if (s.match(/\blow[\s-]?angle\b/))      return 'LOW-ANGLE';
  if (s.match(/\bhigh[\s-]?angle\b/))     return 'HIGH-ANGLE';
  if (s.match(/\bover[\s-]?shoulder\b/))  return 'OTS';
  if (s.match(/\bpov\b/))                 return 'POV';
  if (s.match(/\bdutch\b/))               return 'DUTCH';
  if (s.match(/\bbird[\s-]?eye|aerial\b/)) return 'BIRD-EYE';
  if (s.match(/\bprofile\b/))             return 'PROFILE';

  // Infer from framing content
  if (s.match(/\bconverg|looming|tower|loom(s)?\s+above\b/)) return 'LOW-ANGLE';
  if (s.match(/\bbelow|looking\s+down|overhead\b/))          return 'HIGH-ANGLE';

  // Position-based angle variety when data is flat
  if (shotNumberInScene != null) {
    const pos = ((shotNumberInScene - 1) % 4);
    // Alternate: EYE-LEVEL → LOW-ANGLE → EYE-LEVEL → HIGH-ANGLE
    return pos === 0 ? 'EYE-LEVEL' : pos === 1 ? 'LOW-ANGLE' : pos === 2 ? 'EYE-LEVEL' : 'HIGH-ANGLE';
  }

  return 'EYE-LEVEL';
}

function parseSubjectPosition(blocking: string, cameraFraming: string): string {
  const s = `${blocking} ${cameraFraming}`.toLowerCase();
  if (s.match(/\bright\s+(third|side)|screen\s+right|on\s+the\s+right\b/)) return 'frame-right';
  if (s.match(/\bleft\s+(third|side)|screen\s+left|on\s+the\s+left\b/))   return 'frame-left';
  if (s.match(/\bsymmet|cent(er|re)|mid(dle)?[\s-]?frame\b/))             return 'centered';
  if (s.match(/\bbackground|distanc\b/))                                   return 'background';
  if (s.match(/\bforeground|extreme[\s-]?fg\b/))                           return 'foreground';
  if (s.match(/\bboth|two[\s-]?shot|split\b/))                             return 'split';
  return 'centered';
}

/**
 * inferDramaticPurpose — maps generic shot data to a specific cinematic purpose.
 * Eliminates "scene coverage" and "setup" as repeated generic labels.
 */
function inferDramaticPurpose(
  rawPurpose: string,
  shotAction: string,
  emotion: string,
  shotSize: string,
  shotNumberInScene: number,
): string {
  const combined = `${rawPurpose} ${shotAction} ${emotion}`.toLowerCase();

  // Direct matches from specific language in the data
  if (combined.match(/\bestablish(ing)?\b/))         return 'establish scale + environment';
  if (combined.match(/\breact(ion)?\b/))             return 'register reaction';
  if (combined.match(/\binsert\b/))                  return 'detail emphasis';
  if (combined.match(/\breveal\b/))                  return 'reveal threat or information';
  if (combined.match(/\bconfrontation?\b/))          return 'confrontation moment';
  if (combined.match(/\bmonster|creature|giant|kaiju|godzilla\b/)) return 'establish creature scale';
  if (combined.match(/\bthre(at|atening)\b/))       return 'emphasize threat';
  if (combined.match(/\bfear|terror|dread|horror\b/)) return 'amplify dread';
  if (combined.match(/\bawe|wonder|marvel\b/))      return 'convey awe + wonder';
  if (combined.match(/\bconfiden(t|ce)|swagger\b/)) return 'establish character confidence';
  if (combined.match(/\brel(ish|ying)|ador(ation|ing)|fan\b/)) return 'character in their element';
  if (combined.match(/\bdanger|overwhelm|scale|vast\b/)) return 'reveal overwhelming odds';
  if (combined.match(/\bpov|perspective\b/))        return 'subjective perspective';
  if (combined.match(/\btension|suspen\b/))         return 'build tension';
  if (combined.match(/\bclimax|peak\b/))            return 'climax beat';
  if (combined.match(/\btwo[\s-]?shot|together\b/)) return 'character dynamic';

  // Shot-size inference when data is generic
  if (shotSize === 'EWS' || shotSize === 'WS') return 'establish scale and environment';
  if (shotSize === 'ECU') return 'detail / micro-expression emphasis';
  if (shotSize === 'CU')  return 'emotional close-up';
  if (shotSize === 'MCU') return 'character reaction';

  // Scene-position fallback (never return "scene coverage" again)
  const pos = ((shotNumberInScene - 1) % 4);
  return pos === 0 ? 'establish scale and environment'
       : pos === 1 ? 'isolate protagonist reaction'
       : pos === 2 ? 'reveal threat or detail'
       : 'emphasize emotional beat';
}

function compactLocation(location: string, timeOfDay: string): string {
  const loc = location != null ? String(location) : '';
  const first = loc.split(/[.!?\n]/)[0].trim();
  const short = first.length > 70 ? first.slice(0, 67) + '…' : first;
  const tod = timeOfDay != null ? String(timeOfDay) : '';
  return tod ? `${short}, ${tod}` : short;
}

function compactLightingTag(lightingSetup: string, styleLighting: string): string {
  // Prefer per-shot lighting_setup (shot planner generates these per shot)
  // over the global style bible paragraph (same for every shot in the film)
  const a = lightingSetup != null ? String(lightingSetup).trim() : '';
  const b = styleLighting  != null ? String(styleLighting).trim()  : '';
  const src = a || b;
  if (!src) return 'motivated cinematic lighting';
  return clamp(src.split(/[.;]/)[0].trim(), 90);
}

function compactStyleTags(styleBible: any): string {
  if (!styleBible) return '';
  const tags: string[] = [];

  // Art direction: first clause only — safeString handles objects
  const artDir = safeString(styleBible.art_direction);
  if (artDir) {
    const artShort = artDir.split(/[.;,]/)[0].trim().slice(0, 55);
    if (artShort && artShort !== '[object Object]') tags.push(artShort);
  }

  // Colour: extract hex codes from string or object-with-string-values
  const paletteRaw = safeString(styleBible.color_palette);
  if (paletteRaw && paletteRaw !== '[object Object]') {
    const hexes = (paletteRaw.match(/#[0-9A-Fa-f]{3,6}/g) || []).slice(0, 4);
    if (hexes.length) {
      tags.push(hexes.join('/'));
    } else {
      // No hex codes in string — use first prose clause
      const paletteShort = paletteRaw.split(/[.;,]/)[0].trim().slice(0, 50);
      if (paletteShort) tags.push(paletteShort);
    }
  }

  // Lens: first clause — safeString handles objects like {focal: '35mm'}
  const lens = safeString(styleBible.lens_language);
  if (lens && lens !== '[object Object]') {
    const lensShort = lens.split(/[,;]/)[0].trim().slice(0, 40);
    if (lensShort) tags.push(lensShort);
  }

  return tags.filter(s => s && s !== '[object Object]').join(' | ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Task C: ADJACENT SHOT CONTRAST GUARD
// Returns contrast score (0–5, higher = more different) and shared dimensions.
// Minimum requirement: adjacent shots must differ in ≥3 cinematic dimensions.
// ─────────────────────────────────────────────────────────────────────────────
export interface ContrastReport {
  score: number;           // 0–5 (5 = maximally different)
  passes: boolean;         // true if score >= 3
  shared_dimensions: string[];
  warning?: string;
}

export function checkAdjacentShotContrast(
  current: CinematicFingerprint,
  previous?: CinematicFingerprint,
): ContrastReport {
  if (!previous) return { score: 5, passes: true, shared_dimensions: [] };

  const shared: string[] = [];
  if (current.shot_size === previous.shot_size)               shared.push('shot_size');
  if (current.angle === previous.angle)                       shared.push('camera_angle');
  if (current.subject_position === previous.subject_position) shared.push('subject_position');
  if (current.dramatic_purpose && previous.dramatic_purpose &&
      norm(current.dramatic_purpose) === norm(previous.dramatic_purpose)) shared.push('dramatic_purpose');
  if (current.emotional_beat && previous.emotional_beat &&
      jaccard(tokenize(current.emotional_beat), tokenize(previous.emotional_beat)) > 0.7)
    shared.push('emotional_beat');

  const score = 5 - shared.length;
  const passes = score >= 3;
  return {
    score,
    passes,
    shared_dimensions: shared,
    warning: passes ? undefined : `Adjacent shots share ${shared.join(', ')} — consider varying ${shared[0]}`,
  };
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
  /** Previous shot's cinematic fingerprint — used for Task C contrast guard */
  previousFingerprint?: CinematicFingerprint;

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

// ─────────────────────────────────────────────────────────────────────────────
// Screenplay Binding — attached to every ComposeAllPromptsOutput
// Contains the SDC + verifier + explain for that shot.
// UI uses this to show FAILED markers and block video generation.
// ─────────────────────────────────────────────────────────────────────────────
export interface ScreenplayBinding {
  /** True when ALL 5 hard-fail conditions pass and numeric thresholds met */
  approved:        boolean;
  /** True when hard_fails > 0 — shot is BLOCKED from video generation */
  blocked:         boolean;
  /** Verifier total score e.g. "32/40" */
  verifier_score:  string;
  /** All verifier dimensions (8 × 0–5) */
  verifier:        VerifierResult;
  /** Shot Difference Contract */
  sdc:             ShotDifferenceContract;
  /** Structured explain for UI inspector */
  explain:         ShotExplain;
  /** The canonical (SDC-first) prompt that was used */
  canonical_prompt: string;
  /** How many auto-rewrite passes were needed (0 = clean first pass) */
  rewrite_count:   number;
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

  // ── Task E: Per-shot debug view (Task E — verify same-scene shots differ) ──
  shot_debug: {
    shot_size:        string;   // ECU|CU|MCU|MS|WS|EWS
    angle:            string;   // LOW-ANGLE|EYE-LEVEL|etc.
    subject_position: string;   // frame-left|centered|frame-right|etc.
    dramatic_purpose: string;
    emotional_beat:   string;
    compact_identity: string;   // the ultra-compact lock strings
    style_tags:       string;   // compact palette/lens/art tags
    contrast:         ContrastReport; // vs previous shot
  };

  // ── Screenplay binding (canonical rewriter verification result) ────────────
  /** Null only if rewriteShot() threw an unexpected error (should not happen). */
  screenplay_binding: ScreenplayBinding | null;
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
  /** Screenplay binding verification — used by UI to show FAILED markers */
  screenplay_binding?: ScreenplayBinding | null;
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

  // ── Extract the shot-specific variable portion for comparison ────────────
  // The prompt now opens with: [Shot label]. [camera framing]. [emotion]. [primary visual]. ...
  // The unique per-shot content (framing, emotion) lives at the FRONT.
  // We compare the first 500 chars (captures shot label + camera + emotion)
  // AND the portion after "Location:" (captures scene/action context).
  // Concatenating both avoids the old bug where stripping to "Scene context:"
  // discarded all unique framing information.
  const extractShotVariable = (p: string): string => {
    // Front portion: shot label + camera framing + emotion (positions ①–③)
    const frontSlice = p.slice(0, 500);
    // Back portion: from "Location:" onwards (location, action, lighting — shared context)
    const locIdx = p.indexOf('Location:');
    const backSlice = locIdx > 0 ? p.slice(locIdx, locIdx + 400) : '';
    return `${frontSlice} ${backSlice}`.trim();
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

// ─────────────────────────────────────────────────────────────────────────────
// buildImagePromptFromComposer — FINGERPRINT-FIRST architecture
//
// ROOT CAUSE of same-scene duplicates (now fixed):
//   The old structure put character description at position ① (identical 150+
//   words for every shot in a scene), so Flux received the same leading tokens
//   for ALL shots and produced nearly identical images.
//
// NEW STRUCTURE — every prompt opens with a unique cinematic fingerprint:
//   ① [Scene/Shot | SHOT_SIZE | ANGLE | SUBJECT_POSITION] — unique per shot
//   ② DRAMATIC PURPOSE — what story function this shot serves
//   ③ EMOTION — micro-psychological state (different per shot)
//   ④ SHOT ACTION — the unique physical/visual moment (stripped of char desc)
//   ⑤ Location (compact — first sentence only, not full paragraph)
//   ⑥ Lighting (compact — per-shot specific, not global style bible paragraph)
//   ⑦ Style tags (compact — hex codes + 1 art tag, not full prose)
//   ⑧ Temporal bridge (if any)
//   ⑨ Director rules (brief, max 2)
//   ⑩ CHARACTER IDENTITY LOCK — compact form (≤100 chars) at the END
//   ⑪ Characters present
//   ⑫ Quality mandate
//
// With this structure, the first 200 tokens are ALWAYS unique per shot.
// Character continuity is still enforced by the compact lock at ⑩.
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
  previousFingerprint?: CinematicFingerprint;
}): { prompt: string; negativePrompt: string; fingerprint: CinematicFingerprint; contrastReport: ContrastReport } {
  const { shot, scene, styleBible, resolvedBibles, characterAnchor, directorBrain, shotGraphNode, styleLabel } = params;

  // ── Core field extraction (all via safeString — zero [object Object] risk) ─
  const sceneNumber     = safeString(shot.scene_number  ?? scene?.scene_number  ?? '');
  const shotNumber      = safeString(shot.shot_number   ?? '');
  const shotNumInt      = parseInt(shotNumber, 10) || 1;  // numeric shot position for heuristics
  const perShotImagePrompt = safeString(shot.image_prompt).trim();
  const rawAction       = getField(shot, scene, ['action', 'shot_description', 'visual_description'], '');
  const locationFull    = getField(shot, scene, ['location', 'scene_setting'], 'Cinematic environment');
  const timeOfDay       = getField(shot, scene, ['time_of_day'], '');
  const emotion         = safeString(directorBrain?.emotional_beat_for_shot)
    || getField(shot, scene, ['emotion', 'mood', 'emotional_beat'], '');
  const cameraFraming   = getField(shot, scene, ['camera_framing', 'composition', 'framing', 'camera'], 'balanced framing');
  const cameraAngle     = getField(shot, scene, ['camera_angle', 'camera'], 'medium shot');
  const shotType        = getField(shot, scene, ['shot_type'], '');
  const explicitSize    = getField(shot, scene, ['shot_size'], '');  // new planner field
  const blocking        = getField(shot, scene, ['blocking', 'composition'], '');
  const focalLength     = getField(shot, scene, ['focal_length', 'lens_style', 'lens', 'lens_hint'], '');
  const lightingSetup   = getField(shot, scene, ['lighting_setup'], '');   // per-shot from new planner
  const lightingStyle   = safeString(directorBrain?.lighting_intention)
    || getField(shot, scene, ['lighting'], safeString(styleBible?.lighting));
  const rawDramatic     = getField(shot, scene, ['dramatic_function', 'shot_type', 'dramatic_purpose'], '');
  const negativeRaw     = getField(shot, scene, ['negative_constraints', 'negative_prompt'], '');

  // ── Cinematic fingerprint (shot-position heuristics prevent flat MS/EYE-LEVEL) ─
  const shotSize  = parseShotSize(shotType, cameraAngle, cameraFraming, shotNumInt, explicitSize);
  const angleTag  = parseCameraAngle(cameraAngle, cameraFraming, shotNumInt);
  const subjectPos = parseSubjectPosition(blocking, cameraFraming);
  // Extract shot action early (needed by inferDramaticPurpose)
  const extractShotAction = (raw: string): string => {
    if (!raw) return '';
    // Strip [X LOCK] prefix
    let s = raw.replace(/^\[.*?\s+LOCK\][,.\s]*/i, '').trim();
    // If "Action:" label is present, grab what follows it (skip "Characters: X." prefix)
    const actionM = s.match(/\bAction:\s*(?:Characters:[^.]*\.)?\s*([\s\S]{20,})/i);
    if (actionM) return actionM[1].trim();
    // Skip character-description sentences (eye/nose/lip/hair/wearing/holding/build)
    let faceEnd = 0;
    const faceRe = /\b(?:eyes?|nose\s+bridge|lips?|jawline|cheekbones?|hair|outfit|wearing|holding|props?|build|gait|height|skin\s+tone)[^.]{0,140}\./gi;
    let m: RegExpExecArray | null;
    while ((m = faceRe.exec(s.slice(0, 600))) !== null) {
      faceEnd = Math.max(faceEnd, m.index + m[0].length);
    }
    if (faceEnd > 60) {
      const remainder = s.slice(faceEnd).trim();
      if (remainder.length > 30) return remainder;
    }
    return s;
  };

  const shotAction = extractShotAction(perShotImagePrompt) || rawAction || 'Character in motion';

  // ── Dramatic purpose — specific, never "scene coverage" ──────────────────
  const dramaticPurpose = inferDramaticPurpose(rawDramatic, shotAction, emotion, shotSize, shotNumInt);

  const fingerprint: CinematicFingerprint = {
    shot_size:        shotSize,
    angle:            angleTag,
    subject_position: subjectPos,
    dramatic_purpose: dramaticPurpose,
    emotional_beat:   emotion,
  };
  const contrastReport = checkAdjacentShotContrast(fingerprint, params.previousFingerprint);

  // ── Compact location (one short line, not a paragraph) ───────────────────
  const locationCompact = compactLocation(locationFull, timeOfDay);

  // ── Compact lighting (per-shot specific, not global style bible) ──────────
  const lightingCompact = compactLightingTag(lightingSetup, lightingStyle);

  // ── Compact style tags + lens (all via safeString) ────────────────────────
  const styleTags = compactStyleTags(styleBible);
  const lensTagRaw = focalLength || safeString(styleBible?.lens_language).split(/[,;]/)[0].trim().slice(0, 35);
  const lensTag = lensTagRaw || '35mm cinematic';

  // ── Character identity locks (compact, at END) ────────────────────────────
  const compactLocks: string[] = [];
  if (resolvedBibles.length > 0) {
    resolvedBibles.forEach(b => compactLocks.push(characterToIdentityLock(b)));
  } else if (characterAnchor) {
    compactLocks.push(`[IDENTITY LOCK: ${clamp(characterAnchor, 80)}]`);
  }
  const identityBlock = compactLocks.join(' | ');

  // ── Director rules (max 2, brief) ─────────────────────────────────────────
  const directorRule = directorBrain?.directorial_rules?.length
    ? directorBrain.directorial_rules.slice(0, 2).join('; ')
    : '';

  // ── Temporal bridge ───────────────────────────────────────────────────────
  const tg = shotGraphNode?.temporal_guidance;
  const temporalLine = [
    tg?.start_frame_intent ? `Frame open: ${tg.start_frame_intent}` : '',
    tg?.end_frame_intent   ? `Frame close: ${tg.end_frame_intent}`  : '',
  ].filter(Boolean).join('. ');

  // ── Characters present (safeString handles objects like {name:"X", id:"Y"}) ─
  const characters = Array.isArray(shot.characters)
    ? shot.characters
        .map((c: any) => {
          const s = safeString(c).trim();
          return (s && s !== '[object Object]') ? s : '';
        })
        .filter(Boolean)
    : [];

  // ── Shot fingerprint header (① — unique per shot, every token different) ─
  // Format: [Scene X / Shot Y | WS | LOW-ANGLE | frame-right]
  const shotLabel = `[Scene ${sceneNumber || '?'} / Shot ${shotNumber || '?'} | ${shotSize} | ${angleTag} | ${subjectPos}]`;

  // ── Assemble — FINGERPRINT LEADS, IDENTITY LOCK TRAILS ───────────────────
  const prompt = [
    // ① Cinematic fingerprint — unique per shot
    shotLabel,
    // ② Dramatic purpose — what story function this shot serves
    dramaticPurpose ? `Dramatic purpose: ${dramaticPurpose}` : '',
    // ③ Emotion — micro-psychological state (different per shot)
    emotion ? `Emotion: ${emotion}` : '',
    // ④ Shot action — the unique physical/visual moment
    clamp(shotAction, 280),
    // ⑤ Location (compact — first sentence only)
    `Location: ${locationCompact}`,
    // ⑥ Camera framing detail (the specific compositional intent)
    cameraFraming ? `Framing: ${clamp(cameraFraming, 120)}` : '',
    // ⑦ Lighting (per-shot specific, compact)
    lightingCompact ? `Lighting: ${lightingCompact}. Lens: ${lensTag}` : `Lens: ${lensTag}`,
    // ⑧ Style tags (compact — no repeated prose blocks)
    styleTags || (styleLabel ? `Style: ${styleLabel}` : ''),
    // ⑨ Temporal bridge
    temporalLine || '',
    // ⑩ Director rules
    directorRule ? `Director: ${directorRule}` : '',
    // ⑪ Character identity lock — compact form, LAST position
    identityBlock
      ? `Identity — do NOT alter: ${identityBlock}`
      : characters.length > 0 ? 'Maintain full visual continuity.' : '',
    // ⑫ Characters present
    characters.length > 0 ? `Characters: ${characters.join(', ')}` : '',
    // ⑬ Quality mandate
    'Cinematic still frame, high detail, physically plausible lighting. Single coherent film frame — not a collage or split screen.',
  ].filter(Boolean).join('. ');

  // ── Negative prompt ───────────────────────────────────────────────────────
  const negativePrompt = [
    negativeRaw,
    'identity drift, wrong outfit, costume change, different hairstyle, wrong props',
    'multiple versions of the same character, cloned faces, duplicate figures',
    'generic stock photo look, unrelated background, wrong location',
    'same composition as previous shot when shot context changed',
    'watermark, text overlay, letterbox bars, split screen, collage, blurry',
    'extra limbs, distorted anatomy, deformed hands, missing fingers',
    'humanised animal face, wrong species anatomy, realistic human face on cartoon character',
  ].filter(Boolean).join(', ');

  return {
    prompt: clamp(prompt, 1800),
    negativePrompt: clamp(negativePrompt, 600),
    fingerprint,
    contrastReport,
  };
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
    ? shot.characters.map((c: any) => { const s = safeString(c).trim(); return (s && s !== '[object Object]') ? s : ''; }).filter(Boolean)
    : [];
  const resolvedBibles = resolveBiblesForShot(shotCharacters, characterBibles);

  // ── Build image prompt (with fingerprint + contrast report) ─────────────
  const {
    prompt: imagePrompt,
    negativePrompt: imageNegativePrompt,
    fingerprint,
    contrastReport,
  } = buildImagePromptFromComposer({
    shot, scene, styleBible, resolvedBibles,
    characterAnchor: input.characterAnchor || '',
    directorBrain, shotGraphNode: input.shotGraphNode, styleLabel: input.styleLabel,
    previousFingerprint: input.previousFingerprint,
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

  // ── Compact identity string for debug output ──────────────────────────────
  const compactIdentityDebug = resolvedBibles.length > 0
    ? resolvedBibles.map(b => characterToIdentityLock(b)).join(' | ')
    : input.characterAnchor
    ? clamp(input.characterAnchor, 80)
    : 'no character lock';

  // ── SCREENPLAY BINDING (Task 1–5) ─────────────────────────────────────────
  // Run canonical rewriter → SDC + 8-dim verifier + 5 hard-fail conditions.
  // The canonical prompt (SDC fields first) REPLACES the fingerprint prompt
  // as the final image_prompt so that the first 120 tokens carry screenplay info.
  // Identity locks from the fingerprint builder are appended at the end.
  let screenplayBinding: ScreenplayBinding | null = null;
  let finalImagePrompt = imagePrompt; // fallback if rewriter throws

  try {
    // arcIdx: shot's 0-based position within its scene (0=establishing, 1=cover, 2=react, 3=insert)
    // Approximate from shot_number within scene (mod 4).  Scene-level shot lists could pass
    // a dedicated field (scene_arc_index) for more precision, but this is safe for all cases.
    const shotNumRaw = parseInt(safeString(shot.shot_number), 10);
    const arcIdx = isNaN(shotNumRaw) ? 0 : Math.max(0, (shotNumRaw - 1) % 4);

    const canonicalResult: CanonicalShotResult = rewriteShot(
      shot,
      scene,
      input.previousShot || null,
      resolvedBibles,          // already-resolved CharacterBibleEntry[] for this shot
      input.styleBible || {},
      arcIdx,
    );

    const explain: ShotExplain = buildShotExplain(
      shot,
      scene,
      input.previousShot || null,
      canonicalResult.sdc,
      canonicalResult.verifier,
      canonicalResult.must_show,
    );

    // The canonical prompt leads with SDC fields (first 120 tokens = screenplay contract).
    // Append identity lock block from the fingerprint builder so production constraints trail.
    const identityTrail = compactIdentityDebug && compactIdentityDebug !== 'no character lock'
      ? `\nIDENTITY LOCK (production): ${compactIdentityDebug}`
      : '';
    finalImagePrompt = clamp(canonicalResult.canonical_prompt + identityTrail, 1800);

    const verifierScore = `${canonicalResult.verifier.total}/${canonicalResult.verifier.dimensions.length * 5}`;

    screenplayBinding = {
      approved:         canonicalResult.approved,
      blocked:          !canonicalResult.approved,
      verifier_score:   verifierScore,
      verifier:         canonicalResult.verifier,
      sdc:              canonicalResult.sdc,
      explain,
      canonical_prompt: canonicalResult.canonical_prompt,
      rewrite_count:    canonicalResult.rewrite_count,
    };
  } catch (err: any) {
    console.error('[ScreenplayBinding] rewriteShot() threw:', err?.message);
    // Fall through — use fingerprint prompt, binding = null
  }

  return {
    image_prompt: finalImagePrompt,
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
    // Task E: per-shot debug view
    shot_debug: {
      shot_size:        fingerprint.shot_size,
      angle:            fingerprint.angle,
      subject_position: fingerprint.subject_position,
      dramatic_purpose: fingerprint.dramatic_purpose,
      emotional_beat:   fingerprint.emotional_beat,
      compact_identity: compactIdentityDebug,
      style_tags:       compactStyleTags(styleBible),
      contrast:         contrastReport,
    },
    screenplay_binding: screenplayBinding,
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
    ? shot.characters.map((c: any) => { const s = safeString(c).trim(); return (s && s !== '[object Object]') ? s : ''; }).filter(Boolean)
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
    // Pass through screenplay binding for UI failure indicators
    screenplay_binding: composed.screenplay_binding,
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
