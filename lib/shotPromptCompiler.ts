type Primitive = string | number | boolean | null | undefined;

export interface ShotPromptCompilerInput {
  shot: any;
  scene?: any;
  styleBible?: any;
  continuityState?: any;
  previousShot?: any;
  previousPrompt?: string;
  characterAnchor?: string;
  styleLabel?: string;
}

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

const norm = (value: Primitive): string => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();

const normalizeTextForSim = (value: string): string =>
  norm(value)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenize = (value: string): Set<string> => {
  const cleaned = normalizeTextForSim(value);
  const terms = cleaned.split(' ').filter((t) => t.length > 2);
  return new Set(terms);
};

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((term) => {
    if (b.has(term)) inter += 1;
  });
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
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

const getShotDelta = (currentShot: any, previousShot?: any): ShotDeltaReport => {
  if (!previousShot) {
    return { changed_fields: ['initial_shot'], summary: 'First shot in sequence' };
  }

  const comparePairs: Array<{ key: string; current: string; previous: string }> = [
    { key: 'location', current: norm(currentShot?.location || currentShot?.scene_setting), previous: norm(previousShot?.location || previousShot?.scene_setting) },
    { key: 'characters', current: toListString(currentShot?.characters), previous: toListString(previousShot?.characters) },
    { key: 'action', current: norm(currentShot?.action || currentShot?.visual_description), previous: norm(previousShot?.action || previousShot?.visual_description) },
    { key: 'emotion', current: norm(currentShot?.emotion || currentShot?.mood || currentShot?.emotional_beat), previous: norm(previousShot?.emotion || previousShot?.mood || previousShot?.emotional_beat) },
    { key: 'camera_framing', current: norm(currentShot?.camera_framing || currentShot?.composition || currentShot?.framing), previous: norm(previousShot?.camera_framing || previousShot?.composition || previousShot?.framing) },
    { key: 'camera_angle', current: norm(currentShot?.camera_angle), previous: norm(previousShot?.camera_angle) },
    { key: 'time_of_day', current: norm(currentShot?.time_of_day), previous: norm(previousShot?.time_of_day) },
    { key: 'lighting', current: norm(currentShot?.lighting), previous: norm(previousShot?.lighting) },
    { key: 'props', current: norm(currentShot?.props || currentShot?.sfx_vfx || currentShot?.art_direction), previous: norm(previousShot?.props || previousShot?.sfx_vfx || previousShot?.art_direction) },
  ];

  const changed = comparePairs
    .filter((row) => row.current !== row.previous)
    .map((row) => row.key);

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
      similarity_score: 0,
      overlap_score: 0,
      requires_substantive_change: false,
      has_substantive_change: true,
      pass: true,
      fail_reasons: [],
      delta: shotDelta,
    };
  }

  const currentTokens = tokenize(currentPrompt);
  const previousTokens = tokenize(previousPrompt);
  const similarity = jaccard(currentTokens, previousTokens);

  const overlap = jaccard(
    tokenize(currentPrompt.slice(0, 400)),
    tokenize(previousPrompt.slice(0, 400)),
  );

  const requiresChange = shotDelta.changed_fields.length > 0;
  const hasSubstantiveChange = similarity < 0.9 || overlap < 0.92;
  const failReasons: string[] = [];

  if (requiresChange && !hasSubstantiveChange) {
    failReasons.push('shot fields changed but prompts remain highly similar');
  }
  if (requiresChange && similarity >= 0.94) {
    failReasons.push('prompt similarity too high for changed shot semantics');
  }

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

