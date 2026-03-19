export type ContinuityStrictness = 'low' | 'medium' | 'high';

export interface CharacterBible {
  character_id: string;
  name: string;
  face_traits?: string;
  age?: string;
  body_type?: string;
  skin_tone?: string;
  eye_shape?: string;
  nose_lips?: string;
  hair?: string;
  signature_accessories?: string;
  outfit?: string;
  props?: string;
}

export interface StyleBible {
  realism_level?: string;
  lens_language?: string;
  color_palette?: string;
  mood?: string;
  lighting?: string;
  rendering_style?: string;
}

export interface SceneContinuityMemory {
  scene_id?: string;
  scene_number?: number;
  environment?: string;
  time_of_day?: string;
  weather_atmosphere?: string;
  lighting?: string;
  active_costume?: string;
  prop_state?: string;
}

export interface ContinuityConfig {
  strictness?: ContinuityStrictness;
  lockCharacter?: boolean;
  lockStyle?: boolean;
  lockCostume?: boolean;
  lockScene?: boolean;
  usePreviousApprovedAsReference?: boolean;
  character_bible?: CharacterBible;
  style_bible?: StyleBible;
  scene_memory?: SceneContinuityMemory;
  project_context?: {
    project_id?: string;
    visual_style?: string;
    character_anchor?: string;
    story_entities?: Array<{ type?: string; name?: string; description?: string; is_locked?: boolean }>;
  };
}

export interface ContinuityProfile {
  strictness: ContinuityStrictness;
  lockCharacter: boolean;
  lockStyle: boolean;
  lockCostume: boolean;
  lockScene: boolean;
  usePreviousApprovedAsReference: boolean;
  characterBible: CharacterBible;
  styleBible: StyleBible;
  sceneMemory: SceneContinuityMemory;
  lockedCastLine: string;
  identityAnchorLine: string;
}

export interface ContinuityScore {
  identity: number;
  style: number;
  costume: number;
  prop: number;
  scene: number;
  overall: number;
  failures: string[];
}

export interface ApprovedFrame {
  shotId: string;
  sceneId?: string;
  sceneNumber?: number;
  shotNumber?: number;
  imageUrl: string;
  prompt: string;
  createdAt: number;
}

const STYLE_FORBIDDEN = /\banime\b|\billustration\b|\btoon\b|\bcel\s*shaded\b|\b2d\b|\bmanga\b/i;
const REALISM_REQUIRED = /cinematic|live-action|photoreal|realistic|film|35mm|arri|color grading/i;

const projectFrames = new Map<string, {
  hero?: ApprovedFrame;
  costume?: ApprovedFrame;
  prop?: ApprovedFrame;
  byShot: Map<string, ApprovedFrame>;
  ordered: ApprovedFrame[];
}>();

const normalize = (s?: string) => String(s || '').replace(/\s+/g, ' ').trim();

const pick = (...vals: Array<string | undefined>) => vals.find((v) => normalize(v).length > 0) || '';

const keywordPresence = (text: string, keywords: string[]): number => {
  if (!keywords.length) return 1;
  const t = text.toLowerCase();
  const found = keywords.filter((k) => t.includes(k.toLowerCase()));
  return found.length / keywords.length;
};

function tokenizeCritical(value?: string): string[] {
  const raw = normalize(value).toLowerCase();
  if (!raw) return [];
  return Array.from(new Set(raw
    .split(/[,;|]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/^(a|an|the)\s+/i, ''))
    .filter((x) => x.length > 2)
    .slice(0, 12)));
}

function buildLockedCastLine(storyEntities?: ContinuityConfig['project_context']['story_entities']): string {
  if (!Array.isArray(storyEntities)) return '';
  const chars = storyEntities
    .filter((e) => String(e?.type || '').toLowerCase() === 'character' && !!e?.is_locked)
    .map((e) => `${normalize(e?.name) || 'Character'}: ${normalize(e?.description)}`)
    .filter((s) => s.length > 0);
  return chars.join(' | ');
}

