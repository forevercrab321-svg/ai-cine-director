/**
 * lib/canonicalPromptRewriter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * POST-PLANNER IMAGE PROMPT REWRITER — STRUCTURED FIELDS ARE SOURCE OF TRUTH
 *
 * Gemini raw image_prompt prose is UNTRUSTED INPUT.
 * This module:
 *   1. Computes Shot Difference Contract (SDC): narrative_function, new_information,
 *      required_visible_action, visual_delta, forbidden_repetition
 *   2. Runs anti-redundancy check (duplicate_risk_score) vs previous shot
 *   3. Builds CANONICAL image_prompt with SDC fields as first lines (TASK 3 priority order)
 *   4. Verifies screenplay faithfulness (8 dimensions, 0-5 each = 40 max)
 *      — 8th dimension: screenplay removal value ("would scene lose info if removed?")
 *   5. Detects generic portrait collapse patterns
 *   6. Auto-rewrites if verifier score fails thresholds
 *   7. Produces full traceability data for UI display
 *
 * PASS THRESHOLDS (all must be met):
 *   total score  ≥ 28 / 40
 *   beat_match   ≥ 4 / 5
 *   non_generic  ≥ 4 / 5
 *   removal_val  ≥ 3 / 5  (shot must add unique value — not cosmetically redundant)
 */

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface VerifierDimension {
  name: string;
  score: number;   // 0–5
  reason: string;
}

export interface VerifierHardFail {
  code: string;   // e.g. 'MISSING_SPECIFIC_ACTION'
  reason: string; // human-readable explanation in Chinese + English
}

export interface VerifierResult {
  total: number;                  // 0–40 (8 dims × 5)
  passes: boolean;
  dimensions: VerifierDimension[];
  fail_reasons: string[];
  generic_portrait_detected: boolean;
  /** Explicit hard-fail conditions that block generation regardless of total score */
  hard_fails?: VerifierHardFail[];
}

/** Shot Difference Contract — what makes THIS shot distinct from the previous */
export interface ShotDifferenceContract {
  narrative_function:                string;   // NarrativeFunction enum value
  new_information_introduced:        string;   // What new story info this shot adds
  required_visible_action:           string;   // Specific physical action that must be visible
  forbidden_repetition_from_previous: string[]; // What must NOT re-appear from prev shot
  visual_delta_from_previous:        string;   // How this shot differs visually from prev
  duplicate_risk_score:              number;   // 0-100: ≥70 = cosmetic duplicate = HARD FAIL
  duplicate_fail_reason?:            string;   // Populated if duplicate_risk_score ≥ 70
}

export interface CanonicalShotResult {
  canonical_prompt:        string;        // The approved prompt to send to the image model
  screenplay_beat:         string;        // One-line beat description for UI
  must_show:               string[];      // Checklist: concrete visible proof required
  verifier:                VerifierResult;
  approved:                boolean;
  rewrite_count:           number;        // How many rewrite iterations were needed
  gemini_prose_discarded:  boolean;       // True when original Gemini image_prompt was replaced
  sdc:                     ShotDifferenceContract; // Shot Difference Contract data
}

// ─── Internal utilities ───────────────────────────────────────────────────────

const s = (v: any): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(s).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    for (const k of ['text','value','description','name','label','content','line']) {
      if (typeof v[k] === 'string' && v[k].trim()) return v[k].trim();
    }
    return Object.values(v).filter(x => typeof x === 'string').join(', ');
  }
  return '';
};

const n = (v: any) => s(v).toLowerCase().trim();

// ─── GENERIC PORTRAIT COLLAPSE PATTERNS ──────────────────────────────────────
// These patterns indicate the prompt has collapsed into a generic shot that
// does NOT serve the screenplay beat.

const GENERIC_PORTRAIT_PATTERNS: RegExp[] = [
  /\b(man|woman|person|character|hero|protagonist)\s+(standing|sits?|seated)\s+(and\s+)?(looking|staring|gazing|watching|scanning)/i,
  /\bcentered\s+(solo\s+)?portrait\b/i,
  /\bclean\s+hero\s+pose\b/i,
  /\bgeneric\s+(reaction|close[- ]?up|portrait)\b/i,
  /\b(touches?|adjusts?|fidgets?\s+with)\s+(glasses|tie|collar|hair|shirt)\b/i,
  /\b(on\s+(his|her|their|the)\s+phone|looking\s+at\s+(a\s+)?phone|phone\s+in\s+hand)\b/i,
  /\bcharacter\s+(looks?\s+out\s+(at|over|across)|gazes?\s+(across|into|over)\s+the\s+city)\b/i,
  /\bstanding\s+(profile|hero)\s+shot\b/i,
  /\bblurred\s+city\s+(background|backdrop)\s+behind\b/i,
  /\b(stares?|gazes?)\s+(into\s+the\s+distance|off[- ]?camera|into\s+the\s+middle\s+distance)\b/i,
];

const REQUIRED_ACTION_VERBS: RegExp = /\b(perch(?:es|ing)?|crouches?|crouching|leaps?|leaping|grabs?|grabbing|fires?|firing|swings?|swinging|pulls?|pulling|yanks?|yanking|slams?|slamming|dives?|diving|rolls?|rolling|spins?|spinning|lunges?|lunging|blocks?|blocking|deflects?|deflecting|pivots?|pivoting|tears?|tearing|rips?|ripping|holds?|holding|clutches?|clutching|tightens?|tightening|reaches?|reaching|extends?|extending|points?|pointing|throws?|throwing|catches?|catching|strikes?|striking|kicks?|kicking|punches?|punching|stumbles?|stumbling|falls?|falling|rises?|rising|lands?|landing|crashes?|crashing|explodes?|exploding|erupts?|erupting|collapses?|collapsing|staggers?|staggering|freezes?|freezing|flinches?|flinching|trembles?|trembling|shakes?|shaking|twists?|twisting|ducks?|ducking|vaults?|vaulting|sprints?|sprinting|climbs?|climbing|shields?|shielding|dwarfs?|looms?|looming|towers?|towering|rains?|raining|flees?|fleeing|charges?|charging|bolts?|bolting|surges?|surging|scrambles?|scrambling|crawls?|crawling|dodges?|dodging|rushes?|rushing|barrels?|barreling|hurls?|hurling|flings?|flinging|slashes?|slashing|smashes?|smashing|shoves?|shoving|drags?|dragging|lifts?|lifting|snaps?|snapping|wraps?|wrapping|braces?|bracing|dashes?|dashing|leaps?|skids?|skidding|swerves?|swerving|spins?|twirls?|twirling|stomps?|stomping|crushes?|crushing|attacks?|attacking|confronts?|confronting|battles?|battling|fights?|fighting|destroys?|destroying|obliterates?|obliterating|threatens?|threatening|overwhelms?|overwhelming|topples?|toppling|pursues?|pursuing|transforms?|transforming|emerges?|emerging|reveals?|revealing|shatters?|shattering|protects?|protecting|rescues?|rescuing|saves?|saving|activates?|activating|demolishes?|demolishing|decimates?|decimating|defeats?|defeating|overpowers?|overpowering|intercepts?|intercepting|repels?|repelling|deflects?|deflecting|rebuffs?|rebuffing|propels?|propelling|launches?|launching|catapults?|catapulting|flings?|flinging|detonates?|detonating|ignites?|igniting|burns?|burning|melts?|melting|freezes?|freezing|shatters?|shattering|pierces?|piercing|impales?|impaling|severs?|severing|decapitates?|decapitating|obliterates?|obliterating|annihilates?|annihilating|devastates?|devastating|tramples?|trampling|flattens?|flattening|crushes?|crushing|buries?|burying|entombs?|entombing|swallows?|swallowing|engulfs?|engulfing|consumes?|consuming|sweeps?|sweeping|carries?|carrying|drags?|dragging|pulls?|pulling)\b/i;