export function buildShotImagePrompt(input: ShotPromptCompilerInput): CompiledShotPrompt {
  const shot = input.shot || {};
  const scene = input.scene || {};
  const styleBible = input.styleBible || {};

  const sceneId = String(shot.scene_id || scene.scene_id || '');
  const shotId = String(shot.shot_id || '');

  const sceneSummary = getField(shot, scene, ['scene_summary', 'scene_synopsis', 'synopsis', 'visual_description'], 'Cinematic narrative beat');
  const shotDescription = getField(shot, scene, ['shot_description', 'visual_description', 'action'], 'Character beat in motion');
  const location = getField(shot, scene, ['location', 'scene_setting'], 'Unknown location');
  const timeOfDay = getField(shot, scene, ['time_of_day'], 'unspecified time');
  const action = getField(shot, scene, ['action'], shotDescription);
  const emotion = getField(shot, scene, ['emotion', 'mood', 'emotional_beat'], 'cinematic tension');
  const cameraFraming = getField(shot, scene, ['camera_framing', 'composition', 'framing'], 'balanced framing');
  const cameraAngle = getField(shot, scene, ['camera_angle'], 'medium');
  const lensStyle = getField(shot, scene, ['lens_style', 'lens', 'lens_hint'], styleBible?.lens_language || '35mm cinematic');
  const lighting = getField(shot, scene, ['lighting'], styleBible?.lighting || 'motivated cinematic lighting');
  const continuityConstraints = getField(shot, scene, ['continuity_constraints', 'continuity_notes', 'continuity_from_previous'], 'preserve character identity, wardrobe, and key props');
  const negativeConstraints = getField(shot, scene, ['negative_constraints', 'negative_prompt'], 'duplicate framing, wrong character, identity drift, extra limbs, text watermark');
  const characters = Array.isArray(shot.characters) ? shot.characters.map((c: any) => String(c).trim()).filter(Boolean) : [];

  const storyBlock = [
    `Scene summary: ${sceneSummary}`,
    `Shot description: ${shotDescription}`,
    `Primary action: ${action}`,
    `Location & time: ${location}, ${timeOfDay}`,
    `Emotion: ${emotion}`,
  ].join('. ');

  const cameraBlock = [
    `Camera framing: ${cameraFraming}`,
    `Camera angle: ${cameraAngle}`,
    `Lens style: ${lensStyle}`,
    `Lighting: ${lighting}`,
  ].join('. ');

  const continuityNotes = [
    continuityConstraints,
    input.characterAnchor ? `Character identity anchor: ${input.characterAnchor}` : '',
    characters.length ? `Characters in shot: ${characters.join(', ')}` : 'No visible character required if shot is environmental',
    styleBible?.color_palette ? `Style palette lock: ${styleBible.color_palette}` : '',
    styleBible?.lens_language ? `Style lens language: ${styleBible.lens_language}` : '',
  ].filter(Boolean);

  const technicalPolish = [
    'Cinematic still frame, high detail, physically plausible lighting',
    'Maintain continuity but prioritize current shot semantics over global template reuse',
  ].join('. ');

  const modelPrompt = [
    storyBlock,
    cameraBlock,
    `Continuity constraints: ${continuityNotes.join(' | ')}`,
    `Style bible (secondary constraint): ${input.styleLabel || styleBible?.color_palette || 'cinematic realism'}`,
    technicalPolish,
  ].join('. ');

  const userReadablePrompt = [
    `🎬 ${shotDescription}`,
    `📍 ${location} · ${timeOfDay}`,
    `🎭 ${emotion}`,
    `📷 ${cameraAngle} / ${cameraFraming}`,
    `🔦 ${lighting}`,
  ].join('\n');

  const negativePrompt = [
    negativeConstraints,
    'same composition as previous shot when shot context changed',
    'identity drift, wrong outfit, wrong props, duplicate frame',
  ].join(', ');

  const shotDelta = getShotDelta(shot, input.previousShot);
  const varianceReport = validateShotPromptVariance(modelPrompt, input.previousPrompt, shotDelta);

  return {
    shot_id: shotId,
    scene_id: sceneId,
    shot_summary: `${shotDescription} @ ${location} (${timeOfDay})`,
    user_readable_prompt: userReadablePrompt,
    model_prompt: modelPrompt,
    negative_prompt: negativePrompt,
    continuity_notes: continuityNotes,
    variance_report: varianceReport,
    generation_payload: {
      prompt: modelPrompt,
      negative_prompt: negativePrompt,
      reference_policy: String(shot.reference_policy || 'anchor'),
      continuity_notes: continuityNotes,
    },
  };
}

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