export function buildContinuityProfile(config: ContinuityConfig | undefined, fallback: {
  characterAnchor?: string;
  visualStyle?: string;
  sceneMemory?: SceneContinuityMemory;
} = {}): ContinuityProfile {
  const strictness = config?.strictness || 'high';
  const lockCharacter = config?.lockCharacter !== false;
  const lockStyle = config?.lockStyle !== false;
  const lockCostume = config?.lockCostume !== false;
  const lockScene = config?.lockScene !== false;
  const usePreviousApprovedAsReference = config?.usePreviousApprovedAsReference !== false;

  const characterAnchor = pick(config?.project_context?.character_anchor, fallback.characterAnchor);
  const visualStyle = pick(config?.project_context?.visual_style, fallback.visualStyle);

  const characterBible: CharacterBible = {
    character_id: pick(config?.character_bible?.character_id, characterAnchor),
    name: pick(config?.character_bible?.name, 'Main Character'),
    face_traits: pick(config?.character_bible?.face_traits, characterAnchor),
    age: config?.character_bible?.age || '',
    skin_tone: config?.character_bible?.skin_tone || '',
    eye_shape: config?.character_bible?.eye_shape || '',
    nose_lips: config?.character_bible?.nose_lips || '',
    hair: config?.character_bible?.hair || '',
    signature_accessories: config?.character_bible?.signature_accessories || '',
    outfit: config?.character_bible?.outfit || '',
    props: config?.character_bible?.props || '',
  };

  const styleBible: StyleBible = {
    realism_level: pick(config?.style_bible?.realism_level, 'cinematic live-action photorealistic'),
    lens_language: pick(config?.style_bible?.lens_language, '35mm cinematic lens look'),
    color_palette: pick(config?.style_bible?.color_palette, visualStyle),
    mood: pick(config?.style_bible?.mood, 'elegant cinematic'),
    lighting: pick(config?.style_bible?.lighting, 'consistent lighting and color grading'),
    rendering_style: pick(config?.style_bible?.rendering_style, 'live-action cinematic realism'),
  };

  const sceneMemory: SceneContinuityMemory = {
    ...fallback.sceneMemory,
    ...(config?.scene_memory || {}),
  };

  const lockedCastLine = buildLockedCastLine(config?.project_context?.story_entities);
  const identityAnchorLine = characterAnchor;

  return {
    strictness,
    lockCharacter,
    lockStyle,
    lockCostume,
    lockScene,
    usePreviousApprovedAsReference,
    characterBible,
    styleBible,
    sceneMemory,
    lockedCastLine,
    identityAnchorLine,
  };
}

export function applyContinuityLocks(basePrompt: string, profile: ContinuityProfile): string {
  const parts: string[] = [normalize(basePrompt)];

  if (profile.lockStyle) {
    parts.push(`[STYLE LOCK] realism=${normalize(profile.styleBible.realism_level)}; rendering=${normalize(profile.styleBible.rendering_style)}; lens=${normalize(profile.styleBible.lens_language)}; palette=${normalize(profile.styleBible.color_palette)}; mood=${normalize(profile.styleBible.mood)}; lighting=${normalize(profile.styleBible.lighting)}.`);
    parts.push('Do not switch to anime, illustration, cartoon, doll-face, painterly, or stylized 2D output. Keep cinematic live-action realism.');
  }

  if (profile.lockCharacter) {
    if (profile.identityAnchorLine) {
      parts.push(`[CHARACTER LOCK] ${profile.identityAnchorLine}`);
    }
    if (profile.lockedCastLine) {
      parts.push(`[LOCKED CAST] ${profile.lockedCastLine}`);
    }
    parts.push('Do not change face identity, age impression, facial structure, eye style, skin tone, hairstyle, or realism level.');
  }

  if (profile.lockCostume) {
    const costumeLine = [
      normalize(profile.characterBible.outfit),
      normalize(profile.characterBible.signature_accessories),
      normalize(profile.characterBible.props),
      normalize(profile.sceneMemory.active_costume),
      normalize(profile.sceneMemory.prop_state),
    ].filter(Boolean).join(' | ');
    if (costumeLine) {
      parts.push(`[COSTUME/PROP LOCK] ${costumeLine}`);
    }
    parts.push('Keep outfit silhouette, accessory family, and prop design language unchanged unless explicitly changed by shot metadata.');
  }

  if (profile.lockScene) {
    const sceneLine = [
      normalize(profile.sceneMemory.environment),
      normalize(profile.sceneMemory.time_of_day),
      normalize(profile.sceneMemory.weather_atmosphere),
      normalize(profile.sceneMemory.lighting),
    ].filter(Boolean).join(' | ');
    if (sceneLine) {
      parts.push(`[SCENE LOCK] ${sceneLine}`);
    }
    parts.push('Do not move into a new environment, weather, or time-of-day unless explicitly instructed in shot metadata.');
  }

  return parts.filter(Boolean).join(' ');
}

export function buildContinuityNegativePrompt(baseNegativePrompt: string | undefined, profile: ContinuityProfile): string {
  const defaults = [
    'identity drift', 'different person', 'face swap', 'age change', 'anime style', 'illustration style', 'cartoon', 'doll face',
    'wardrobe redesign', 'hair ornament change', 'hairstyle change', 'prop redesign', 'sword redesign',
    'background jump', 'lighting jump', 'different environment', 'daylight forest when scene is moonlit night',
  ];
  const merged = `${normalize(baseNegativePrompt)} ${defaults.join(', ')}`;
  if (profile.lockStyle) {
    return `${merged}, avoid stylized render, avoid painterly look, avoid toon shading`;
  }
  return merged;
}