// ─── NARRATIVE FUNCTION DERIVER ───────────────────────────────────────────────
// Maps shot position + dramatic_function + shot_size to the canonical narrative function enum.

function deriveNarrativeFunction(shot: any, scene: any, arcIdx: number, prevShot: any | null): string {
  const fn      = n(shot.dramatic_function || shot.shot_type || '');
  const size    = n(shot.shot_size);
  const action  = n(shot.action || shot.visual_description || '');
  const emotion = n(shot.emotional_beat || '');

  // Scene arc position takes priority for first 4 shots
  if (arcIdx === 0) {
    return (size === 'ews' || size === 'ws') ? 'establishing' : 'scale';
  }
  if (arcIdx === 1) {
    return fn === 'cover' || fn === 'character_intro' ? 'character_intro' : fn.includes('cover') ? 'character_intro' : 'reaction';
  }
  if (arcIdx === 2) {
    return 'reaction';
  }
  if (arcIdx === 3) {
    return size === 'ecu' || fn === 'insert' ? 'insert' : 'reveal';
  }

  // Fallback: derive from fields
  if (fn.includes('establish') || size === 'ews') return 'establishing';
  if (fn.includes('insert') || size === 'ecu') return 'insert';
  if (fn.includes('react') || fn.includes('reaction')) return 'reaction';
  if (fn.includes('reveal') || fn.includes('disclosure')) return 'reveal';
  if (fn.includes('confront') || fn.includes('conflict')) return 'confrontation';
  if (fn.includes('transit')) return 'transition';
  if (fn.includes('aftermath') || fn.includes('result')) return 'aftermath';
  if (fn.includes('decision') || action.includes('decides') || action.includes('chooses')) return 'decision';
  if (fn.includes('motion') || fn.includes('bridge')) return 'motion_bridge';
  if (size === 'ws' || size === 'ews') return 'scale';
  if (size === 'cu' || size === 'mcu') return 'reaction';

  return 'character_intro';
}

// ─── NEW INFORMATION DERIVER ──────────────────────────────────────────────────
// What story information does this shot add that didn't exist before?

function deriveNewInformation(shot: any, scene: any, arcIdx: number, prevShot: any | null): string {
  const size    = n(shot.shot_size);
  const fn      = n(shot.dramatic_function || '');
  const action  = s(shot.action || '').split(/[.!?]/)[0].trim().slice(0, 80);
  const emotion = s(shot.emotional_beat || '').split(/[.;]/)[0].trim().slice(0, 50);
  const loc     = s(scene?.location || '').split(/[,.\n]/)[0].trim();
  const synopsis = s(scene?.synopsis || '').split(/[.]/)[0].trim().slice(0, 80);

  if (arcIdx === 0) {
    return `First view of ${loc || 'location'} — scale, threat presence, and spatial grammar of world established`;
  }
  if (arcIdx === 1) {
    return `Character intent revealed — ${emotion || 'emotional state'} readable; scene obstacle becomes clear`;
  }
  if (arcIdx === 2) {
    return `Internal psychological state exposed — micro-expression carries weight of: "${action.slice(0, 50)}"`;
  }
  if (arcIdx === 3) {
    const chars   = Array.isArray(shot.characters) ? shot.characters : [];
    return `Specific detail punctuates scene — ${chars.length ? `object linked to ${chars[0]}` : 'physical proof'} escalates or resolves tension`;
  }

  // General case
  if (fn.includes('reveal') || size === 'ecu') return `New visual evidence: "${action.slice(0, 60)}"`;
  if (fn.includes('react'))   return `Character response to prior event — emotion: "${emotion}"`;
  if (fn.includes('confront')) return `Two forces meet — conflict made visible`;
  if (fn.includes('transit')) return `Scene transition — location/time/tone bridge`;

  return `Story beat advanced: "${synopsis.slice(0, 70)}"`;
}

// ─── REQUIRED VISIBLE ACTION DERIVER ─────────────────────────────────────────
// What specific physical action MUST be visible in this frame?

function deriveRequiredAction(shot: any, scene: any, arcIdx: number): string {
  // Use the first meaningful sentence from action, or fall back to visual_description.
  // Strip "Characters: …" style prefix that some DB rows store instead of a real action.
  const rawFull = s(shot.action || shot.visual_description || '');
  const raw = rawFull.split(/[.!?]/)[0].trim().slice(0, 100);
  const size   = n(shot.shot_size);
  const fn     = n(shot.dramatic_function || '');
  const chars  = Array.isArray(shot.characters) ? shot.characters.slice(0, 1) : [];
  const charName = chars.length ? chars[0] : 'subject';

  // Detect whether "raw" is a real physical action or just a character/metadata listing.
  // "Characters: X" or very short strings carry no action information.
  const isOnlyCharListing = !raw || /^characters?\s*:/i.test(raw.trim()) || raw.trim().length < 6;

  if (arcIdx === 0) {
    // ALWAYS append raw shot action so physical verbs (stomps, crashes, etc.)
    // flow through to the REQUIRED ACTION line and are seen by the verifier.
    // If raw is only a character listing, fall back to positional-only template.
    const actionSuffix = isOnlyCharListing ? '' : ` — ${raw}`;
    return `${charName} physically present in environment — body ≤25% of frame — environment scale dominates${actionSuffix}`;
  }
  if (arcIdx === 1) {
    return (isOnlyCharListing ? '' : raw) || `${charName} body language communicates intent — no passive standing`;
  }
  if (arcIdx === 2) {
    const actionPart = isOnlyCharListing ? 'internal reaction' : (raw.slice(0, 60) || 'internal reaction');
    return `${charName} face visible — micro-expression readable — ${actionPart}`;
  }
  if (arcIdx === 3) {
    const actionPart = isOnlyCharListing ? 'specific prop or body part' : (raw.slice(0, 60) || 'specific prop or body part');
    return `Object, hand, or environmental detail fills frame — ${actionPart}`;
  }
  return (isOnlyCharListing ? '' : raw) || `${charName} performs specific action`;
}

// ─── VISUAL DELTA FROM PREVIOUS ───────────────────────────────────────────────
// How does this shot differ visually from the previous one?

