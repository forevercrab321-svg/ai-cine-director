/**
 * lib/canonicalPromptRewriter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * POST-PLANNER IMAGE PROMPT REWRITER — STRUCTURED FIELDS ARE SOURCE OF TRUTH
 *
 * Gemini raw image_prompt prose is UNTRUSTED INPUT.
 * This module:
 *   1. Builds a CANONICAL image_prompt from structured shot fields
 *   2. Verifies screenplay faithfulness (7 dimensions, 0-5 each = 35 max)
 *   3. Detects generic portrait collapse patterns
 *   4. Auto-rewrites if verifier score fails thresholds
 *   5. Produces traceability data for UI display
 *
 * PASS THRESHOLDS (all must be met):
 *   total score  ≥ 24 / 35
 *   beat_match   ≥ 4 / 5
 *   non_generic  ≥ 4 / 5
 */

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface VerifierDimension {
  name: string;
  score: number;   // 0–5
  reason: string;
}

export interface VerifierResult {
  total: number;                  // 0–35
  passes: boolean;
  dimensions: VerifierDimension[];
  fail_reasons: string[];
  generic_portrait_detected: boolean;
}

export interface CanonicalShotResult {
  canonical_prompt: string;       // The approved prompt to send to the image model
  screenplay_beat: string;        // One-line beat description for UI
  must_show: string[];            // Checklist: concrete visible proof required
  verifier: VerifierResult;
  approved: boolean;
  rewrite_count: number;          // How many rewrite iterations were needed
  gemini_prose_discarded: boolean;// True when original Gemini image_prompt was replaced
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

const REQUIRED_ACTION_VERBS: RegExp = /\b(perch|crouches?|leaps?|grabs?|fires?|swings?|pulls?|yanks?|slams?|dives?|rolls?|spins?|lunges?|blocks?|deflects?|pivots?|tears?|rips?|holds?|clutches?|tightens?|reaches?|extends?|points?|throws?|catches?|strikes?|kicks?|punches?|stumbles?|falls?|rises?|lands?|crashes?|explodes?|erupts?|collapses?|staggers?|freezes?|flinches?|trembles?|shakes?|twists?|ducking?|vaulting?|sprinting?|climbing?)\b/i;

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

// ─── CANONICAL PROMPT BUILDER ─────────────────────────────────────────────────
// Builds the canonical prompt from structured fields. Gemini prose is NOT used
// as a base. Only the `action` field (a short directive string) is preserved.

function buildCanonicalPrompt(
  shot: any,
  scene: any,
  prevShot: any | null,
  characters: any[],
  styleBible: any,
  arcIdx: number,
  mustShow: string[],
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
  const lighting      = s(shot.lighting_setup || shot.lighting || 'motivated cinematic lighting').split(/[.;]/)[0].trim().slice(0, 70);

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

  const lines: string[] = [
    `[Scene ${sceneNum} / Shot ${shotNum} | ${size} | ${angle} | ${height} | ${position}]`,
    `SCREENPLAY BEAT: ${action || 'action not specified'}`,
    `MUST SHOW: ${mustShow.join(' · ')}`,
    `ACTION NOW: ${action}${emotion ? ` — ${emotion}` : ''}`,
    `LOCATION EVIDENCE: ${locLine || 'location context required'}`,
    `CONTINUITY: ${continuity}`,
    `SUBJECT PRIORITY: ${subjectLine}`,
    `BACKGROUND DOMINANCE: ${bgDom}`,
    `STYLE SUPPORT ONLY: ${styleLine || 'motivated cinematic lighting'}`,
  ];
  if (identityLine) lines.push(`IDENTITY LOCK: ${identityLine}`);
  lines.push(`REJECT IF: ${rejectIf.join('; ')}`);

  return lines.join('\n');
}

// ─── VERIFIER ─────────────────────────────────────────────────────────────────

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
): VerifierResult {
  const dims: VerifierDimension[] = [];
  const failReasons: string[] = [];

  // 1. Screenplay beat match
  const beatRef = s(shot.action || shot.visual_description || '');
  const beatScore = scoreTokenOverlap(beatRef, prompt);
  dims.push({ name: 'screenplay_beat_match', score: beatScore, reason: beatScore < 4 ? `beat tokens from "${beatRef.slice(0,40)}" not found in prompt` : 'beat reflected in prompt' });
  if (beatScore < 4) failReasons.push(`screenplay beat match too low (${beatScore}/5)`);

  // 2. Action visibility
  const actionNowSection = prompt.match(/ACTION NOW:(.+)/)?.[1] || '';
  const hasStrongVerb = REQUIRED_ACTION_VERBS.test(actionNowSection);
  const hasGenericVerb = /\b(looks?|stands?|sits?|walks?|watches?|gazes?)\b/i.test(actionNowSection) && !hasStrongVerb;
  const actionScore = hasStrongVerb ? 5 : hasGenericVerb ? 2 : 3;
  dims.push({ name: 'action_visibility', score: actionScore, reason: hasStrongVerb ? 'strong specific verb present' : hasGenericVerb ? 'only generic verb found' : 'action present but could be more specific' });

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
  const synopsis = n(scene?.synopsis || '');
  let threatScore = 3; // default neutral
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

  const total = dims.reduce((acc, d) => acc + d.score, 0);
  const beatMatch = dims.find(d => d.name === 'screenplay_beat_match')?.score ?? 0;
  const nonGeneric = dims.find(d => d.name === 'non_genericity')?.score ?? 0;
  const passes = total >= 24 && beatMatch >= 4 && nonGeneric >= 4;

  if (!passes && failReasons.length === 0) {
    failReasons.push(`total score ${total}/35 below threshold 24`);
  }

  return { total, passes, dimensions: dims, fail_reasons: failReasons, generic_portrait_detected: genericDetected };
}

// ─── VIDEO GROUNDING ──────────────────────────────────────────────────────────
// Builds a grounded video prompt from structured fields + canonical prompt data.
// Used to replace Gemini's raw video_prompt when it is generic.

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
 * It rebuilds image_prompt and video_prompt from structured truth,
 * verifies the result, and if it fails, tries once more with explicit
 * failure context injected into the prompt.
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

  // ── Build canonical prompt (pass 1) ────────────────────────────────────────
  let canonical = buildCanonicalPrompt(shot, scene, prevShot, characters, styleBible, arcIdx, mustShow);
  let verifier  = verifyPrompt(canonical, shot, scene, mustShow);
  let rewrites  = 0;

  // ── Auto-rewrite if fails (pass 2) ─────────────────────────────────────────
  if (!verifier.passes) {
    rewrites = 1;
    // Inject explicit failure context to make the second pass more targeted
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

    // Rebuild with override action that strips generic language
    const refinedAction = s(shot.action || '').replace(
      /\b(looks?\s+at|watches?|stands?\s+and\s+looks?|gazes?\s+at|scans?\s+the)\b[^.!?]*/gi,
      (match) => match.replace(/looks?\s+at|watches?|gazes?\s+at|scans?\s+the/, 'observes threat in').slice(0, 60)
    );
    const shotOverride = { ...shot, action: refinedAction };

    canonical = buildCanonicalPrompt(shotOverride, scene, prevShot, characters, styleBible, arcIdx, mustShow);
    canonical += `\n\nREWRITE NOTE: ${fixInstructions.join(' | ')}`;
    verifier = verifyPrompt(canonical, shotOverride, scene, mustShow);
  }

  // ── Video grounding ─────────────────────────────────────────────────────────
  // Only replace video_prompt if it's blank or generic
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
  };
}