export function scoreContinuityPrompt(prompt: string, profile: ContinuityProfile): ContinuityScore {
  const p = normalize(prompt);
  const lower = p.toLowerCase();
  const failures: string[] = [];

  const identityKeywords = tokenizeCritical([
    profile.identityAnchorLine,
    profile.characterBible.face_traits,
    profile.characterBible.hair,
    profile.characterBible.signature_accessories,
  ].filter(Boolean).join(', '));

  const styleKeywords = tokenizeCritical([
    profile.styleBible.realism_level,
    profile.styleBible.rendering_style,
    profile.styleBible.lens_language,
    profile.styleBible.color_palette,
  ].filter(Boolean).join(', '));

  const costumeKeywords = tokenizeCritical([
    profile.characterBible.outfit,
    profile.characterBible.signature_accessories,
    profile.sceneMemory.active_costume,
  ].filter(Boolean).join(', '));

  const propKeywords = tokenizeCritical([
    profile.characterBible.props,
    profile.sceneMemory.prop_state,
  ].filter(Boolean).join(', '));

  const sceneKeywords = tokenizeCritical([
    profile.sceneMemory.environment,
    profile.sceneMemory.time_of_day,
    profile.sceneMemory.weather_atmosphere,
    profile.sceneMemory.lighting,
  ].filter(Boolean).join(', '));

  let identity = keywordPresence(lower, identityKeywords);
  let style = keywordPresence(lower, styleKeywords);
  let costume = keywordPresence(lower, costumeKeywords);
  let prop = keywordPresence(lower, propKeywords);
  let scene = keywordPresence(lower, sceneKeywords);

  if (profile.lockStyle && STYLE_FORBIDDEN.test(lower)) {
    style = Math.max(0, style - 0.6);
    failures.push('style_drift_keywords_detected');
  }
  if (profile.lockStyle && !REALISM_REQUIRED.test(lower)) {
    style = Math.max(0, style - 0.3);
    failures.push('missing_realism_cues');
  }

  if (profile.lockCharacter && identity < 0.45) failures.push('identity_keywords_missing');
  if (profile.lockStyle && style < 0.45) failures.push('style_keywords_missing');
  if (profile.lockCostume && costume < 0.4) failures.push('costume_keywords_missing');
  if (profile.lockCostume && prop < 0.35) failures.push('prop_keywords_missing');
  if (profile.lockScene && scene < 0.4) failures.push('scene_keywords_missing');

  const overall = (identity * 0.35) + (style * 0.25) + (costume * 0.15) + (prop * 0.1) + (scene * 0.15);
  return { identity, style, costume, prop, scene, overall, failures };
}

export function continuityThreshold(strictness: ContinuityStrictness): number {
  if (strictness === 'low') return 0.45;
  if (strictness === 'medium') return 0.62;
  return 0.75;
}

export function strengthenPromptForRetry(prompt: string, profile: ContinuityProfile, attempt: number, failures: string[]): string {
  const enforcement = [
    `[CONTINUITY RETRY ${attempt}]`,
    'Hard enforce: exact same protagonist identity, costume, accessories, sword design, scene environment, and cinematic realism.',
    failures.length ? `Previous failure signals: ${failures.join(', ')}` : '',
    profile.lockScene ? 'Preserve same moonlit/night lighting and environment continuity if scene metadata is unchanged.' : '',
  ].filter(Boolean).join(' ');
  return `${prompt} ${enforcement}`;
}

export function registerApprovedFrame(projectId: string, frame: ApprovedFrame) {
  if (!projectId) return;
  const state = projectFrames.get(projectId) || { byShot: new Map<string, ApprovedFrame>(), ordered: [] as ApprovedFrame[] };
  state.byShot.set(frame.shotId, frame);
  state.ordered.push(frame);
  if (!state.hero) state.hero = frame;
  if (!state.costume) state.costume = frame;
  if (!state.prop) state.prop = frame;
  projectFrames.set(projectId, state);
}

export function getContinuityReference(projectId: string, shotId: string, opts?: { preferPrevious?: boolean }): string | undefined {
  if (!projectId) return undefined;
  const state = projectFrames.get(projectId);
  if (!state) return undefined;
  if (opts?.preferPrevious) {
    const keys = Array.from(state.byShot.keys());
    const idx = keys.findIndex((k) => k === shotId);
    if (idx > 0) {
      const prev = state.byShot.get(keys[idx - 1]);
      if (prev?.imageUrl) return prev.imageUrl;
    }
    const orderedLast = state.ordered[state.ordered.length - 1];
    if (orderedLast?.imageUrl) return orderedLast.imageUrl;
  }
  return state.hero?.imageUrl || state.costume?.imageUrl || state.prop?.imageUrl;
}