function deriveVisualDelta(shot: any, prevShot: any | null, arcIdx: number): string {
  if (!prevShot) return 'Opens scene — no previous shot to compare';

  const curSize    = (s(shot.shot_size) || 'MS').toUpperCase();
  const prevSize   = (s(prevShot.shot_size) || 'MS').toUpperCase();
  const curAngle   = (s(shot.camera_angle) || 'eye-level').toLowerCase();
  const prevAngle  = (s(prevShot.camera_angle) || 'eye-level').toLowerCase();
  const curHeight  = (s(shot.camera_height) || 'eye-level').toLowerCase();
  const prevHeight = (s(prevShot.camera_height) || 'eye-level').toLowerCase();
  const curBg      = (s(shot.background_dominance) || 'balanced').toLowerCase();
  const prevBg     = (s(prevShot.background_dominance) || 'balanced').toLowerCase();
  const curFn      = n(shot.dramatic_function || '');
  const prevFn     = n(prevShot.dramatic_function || '');
  const curPos     = n(shot.subject_position || '');
  const prevPos    = n(prevShot.subject_position || '');
  const curEmotion = n(shot.emotional_beat || '');
  const prevEmotion= n(prevShot.emotional_beat || '');

  const diffs: string[] = [];
  if (curSize !== prevSize)    diffs.push(`size ${prevSize}→${curSize}`);
  if (curAngle !== prevAngle)  diffs.push(`angle ${prevAngle}→${curAngle}`);
  if (curHeight !== prevHeight) diffs.push(`height ${prevHeight}→${curHeight}`);
  if (curBg !== prevBg)        diffs.push(`background ${prevBg}→${curBg}`);
  if (curFn !== prevFn && curFn && prevFn) diffs.push(`function ${prevFn}→${curFn}`);
  if (curPos !== prevPos && curPos && prevPos) diffs.push(`position ${prevPos}→${curPos}`);
  if (curEmotion !== prevEmotion && curEmotion && prevEmotion) diffs.push(`emotion ${prevEmotion}→${curEmotion}`);

  if (diffs.length === 0) {
    return `⚠ MINIMAL VISUAL DELTA — same size/angle/height as previous shot`;
  }
  return diffs.join(', ');
}

// ─── FORBIDDEN REPETITIONS ────────────────────────────────────────────────────
// What must NOT re-appear from the previous shot?

function deriveForbiddenRepetitions(shot: any, prevShot: any | null, arcIdx: number): string[] {
  if (!prevShot) return [];

  const forbidden: string[] = [];
  const prevSize   = (s(prevShot.shot_size) || '').toUpperCase();
  const prevFn     = n(prevShot.dramatic_function || '');
  const prevAngle  = n(prevShot.camera_angle || '');
  const prevHeight = n(prevShot.camera_height || '');
  const prevEmotion= n(prevShot.emotional_beat || '');
  const prevPos    = n(prevShot.subject_position || '');
  const prevAction = s(prevShot.action || '').split(/[.!?]/)[0].trim().slice(0, 50);

  if (prevSize)    forbidden.push(`shot size ${prevSize} — must differ`);
  if (prevFn && prevFn !== 'cover') forbidden.push(`dramatic function "${prevFn}"`);
  if (prevAngle)   forbidden.push(`camera angle "${prevAngle}"`);
  if (prevHeight)  forbidden.push(`camera height "${prevHeight}" — vary the camera plane`);
  if (prevEmotion) forbidden.push(`emotional beat "${prevEmotion}" — character must feel differently`);
  if (prevPos)     forbidden.push(`subject position "${prevPos}" — vary character's frame placement`);
  if (prevAction)  forbidden.push(`action repeat: "${prevAction.slice(0, 40)}" — must advance, not repeat`);

  return forbidden.slice(0, 5); // Cap at 5 most important
}

// ─── ANTI-REDUNDANCY CHECK (TASK 2) ──────────────────────────────────────────
// Returns duplicate_risk_score (0-100) and fail reason if ≥70.
// A shot is a cosmetic duplicate if ALL 5 key dimensions match the previous.

export function checkDuplicateRisk(shot: any, prevShot: any | null): { duplicate_risk_score: number; duplicate_fail_reason?: string } {
  if (!prevShot) return { duplicate_risk_score: 0 };

  const n_v = (v: any) => (s(v) || '').toLowerCase().trim();

  const checks: Array<{ dimension: string; same: boolean }> = [
    {
      dimension: 'subject',
      same: (() => {
        const curChars  = Array.isArray(shot.characters) ? shot.characters.join(',') : n_v(shot.characters);
        const prevChars = Array.isArray(prevShot.characters) ? prevShot.characters.join(',') : n_v(prevShot.characters);
        return curChars.length > 0 && curChars === prevChars;
      })(),
    },
    {
      dimension: 'shot_size',
      same: n_v(shot.shot_size) !== '' && n_v(shot.shot_size) === n_v(prevShot.shot_size),
    },
    {
      dimension: 'camera_angle',
      same: n_v(shot.camera_angle) !== '' && n_v(shot.camera_angle) === n_v(prevShot.camera_angle),
    },
    {
      dimension: 'location_block',
      same: (() => {
        // Same location block means same indoor/outdoor type AND same key location word
        const curLoc  = n_v(shot.location || '').split(/[\s,]/)[0];
        const prevLoc = n_v(prevShot.location || '').split(/[\s,]/)[0];
        return curLoc.length > 2 && curLoc === prevLoc;
      })(),
    },
    {
      dimension: 'dramatic_function',
      same: n_v(shot.dramatic_function) !== '' && n_v(shot.dramatic_function) === n_v(prevShot.dramatic_function),
    },
    {
      dimension: 'new_information',
      same: (() => {
        // If emotional beat is identical AND action tokens heavily overlap → no new info
        const sameEmotion = n_v(shot.emotional_beat) !== '' && n_v(shot.emotional_beat) === n_v(prevShot.emotional_beat);
        const curAction   = n_v(shot.action || '').split(/\s+/).filter((t: string) => t.length > 3);
        const prevAction  = new Set(n_v(prevShot.action || '').split(/\s+/).filter((t: string) => t.length > 3));
        const overlap = curAction.length > 0
          ? curAction.filter((t: string) => prevAction.has(t)).length / curAction.length
          : 0;
        return sameEmotion && overlap > 0.6;
      })(),
    },
  ];

  const matchCount   = checks.filter(c => c.same).length;
  const matchedDims  = checks.filter(c => c.same).map(c => c.dimension);
  // Risk score: 0 matches = 0, 3 matches = 50, 5 matches = 90, 6 = 100
  const raw = Math.min(100, Math.round((matchCount / checks.length) * 100 + (matchCount >= 5 ? 20 : 0)));
  const duplicate_risk_score = Math.min(100, raw);

  if (duplicate_risk_score >= 70) {
    return {
      duplicate_risk_score,
      duplicate_fail_reason: `Cosmetic duplicate: matches previous shot on [${matchedDims.join(', ')}] — no new screenplay information`,
    };
  }
  return { duplicate_risk_score };
}

// ─── SHOT DIFFERENCE CONTRACT BUILDER (TASK 1) ───────────────────────────────

export function buildSDC(
  shot: any,
  scene: any,
  prevShot: any | null,
  arcIdx: number,
): ShotDifferenceContract {
  const narrativeFn  = deriveNarrativeFunction(shot, scene, arcIdx, prevShot);
  const newInfo      = deriveNewInformation(shot, scene, arcIdx, prevShot);
  const reqAction    = deriveRequiredAction(shot, scene, arcIdx);
  const forbidden    = deriveForbiddenRepetitions(shot, prevShot, arcIdx);
  const visualDelta  = deriveVisualDelta(shot, prevShot, arcIdx);
  const { duplicate_risk_score, duplicate_fail_reason } = checkDuplicateRisk(shot, prevShot);

  return {
    narrative_function:                narrativeFn,
    new_information_introduced:        newInfo,
    required_visible_action:           reqAction,
    forbidden_repetition_from_previous: forbidden,
    visual_delta_from_previous:        visualDelta,
    duplicate_risk_score,
    duplicate_fail_reason,
  };
}

// ─── MUST-SHOW BUILDER ────────────────────────────────────────────────────────
// Derives concrete visual proof requirements from shot position and type.

function buildMustShow(shot: any, scene: any, arcIdx: number): string[] {
  const size    = n(shot.shot_size);
  const fn      = n(shot.dramatic_function || shot.shot_type || '');
  const loc     = s(scene?.location || shot.location || '').split(/[,.\n]/)[0].trim();
  const chars   = Array.isArray(shot.characters) ? shot.characters.slice(0, 2) : [];
  const action  = s(shot.action || '').split(/[.!?]/)[0].trim().slice(0, 60);
  const threat  = s(scene?.synopsis || '').match(/\b(godzilla|monster|creature|villain|enemy|threat|danger|attack|explosion|fire|flood|disaster)\b/i)?.[0] || '';

  if (size === 'ews' || (arcIdx === 0 && (size === 'ws' || size === 'ews'))) {
    return [
      `${loc || 'location'} fully readable in frame`,
      'character occupies ≤25% of frame',
      threat ? `${threat} or threat evidence visible` : 'scale of environment dominates',
      'depth layers: foreground, midground, background all present',
      'camera low or ground-level',
    ].filter(Boolean);
  }
  if (size === 'ws' || fn === 'establish') {
    return [
      `${loc || 'location'} readable as backdrop`,
      chars.length ? `${chars[0]} visible full-body or waist-up` : 'subject small relative to environment',
      'environmental context dominant over character face',
      'no tight portrait framing',
    ];
  }
  if (size === 'ms' || size === 'mcu' || fn === 'cover') {
    return [
      chars.length ? `${chars[0]} waist-to-chest framing` : 'character intent readable',
      'body language conveys emotional state',
      'face partially readable — not the ONLY subject',
      `action visible: "${action.slice(0, 40)}"`,
    ].filter(Boolean);
  }
  if (size === 'cu' || fn === 'react') {
    return [
      chars.length ? `${chars[0]} face dominates frame` : 'face or mask dominant',
      'micro-expression visible (jaw, eyes, brow)',
      'background heavily blurred (shallow DoF)',
      'no full-body visible',
      'internal psychological state readable in single frame',
    ];
  }
  if (size === 'ecu' || fn === 'insert') {
    return [
      'OBJECT or BODY DETAIL fills frame — not a standing portrait',
      'no full character profile visible',
      action ? `detail related to: "${action.slice(0, 40)}"` : 'specific prop, scar, hand, or environmental clue',
      'context clue places detail within scene location',
    ].filter(Boolean);
  }
  // Fallback
  return [
    `action visible: "${action.slice(0, 40)}"`,
    chars.length ? `${chars[0]} identifiable` : 'subject clearly rendered',
    'shot composition matches declared size and angle',
  ];
}

// ─── CANONICAL PROMPT BUILDER (TASK 3 PRIORITY ORDER) ────────────────────────
// MANDATORY PRIORITY ORDER:
//   1. Scene/Shot fingerprint
//   2. NARRATIVE FUNCTION (what role this shot plays)
//   3. NEW INFORMATION INTRODUCED (what story info is added)
//   4. REQUIRED VISIBLE ACTION (what physical action must be visible)
//   5. VISUAL DELTA FROM PREVIOUS (how this shot differs)
//   6. MUST SHOW (concrete checklist)
//   7. SCREENPLAY BEAT (action from shot fields)
//   --- identity/style/location come AFTER SDC, never before ---
//   8. LOCATION EVIDENCE
//   9. CONTINUITY
//  10. SUBJECT PRIORITY
//  11. BACKGROUND DOMINANCE
//  12. STYLE SUPPORT ONLY
//  13. IDENTITY LOCK
//  14. REJECT IF

function buildCanonicalPrompt(
  shot: any,
  scene: any,
  prevShot: any | null,
  characters: any[],
  styleBible: any,
  arcIdx: number,
  mustShow: string[],
  sdc: ShotDifferenceContract,
): string {
  const sceneNum  = s(shot.scene_number ?? scene?.scene_number ?? '?');
  const shotNum   = s(shot.shot_number ?? '?');
  const size      = (s(shot.shot_size)      || 'MS').toUpperCase();
  const angle     = (s(shot.camera_angle)   || 'eye-level').toUpperCase();
  const height    = (s(shot.camera_height)  || 'eye-level').toUpperCase();
  const position  = (s(shot.subject_position) || 'centered').toLowerCase();

  const action        = s(shot.action || shot.visual_description || '').split(/[.!?]/)[0].trim().slice(0, 120);
  const emotion       = s(shot.emotional_beat || shot.emotion || shot.mood || '').split(/[.;]/)[0].trim().slice(0, 60);
  const dramaticFn    = s(shot.dramatic_function || shot.shot_type || 'cover').trim();
  const bgDom         = s(shot.background_dominance || (arcIdx === 0 ? 'dominant' : arcIdx >= 2 ? 'minimal' : 'balanced'));
  const focalLength   = s(shot.focal_length || (size === 'WS' || size === 'EWS' ? '24mm' : size === 'CU' || size === 'MCU' ? '85mm' : size === 'ECU' ? '135mm' : '50mm'));

  // Location evidence
  const locRaw    = s(scene?.location || shot.location || '').split(/[,.\n]/)[0].trim();
  const timeOfDay = s(scene?.time_of_day || shot.time_of_day || '').trim();
  const locLine   = [locRaw, timeOfDay].filter(Boolean).join(', ');

  // Continuity
  const prevAction = prevShot ? s(prevShot.action || '').split(/[.!?]/)[0].trim().slice(0, 50) : '';
  const prevSize   = prevShot ? (s(prevShot.shot_size) || '').toUpperCase() : '';
  const continuity = prevShot
    ? `follows ${prevSize} shot: "${prevAction || 'previous beat'}"`
    : `opens scene — establishes spatial grammar for ${locRaw || 'location'}`;

  // Subject priority
  const chars       = Array.isArray(shot.characters) ? shot.characters.slice(0, 2) : [];
  const charStr     = chars.length ? chars.join(' + ') : 'subject';
  const subjectLine = (size === 'WS' || size === 'EWS')
    ? `${charStr} occupies ≤25% of frame — environment dominates`
    : (size === 'ECU' || dramaticFn === 'insert')
    ? `OBJECT / DETAIL — ${charStr} may be absent or out-of-focus`
    : `${charStr} — ${size === 'CU' ? 'face dominant, body cropped' : 'waist-to-chest, intent readable'}`;

  // Identity locks — compact
  const locks: string[] = [];
  if (characters.length > 0) {
    characters.forEach((c: any) => {
      if (!c || !c.name) return;
      const id = [
        c.face_traits?.split(/[,;]/)[0]?.trim(),
        c.hair?.split(/[,;]/)[0]?.trim(),
        c.outfit?.split(/[,;]/)[0]?.trim(),
        c.physical_signature?.split(/[,;]/)[0]?.trim(),
      ].filter(Boolean).slice(0, 3).join(', ');
      if (id) locks.push(`[${c.name.toUpperCase()} LOCK: ${id}]`);
    });
  }
  const identityLine = locks.length ? locks.join(' | ') : '';

  // Style support — brief
  const styleArt = s(styleBible?.art_direction || '').split(/[.;,]/)[0].trim().slice(0, 40);
  const styleColor = (() => {
    const p = s(styleBible?.color_palette || '');
    const hexes = p.match(/#[0-9A-Fa-f]{3,6}/g);
    return hexes ? hexes.slice(0, 3).join('/') : p.split(/[.;,]/)[0].trim().slice(0, 30);
  })();
  const styleLine = [styleArt, focalLength, styleColor].filter(Boolean).join(', ');

  // Reject-if conditions
  const rejectIf: string[] = [];
  if (arcIdx === 0) rejectIf.push('close-up portrait', 'character fills frame', 'no background context');
  if (arcIdx === 1) rejectIf.push('same composition as shot 1', 'character looks outward passively');
  if (arcIdx === 2) rejectIf.push('full body visible', 'background dominates', 'generic neutral expression');
  if (arcIdx === 3) rejectIf.push('standing profile portrait', 'character fills frame without object detail');
  rejectIf.push('generic man touching glasses', 'person on phone', 'blurred city portrait');
  if (sdc.duplicate_fail_reason) rejectIf.push(`DUPLICATE: ${sdc.duplicate_fail_reason.slice(0, 60)}`);

  // TASK 3 — PRIORITY ORDER: SDC fields first, style/identity last
  // Shared scene style must never dominate the first 120 tokens.
  const lines: string[] = [
    // ── GROUP 1: Shot fingerprint + screenplay contract (first 120 tokens) ──────
    `[Scene ${sceneNum} / Shot ${shotNum} | ${size} | ${angle} | ${height} | ${position}]`,
    `NARRATIVE FUNCTION: ${sdc.narrative_function.toUpperCase()} — ${dramaticFn}`,
    `NEW INFORMATION: ${sdc.new_information_introduced}`,
    `REQUIRED ACTION: ${sdc.required_visible_action}`,
    `VISUAL DELTA: ${sdc.visual_delta_from_previous}`,
    // ── GROUP 2: Proof checklist ─────────────────────────────────────────────────
    `MUST SHOW: ${mustShow.join(' · ')}`,
    `SCREENPLAY BEAT: ${action || 'action not specified'}${emotion ? ` — ${emotion}` : ''}`,
  ];

  if (sdc.forbidden_repetition_from_previous.length > 0) {
    lines.push(`FORBIDDEN REPEAT: ${sdc.forbidden_repetition_from_previous.slice(0, 3).join(' | ')}`);
  }

  // ── GROUP 3: Spatial + continuity context ────────────────────────────────────
  lines.push(`LOCATION EVIDENCE: ${locLine || 'location context required'}`);
  lines.push(`CONTINUITY: ${continuity}`);
  lines.push(`SUBJECT PRIORITY: ${subjectLine}`);
  lines.push(`BACKGROUND DOMINANCE: ${bgDom}`);

  // ── GROUP 4: Style (LAST — must not dominate early tokens) ───────────────────
  lines.push(`STYLE SUPPORT ONLY: ${styleLine || 'motivated cinematic lighting'}`);
  if (identityLine) lines.push(`IDENTITY LOCK: ${identityLine}`);
  lines.push(`REJECT IF: ${rejectIf.join('; ')}`);

  return lines.join('\n');
}

// ─── VERIFIER ─────────────────────────────────────────────────────────────────
// 8 dimensions (0–5 each = 40 max)
// Pass: total ≥ 28, beat_match ≥ 4, non_generic ≥ 4, removal_value ≥ 3

function scoreTokenOverlap(source: string, target: string): number {
  if (!source || !target) return 0;
  const srcTokens = new Set(source.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(t => t.length > 2));
  const tgtTokens = target.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(t => t.length > 2);
  if (srcTokens.size === 0 || tgtTokens.length === 0) return 0;
  const matches = tgtTokens.filter(t => srcTokens.has(t)).length;
  return Math.min(5, Math.round((matches / Math.min(srcTokens.size, 8)) * 5));
}

export function verifyPrompt(
  prompt: string,
  shot: any,
  scene: any,
  mustShow: string[],
  sdc?: ShotDifferenceContract,
): VerifierResult {
  const dims: VerifierDimension[] = [];
  const failReasons: string[] = [];

  // 1. Screenplay beat match
  const beatRef = s(shot.action || shot.visual_description || '');
  const beatScore = scoreTokenOverlap(beatRef, prompt);
  dims.push({ name: 'screenplay_beat_match', score: beatScore, reason: beatScore < 4 ? `beat tokens from "${beatRef.slice(0,40)}" not found in prompt` : 'beat reflected in prompt' });
  if (beatScore < 4) failReasons.push(`screenplay beat match too low (${beatScore}/5)`);

  // 2. Action visibility — HARD FAIL if no specific action verb
  // Check BOTH the REQUIRED ACTION section AND the SCREENPLAY BEAT section.
  // This ensures establishing shots (arcIdx=0) where REQUIRED ACTION is positional
  // still pass if the screenplay beat itself contains a strong physical verb
  // (e.g. "Godzilla silhouette rises above Tokyo skyline, dwarfing skyscrapers").
  const actionNowSection = prompt.match(/REQUIRED ACTION:([^\n]+)/)?.[1] || prompt.match(/ACTION NOW:([^\n]+)/)?.[1] || '';
  const beatSection      = prompt.match(/SCREENPLAY BEAT:([^\n]+)/)?.[1] || '';
  // Combine ALL available text fields so verb detection is not sabotaged when
  // shot.action is only a character listing ("Characters: X") and the real physical
  // action lives in visual_description, shot_description, or scene_summary.
  // Use join (not ||) so both action AND visual_description are always searched.
  const rawActionField = s([
    shot.action           || '',
    shot.visual_description || '',
    shot.shot_description || '',
    shot.scene_summary    || '',
  ].filter(Boolean).join(' ')).slice(0, 300);
  const combinedActionText = [actionNowSection, beatSection, rawActionField].join(' ');
  const hasStrongVerb  = REQUIRED_ACTION_VERBS.test(combinedActionText);
  const hasGenericVerb = /\b(looks?|stands?|sits?|walks?|watches?|gazes?)\b/i.test(actionNowSection) && !hasStrongVerb;
  const actionMissing  = !combinedActionText.trim() || (!hasStrongVerb && !hasGenericVerb);
  const actionScore    = hasStrongVerb ? 5 : hasGenericVerb ? 2 : actionMissing ? 0 : 3;
  dims.push({ name: 'action_visibility', score: actionScore, reason: hasStrongVerb ? 'strong specific verb present' : hasGenericVerb ? 'only generic verb found — must use specific physical action' : actionMissing ? 'HARD FAIL: 缺少具体动作 — REQUIRED ACTION/BEAT section lacks any action verb' : 'action present but could be more specific' });
  if (!hasStrongVerb && (hasGenericVerb || actionMissing)) failReasons.push(`缺少具体动作 — action_visibility ${actionScore}/5: REQUIRED ACTION must use a specific physical verb (not looks/stands/walks/gazes)`);

  // 3. Location evidence
  const locRef = s(scene?.location || shot.location || '').split(/[,.\n]/)[0].toLowerCase();
  const locKeywords = locRef.split(/\s+/).filter(t => t.length > 3);
  const locMatches = locKeywords.filter(k => prompt.toLowerCase().includes(k)).length;
  const locScore = locKeywords.length === 0 ? 3 : Math.min(5, Math.round((locMatches / locKeywords.length) * 5));
  dims.push({ name: 'location_evidence', score: locScore, reason: locScore < 3 ? `location terms "${locRef.slice(0,30)}" missing from prompt` : 'location evidence present' });

  // 4. Character correctness
  const chars = Array.isArray(shot.characters) ? shot.characters : [];
  if (chars.length === 0) {
    dims.push({ name: 'character_correctness', score: 5, reason: 'no characters required for this shot' });
  } else {
    const present = chars.filter((c: string) => prompt.toLowerCase().includes(c.toLowerCase().split(/\s+/)[0]));
    const charScore = Math.round((present.length / chars.length) * 5);
    dims.push({ name: 'character_correctness', score: charScore, reason: charScore < 3 ? `characters not found: ${chars.filter((c: string) => !present.includes(c)).join(', ')}` : 'required characters referenced' });
    if (charScore < 3) failReasons.push('required characters not referenced in prompt');
  }

  // 5. Threat/object correctness
  const size     = n(shot.shot_size);
  const fn       = n(shot.dramatic_function || shot.shot_type || '');
  let threatScore = 3;
  let threatReason = 'no specific object requirement for this shot type';
  if (size === 'ecu' || fn === 'insert') {
    const hasObjectDetail = /\b(hand|finger|glove|ring|key|phone|screen|weapon|gun|knife|token|seal|wound|scar|detail|device|button|trigger|dial|wire|cable|crack|chip|symbol|sign|label|badge|stamp|mark)\b/i.test(prompt);
    threatScore = hasObjectDetail ? 5 : 1;
    threatReason = hasObjectDetail ? 'object/detail present in insert shot' : 'INSERT shot missing concrete object detail';
    if (!hasObjectDetail) failReasons.push('ECU/INSERT shot has no concrete object/detail');
  } else if (size === 'ws' || size === 'ews') {
    const hasThreat = /\b(godzilla|monster|creature|villain|enemy|threat|danger|army|explosion|fire|flood|disaster|shadow|silhouette|crowd|scale|vast|massive|towering|looming|enormous)\b/i.test(prompt)
      || /\b(background|backdrop|skyline|horizon|landscape|cityscape|environment|terrain|surroundings)\b/i.test(prompt);
    threatScore = hasThreat ? 5 : 2;
    threatReason = hasThreat ? 'scale/threat/environment evidence present' : 'WS/EWS shot lacks scale/threat/environment context';
  }
  dims.push({ name: 'threat_object_correctness', score: threatScore, reason: threatReason });

  // 6. Continuity correctness
  const hasContinuity = /CONTINUITY:\s*\S/.test(prompt);
  const continuityIsGeneric = /CONTINUITY:\s*(n\/a|none|standard|follows previous|previous shot)\s*$/im.test(prompt);
  const continuityScore = hasContinuity && !continuityIsGeneric ? 5 : hasContinuity ? 3 : 1;
  dims.push({ name: 'continuity_correctness', score: continuityScore, reason: continuityScore < 3 ? 'continuity section missing or generic' : 'continuity link present' });

  // 7. Non-genericity (generic portrait collapse filter)
  const genericDetected = GENERIC_PORTRAIT_PATTERNS.some(p => p.test(prompt));
  const nonGenericScore = genericDetected ? 0 : 5;
  dims.push({ name: 'non_genericity', score: nonGenericScore, reason: genericDetected ? 'GENERIC PORTRAIT COLLAPSE DETECTED — prompt describes banned visual pattern' : 'no banned generic patterns found' });
  if (genericDetected) failReasons.push('generic portrait collapse pattern detected');

  // 8. ── SCREENPLAY REMOVAL VALUE (TASK 6) ─────────────────────────────────────
  // "If this shot were removed, would the scene lose information, emotion, or transition value?"
  // Score 5 = clearly yes, shot is uniquely irreplaceable
  // Score 0 = clearly no, shot is cosmetic duplicate — FAIL
  let removalScore = 3;
  let removalReason = 'shot contributes standard scene value';
  if (sdc) {
    const hasNewInfo    = sdc.new_information_introduced && sdc.new_information_introduced.length > 20
      && !sdc.new_information_introduced.includes('standard')
      && !sdc.new_information_introduced.includes('general');
    const hasDelta      = sdc.visual_delta_from_previous && !sdc.visual_delta_from_previous.includes('MINIMAL VISUAL DELTA')
      && !sdc.visual_delta_from_previous.includes('Opens scene');
    const isDuplicate   = sdc.duplicate_risk_score >= 70;
    const isMinimalDelta = sdc.visual_delta_from_previous?.includes('MINIMAL VISUAL DELTA');

    if (isDuplicate) {
      removalScore  = 0;
      removalReason = `COSMETIC DUPLICATE — ${sdc.duplicate_fail_reason || 'no new screenplay value added'}`;
      failReasons.push(`shot removal value = 0: ${sdc.duplicate_fail_reason || 'cosmetic duplicate of previous shot'}`);
    } else if (isMinimalDelta && !hasNewInfo) {
      removalScore  = 1;
      removalReason = 'minimal visual and narrative delta from previous shot — nearly redundant';
      failReasons.push('shot adds minimal unique value (nearly redundant with previous shot)');
    } else if (hasNewInfo && hasDelta) {
      removalScore  = 5;
      removalReason = `shot introduces: "${sdc.new_information_introduced.slice(0, 60)}" — scene would lose this information if removed`;
    } else if (hasNewInfo || hasDelta) {
      removalScore  = 4;
      removalReason = hasNewInfo ? 'shot introduces new narrative information' : 'shot has clear visual delta from previous';
    } else {
      removalScore  = 2;
      removalReason = 'unclear if shot adds unique value — verify narrative_function vs previous shot';
    }
  }
  dims.push({ name: 'screenplay_removal_value', score: removalScore, reason: removalReason });

  const total = dims.reduce((acc, d) => acc + d.score, 0);
  const beatMatch      = dims.find(d => d.name === 'screenplay_beat_match')?.score ?? 0;
  const nonGeneric     = dims.find(d => d.name === 'non_genericity')?.score ?? 0;
  const removal        = dims.find(d => d.name === 'screenplay_removal_value')?.score ?? 0;
  const actionVis      = dims.find(d => d.name === 'action_visibility')?.score ?? 0;

  // ── 5 EXPLICIT HARD-FAIL CONDITIONS ─────────────────────────────────────────
  // Any one of these blocks generation regardless of total score.
  const HARD_FAIL_CHECKS: Array<{ condition: boolean; code: string; reason: string }> = [
    {
      condition: actionVis < 3,
      code: 'MISSING_SPECIFIC_ACTION',
      reason: `缺少具体动作 — REQUIRED ACTION must contain a specific physical verb (score ${actionVis}/5). Generic verbs like looks/stands/gazes are banned.`,
    },
    {
      condition: removal < 3 && !sdc?.visual_delta_from_previous?.includes('Opens scene'),
      code: 'MISSING_UNIQUE_INFO',
      reason: `缺少本镜头独有信息 — screenplay_removal_value ${removal}/5. This shot does not introduce new narrative information that would be lost if removed.`,
    },
    {
      condition: sdc != null && sdc.visual_delta_from_previous.includes('MINIMAL VISUAL DELTA'),
      code: 'MISSING_VISUAL_DELTA',
      reason: `缺少与上一镜头的差异 — visual_delta is MINIMAL. This shot must differ from the previous in size, angle, height, function, or emotion.`,
    },
    {
      condition: genericDetected,
      code: 'GENERIC_PORTRAIT',
      reason: `仍然是通用人物肖像/氛围图 — GENERIC_PORTRAIT_COLLAPSE detected. Prompt matches a banned visual pattern (standing/looking, blurred city portrait, centered hero pose, etc.).`,
    },
    {
      condition: beatMatch < 4,
      code: 'NOT_SCREENPLAY_BOUND',
      reason: `不能回答"这张图为什么必须是S${s(sdc ? (sdc as any).scene_number ?? '?' : '?')}.${s(sdc ? (sdc as any).shot_number ?? '?' : '?')}" — screenplay_beat_match ${beatMatch}/5. The prompt does not trace back to this specific shot's beat.`,
    },
  ];

  const hardFails = HARD_FAIL_CHECKS.filter(c => c.condition);
  hardFails.forEach(hf => {
    if (!failReasons.includes(hf.reason)) failReasons.push(hf.reason);
  });

  // Pass requires ALL hard-fail conditions clear + numeric thresholds
  // total ≥ 28/40, beat_match ≥ 4, non_generic ≥ 4, removal ≥ 3, action_visibility ≥ 3
  const passes = hardFails.length === 0 && total >= 28 && beatMatch >= 4 && nonGeneric >= 4 && removal >= 3 && actionVis >= 3;

  if (!passes && failReasons.length === 0) {
    failReasons.push(`total score ${total}/40 below threshold 28`);
  }

  return { total, passes, dimensions: dims, fail_reasons: failReasons, generic_portrait_detected: genericDetected, hard_fails: hardFails.map(hf => ({ code: hf.code, reason: hf.reason })) } as VerifierResult;
}

// ─── VIDEO GROUNDING ──────────────────────────────────────────────────────────

export function buildGroundedVideoPrompt(
  shot: any,
  scene: any,
  prevShot: any | null,
  canonicalPrompt: string,
): string {
  const movement  = s(shot.camera_movement || 'static');
  const action    = s(shot.action || '').split(/[.!?]/)[0].trim().slice(0, 80);
  const emotion   = s(shot.emotional_beat || shot.emotion || '');
  const size      = (s(shot.shot_size) || 'MS').toUpperCase();
  const lighting  = s(shot.lighting_setup || '').split(/[.;]/)[0].trim().slice(0, 50);
  const motiveRaw = s(shot.movement_motivation || '').split(/[.;]/)[0].trim().slice(0, 60);
  const motive    = motiveRaw || (movement === 'push-in' ? 'revelation of internal state' : movement === 'static' ? 'character holds power in frame' : 'follows character momentum');
  const duration  = shot.duration_sec ? `${shot.duration_sec}s` : '4s';
  const prevBeat  = prevShot ? s(prevShot.action || '').split(/[.!?]/)[0].trim().slice(0, 40) : '';

  const nextIntent = (() => {
    const nextFn = n(shot.dramatic_function || '');
    if (nextFn === 'react') return 'cut to tight face reaction';
    if (nextFn === 'insert') return 'cut to detail insert';
    if (nextFn === 'establish') return 'cut to wider establishing';
    return 'cut on action peak';
  })();

  const lines = [
    `${movement.toUpperCase()} over ${duration} — ${motive}.`,
    `BEAT: ${action}${emotion ? ` (${emotion})` : ''}.`,
    prevBeat ? `CARRY-OVER from previous: "${prevBeat}" — maintain spatial continuity.` : `OPENS SCENE — camera settles to reveal ${size} composition.`,
    `SIZE: ${size}. Maintain shot size throughout unless motivated push-in noted.`,
    `LIGHTING CARRY: ${lighting || 'motivated cinematic practicals'}.`,
    `END FRAME: hold on final position — actor stillness or peak action freeze.`,
    `TRANSITION INTENT: ${nextIntent}.`,
    shot.dialogue_text ? `DIALOGUE SYNC: "${s(shot.dialogue_text).slice(0,60)}" — lip-sync if applicable.` : '',
    `DO NOT: drift into portrait mode, change character wardrobe, alter environment scale.`,
  ].filter(Boolean);

  return lines.join('\n');
}

// ─── MAIN ENTRY POINT ─────────────────────────────────────────────────────────

/**
 * rewriteShot — the primary export.
 * Call this AFTER the arc enforcer has repaired structured fields.
 * It:
 *   1. Computes the Shot Difference Contract (SDC)
 *   2. Checks anti-redundancy (duplicate_risk_score)
 *   3. Builds canonical prompt with SDC fields as first tokens (Task 3 priority order)
 *   4. Verifies with 8-dimension verifier including screenplay removal value (Task 6)
 *   5. Auto-rewrites once if score fails
 */
export function rewriteShot(
  shot: any,
  scene: any,
  prevShot: any | null,
  characters: any[],
  styleBible: any,
  arcIdx: number,         // 0-based position in scene (0=establish, 1=cover, 2=react, 3=insert)
): CanonicalShotResult {
  const geminiProse = s(shot.image_prompt || '');
  const mustShow    = buildMustShow(shot, scene, arcIdx);

  // ── Compute Shot Difference Contract (TASK 1) ──────────────────────────────
  const sdc = buildSDC(shot, scene, prevShot, arcIdx);

  // ── Build canonical prompt (pass 1) — SDC fields FIRST (TASK 3) ────────────
  let canonical = buildCanonicalPrompt(shot, scene, prevShot, characters, styleBible, arcIdx, mustShow, sdc);
  let verifier  = verifyPrompt(canonical, shot, scene, mustShow, sdc);
  let rewrites  = 0;

  // ── Auto-rewrite if fails (pass 2) ─────────────────────────────────────────
  if (!verifier.passes) {
    rewrites = 1;
    const failContext = verifier.fail_reasons.join('; ');
    const fixInstructions: string[] = [];

    if (verifier.generic_portrait_detected) {
      fixInstructions.push('BANNED PATTERN DETECTED — rewrite action to show specific physical event, not standing/looking posture');
    }
    const beatDim = verifier.dimensions.find(d => d.name === 'screenplay_beat_match');
    if (beatDim && beatDim.score < 4) {
      fixInstructions.push(`BEAT MISMATCH — action must reference: "${s(shot.action || '').slice(0, 60)}"`);
    }
    const locDim = verifier.dimensions.find(d => d.name === 'location_evidence');
    if (locDim && locDim.score < 3) {
      const locRef = s(scene?.location || '').split(/[,.\n]/)[0].trim();
      fixInstructions.push(`LOCATION MISSING — must include location terms from: "${locRef}"`);
    }
    const objDim = verifier.dimensions.find(d => d.name === 'threat_object_correctness');
    if (objDim && objDim.score < 3) {
      fixInstructions.push('OBJECT MISSING — ECU/INSERT shot must name a specific physical object, body part, or detail');
    }
    const removeDim = verifier.dimensions.find(d => d.name === 'screenplay_removal_value');
    if (removeDim && removeDim.score < 3) {
      fixInstructions.push(`REMOVAL VALUE LOW — this shot is near-duplicate of previous; must introduce: "${sdc.new_information_introduced.slice(0, 60)}"`);
    }

    // Rebuild with refined action
    const refinedAction = s(shot.action || '').replace(
      /\b(looks?\s+at|watches?|stands?\s+and\s+looks?|gazes?\s+at|scans?\s+the)\b[^.!?]*/gi,
      (match) => match.replace(/looks?\s+at|watches?|gazes?\s+at|scans?\s+the/, 'observes threat in').slice(0, 60)
    );
    const shotOverride = { ...shot, action: refinedAction };

    canonical = buildCanonicalPrompt(shotOverride, scene, prevShot, characters, styleBible, arcIdx, mustShow, sdc);
    canonical += `\n\nREWRITE NOTE: ${fixInstructions.join(' | ')}`;
    verifier = verifyPrompt(canonical, shotOverride, scene, mustShow, sdc);
  }

  // ── Video grounding ─────────────────────────────────────────────────────────
  const rawVideoPrompt = s(shot.video_prompt || shot.video_motion_prompt || '');
  const videoIsGeneric = !rawVideoPrompt || rawVideoPrompt.length < 40
    || /^(camera moves?|static shot|character (moves?|walks?|stands?))/i.test(rawVideoPrompt.trim());

  if (videoIsGeneric) {
    shot.video_prompt = buildGroundedVideoPrompt(shot, scene, prevShot, canonical);
    shot.video_motion_prompt = shot.video_prompt;
  }

  // ── Determine screenplay beat for UI ───────────────────────────────────────
  const scriptBeat = s(shot.action || shot.visual_description || '').split(/[.!?]/)[0].trim().slice(0, 100);

  const geminiProseDifferent = geminiProse.slice(0, 80).trim() !== canonical.slice(0, 80).trim();

  return {
    canonical_prompt:      canonical,
    screenplay_beat:       scriptBeat,
    must_show:             mustShow,
    verifier,
    approved:              verifier.passes,
    rewrite_count:         rewrites,
    gemini_prose_discarded: geminiProseDifferent,
    sdc,
  };
}

// ─── SHOT EXPLAIN BUILDER ─────────────────────────────────────────────────────
// Produces the required per-shot explain output.
//
// Format:
//   SHOT Sx.y
//   - screenplay beat:
//   - required action:
//   - must show:
//   - why this image matches this exact shot:
//   - why it is different from previous shot:

export interface ShotExplain {
  shot_label:      string;    // "SHOT S1.2"
  screenplay_beat: string;    // one-line beat description
  required_action: string;    // required physical action
  must_show:       string[];  // concrete visual proof checklist
  why_matches:     string;    // why this image matches this exact shot
  why_differs:     string;    // why it differs from previous shot
  verifier_passes: boolean;
  verifier_score:  string;    // e.g. "32/40"
  fail_reasons:    string[];  // populated if verifier fails
  hard_fail_codes: string[];  // e.g. ['MISSING_SPECIFIC_ACTION']
  blocked:         boolean;   // true when hard_fails exist → cannot enter video generation
}

export function buildShotExplain(
  shot:     any,
  scene:    any,
  prevShot: any | null,
  sdc:      ShotDifferenceContract,
  verifier: VerifierResult,
  mustShow: string[],
): ShotExplain {
  const sceneNum = s(shot.scene_number ?? scene?.scene_number ?? '?');
  const shotNum  = s(shot.shot_number  ?? '?');
  const label    = `SHOT S${sceneNum}.${shotNum}`;

  const beat = s(shot.action || shot.visual_description || '').split(/[.!?]/)[0].trim().slice(0, 100);

  const scoreStr = `${verifier.total}/${verifier.dimensions.length * 5}`;

  const hardFailCodes = (verifier.hard_fails ?? []).map(hf => hf.code);

  const whyMatches = verifier.passes
    ? [
        `"${beat}"`,
        `narrative function: ${sdc.narrative_function}`,
        `required action: "${sdc.required_visible_action.slice(0, 60)}"`,
        `new info: ${sdc.new_information_introduced.slice(0, 60)}`,
      ].join(' | ')
    : `FAILED (${scoreStr}) — ${verifier.fail_reasons.slice(0, 2).join('; ')}`;

  const whyDiffers = sdc.visual_delta_from_previous.includes('MINIMAL VISUAL DELTA')
    ? `⚠ MINIMAL DELTA — ${sdc.visual_delta_from_previous}`
    : `${sdc.visual_delta_from_previous}`;

  const blocked = (verifier.hard_fails ?? []).length > 0 || !verifier.passes;

  return {
    shot_label:      label,
    screenplay_beat: beat,
    required_action: sdc.required_visible_action,
    must_show:       mustShow,
    why_matches:     whyMatches,
    why_differs:     whyDiffers,
    verifier_passes: verifier.passes,
    verifier_score:  scoreStr,
    fail_reasons:    verifier.fail_reasons,
    hard_fail_codes: hardFailCodes,
    blocked,
  };
}
