// ═══════════════════════════════════════════════════════════════
// replicateService.ts — Enhanced with Real Face-Cloning (InstantID/Face-Adapter)
// ═══════════════════════════════════════════════════════════════
import { VideoStyle, ImageModel, AspectRatio, GenerationMode, VideoQuality, VideoDuration, VideoFps, VideoResolution, VideoModel, REPLICATE_MODEL_PATHS } from '../types';
import { buildVideoPrompt } from '../lib/promptEngine/promptEngine';
import { classifyShotIntent, getRoutingRules } from '../lib/promptEngine/entityRouter';
import { supabase } from '../lib/supabaseClient';

export interface ReplicateResponse {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: any;
  error?: string;
  logs?: string;
}

interface ApiServiceError extends Error {
  status?: number;
  code?: string;
  retryAfter?: number;
  details?: any;
}

const extractRetryAfter = (source: any): number | undefined => {
  const v = source?.retry_after ?? source?.retryAfter;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const toServiceError = async (response: Response, fallbackMessage: string): Promise<ApiServiceError> => {
  const ct = response.headers.get('content-type') || '';
  let raw = '';
  let payload: any = null;

  try {
    if (ct.includes('application/json')) {
      payload = await response.json();
    } else {
      raw = await response.text();
      try { payload = JSON.parse(raw); } catch { payload = null; }
    }
  } catch {
    // ignore parse error
  }

  const retryAfter = extractRetryAfter(payload) || extractRetryAfter(payload?.detail);
  const serverMsg = payload?.error || payload?.message || payload?.detail?.message || raw;
  const isRateLimited = response.status === 429 || /throttle|rate\s*limit|too many/i.test(String(serverMsg || ''));

  const finalMsg = isRateLimited
    ? `请求过于频繁，已触发限流。${retryAfter ? `请在 ${retryAfter} 秒后重试。` : '请稍后重试。'}`
    : (String(serverMsg || fallbackMessage));

  const err = new Error(finalMsg) as ApiServiceError;
  err.status = response.status;
  err.code = payload?.code || (isRateLimited ? 'RATE_LIMITED' : undefined);
  err.retryAfter = retryAfter;
  err.details = payload?.detail || payload;
  return err;
};

export const extractLastFrameWithFallback = async (videoUrl: string): Promise<string> => {
  try {
    const { extractLastFrameFromVideo } = await import('../utils/video-helpers');
    return await extractLastFrameFromVideo(videoUrl);
  } catch (err: any) {
    console.warn('[extractLastFrameWithFallback] Local extraction failed (CORS/memory). Falling back to server...', err);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/extract-frame', {
        method: 'POST',
        headers,
        body: JSON.stringify({ videoUrl })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      // ★ Backend returns { frame: "data:image/jpeg;base64,..." } — already a complete data URL
      if (!data.frame) throw new Error('No frame returned from server');
      return data.frame;
    } catch (serverErr: any) {
      console.error('[extractLastFrameWithFallback] Server fallback also failed:', serverErr);
      throw new Error(`Failed to extract frame: ${err.message} -> ${serverErr.message}`);
    }
  }
};

const API_BASE = '/api/replicate';

// Helper: Get Auth Token
const getAuthHeaders = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("请先登录以生成内容。");
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`
  };
};

const getConfig = () => {
  if (typeof window === 'undefined') return { useMockMode: false };
  try {
    const saved = localStorage.getItem('app_settings');
    if (!saved) return { useMockMode: false };
    const parsed = JSON.parse(saved);
    return { useMockMode: parsed.useMockMode ?? false };
  } catch {
    // ★ Guard against corrupted/stale localStorage data from schema migrations
    console.warn('[replicateService] Failed to parse app_settings from localStorage, using defaults');
    return { useMockMode: false };
  }
};

// 使用types.ts中的统一模型路径映射
const REPLICATE_MODEL_MAP = REPLICATE_MODEL_PATHS;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const isNsfwError = (text: string) => /nsfw|safety|moderation|content policy/i.test(text || '');

const sanitizePromptForSafety = (prompt: string) => {
  // Reduce false positives for myth/action scenes while preserving visual intent
  return prompt
    .replace(/\b(kill|killing|blood|bloody|gore|gory|brutal|weapon|sword|spear|fight|battle|war)\b/gi, 'cinematic')
    .replace(/大战|战斗|厮杀|杀戮|血腥|武器|长矛|刀剑/g, '史诗对峙')
    .concat(' Family-friendly cinematic scene, no gore, no violence, no explicit content.');
};

// ★ STYLE_PRESETS — canonical definition is in types.ts (StylePreset[]).
// Removed duplicate Record<string, string> that was out of sync.

/**
 * generateImage - Enhanced with Real Face-Cloning
 * @param prompt — 画面内容的文字描述
 * @param visualStyle — 风格预设
 * @param aspectRatio — 比例
 */
export const generateImage = async (
  prompt: string,
  imageModel: string,
  visualStyle: string,
  aspectRatio: string = "16:9",
  characterAnchor: string = "",
  referenceImageBase64?: string | null,
  storyEntities?: any[]
): Promise<string> => {
  try {
    const headers = await getAuthHeaders();

    const response = await fetch(`${API_BASE}/generate-image`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt,
        imageModel,
        visualStyle,
        aspectRatio,
        characterAnchor,
        referenceImageDataUrl: referenceImageBase64,
        storyEntities
      })
    });

    if (response.status === 402) {
      const data = await response.json();
      const error: any = new Error("INSUFFICIENT_CREDITS");
      error.code = "INSUFFICIENT_CREDITS";
      error.details = data;
      throw error;
    }

    if (!response.ok) {
      throw await toServiceError(response, `Generate image failed (${response.status})`);
    }

    const data = await response.json();
    return data.url;
  } catch (error: any) {
    console.error("[replicateService] GenerateImage Error:", error);
    throw error;
  }
};

interface VideoOptions {
  duration?: number;  // 4, 6, 8 秒
  aspectRatio?: string;  // "16:9" | "9:16"
  audioPrompt?: string;  // 音频描述
  generationMode?: GenerationMode;
  anchorPackage?: any;
  [key: string]: any;
}

function buildVideoInput(modelType: VideoModel, prompt: string, imageUrl: string, options: VideoOptions = {}, promptEngineVersion?: 'v1' | 'v2'): Record<string, any> {
  // 从options获取角色锚点
  const characterAnchor = options.characterAnchor || '';
  const startImageUrl = imageUrl;

  let finalPrompt = prompt;
  // PROMPT ENGINE VERSION SWITCH
  const version = promptEngineVersion || (typeof process !== 'undefined' && process.env && process.env.PROMPT_ENGINE_VERSION) || 'v1';
  if (version === 'v2') {
    // v2: use Director Prompt Engine
    finalPrompt = buildVideoPrompt({
      scene_text: prompt,
      anchorPackage: options.anchorPackage
    }, {
      ...options,
      generationMode: options.generationMode
    } as any);
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
      console.log(`[PromptEngine] Using v2, prompt:`, finalPrompt.slice(0, 500));
    }
  } else {
    // v1: legacy — Clean pass-through
    // In V1, startVideoTask already appended the characterAnchor gracefully. 
    // We just pass it through without ruining the model's logic with ALL CAPS instructions.
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
      console.log(`[PromptEngine] Using v1 (clean pass-through), prompt:`, finalPrompt.slice(0, 500));
    }
  }
  // ★ 修复: 确保 duration 只能是 6 或 10 (Replicate API 要求)
  // 如果用户选择了 4/5/8 秒，自动转换为 6/10 秒
  let safeDuration = options.duration || 6;
  if (safeDuration !== 6 && safeDuration !== 10) {
    safeDuration = safeDuration >= 8 ? 10 : 6;
    console.log(`[Replicate] Duration corrected from ${options.duration} to ${safeDuration}`);
  }
  const duration = safeDuration;
  const aspectRatio = options.aspectRatio || '16:9';
  const audioPrompt = options.audioPrompt || '';  // 获取音频描述

  // ★ 每个模型的参数和一致性策略都不同，必须分别处理
  switch (modelType as string) {
    // ★ Top 5 性价比模型
    case 'wan_2_2_fast':
      // Wan: I2V 原生支持，image 参数是首帧
      return { prompt: finalPrompt, image: imageUrl, prompt_optimizer: false, seed: 142857 };
    case 'wan_2_2_t2v':
      // Wan T2V: 文本转视频
      return { prompt: finalPrompt, prompt_optimizer: false, seed: 142857 };
    case 'runway_gen4_turbo':
      // Runway Gen-4 Turbo: 极速生成
      return { prompt: finalPrompt, image: imageUrl, num_frames: duration * 24, seed: 142857 };
    case 'hailuo_02_fast':
      // Hailuo-02: 使用 first_frame_image，支持音频生成
      // ★ Safety: Hailuo strictly requires duration to be 6 or 10
      const safeDuration = duration >= 8 ? 10 : 6;
      const hailuoInput: any = { prompt: finalPrompt, first_frame_image: imageUrl, duration: safeDuration, resolution: "512P", aspect_ratio: aspectRatio, prompt_optimizer: false, seed: 142857 };
      // 如果有音频描述，添加到输入中（MiniMax Hailuo支持audio参数）
      if (audioPrompt) {
        hailuoInput.audio_prompt = audioPrompt;
      }
      return hailuoInput;
    case 'seedance_pro':
      // Seedance Pro: 支持首帧尾帧链接
      return { prompt: finalPrompt, image: imageUrl, duration, resolution: "720p", seed: 142857 };

    // 其他模型
    case 'kling_2_5_pro':
      // Kling 2.5 Pro: 高质量 I2V，cfg_scale 控制与首帧的贴合度
      // ★ Safety: Kling strictly requires duration to be 5 or 10
      const klingDuration = duration >= 8 ? 10 : 5;
      return { prompt: finalPrompt, image: imageUrl, duration: klingDuration, cfg_scale: 0.5, seed: 142857 };
    case 'kling_2_1':
      // Kling 2.1: 稳定版
      const kling21Duration = duration >= 8 ? 10 : 5;
      return { prompt: finalPrompt, image: imageUrl, duration: kling21Duration, cfg_scale: 0.5, seed: 142857 };
    case 'pixverse_v4_5':
      // Pixverse v4.5: 多风格
      return { prompt: finalPrompt, image: imageUrl, duration, seed: 142857 };
    case 'luma_ray2_flash':
      // Luma Ray2 Flash: 快速精确
      return { prompt: finalPrompt, image: imageUrl, duration, seed: 142857 };
    case 'veo_3_fast':
      // Google Veo 3 Fast: 最高质量 + 原生音频
      return { prompt: finalPrompt, image: imageUrl, duration, generate_audio: true, seed: 142857 };
    case 'veo_3':
      // Google Veo 3: 最高质量 + 原生音频
      return { prompt: finalPrompt, image: imageUrl, duration, generate_audio: true, seed: 142857 };
    case 'google_gemini_nano_banana':
      return { prompt: finalPrompt, first_frame_image: imageUrl, prompt_optimizer: false, seed: 142857 };
    default:
      return { prompt: finalPrompt, first_frame_image: imageUrl, prompt_optimizer: false, seed: 142857 };
  }
}

export const startVideoTask = async (
  prompt: string,
  startImageUrl: string,
  modelType: VideoModel,
  videoStyle: VideoStyle,
  generationMode: GenerationMode,
  quality: VideoQuality,
  duration: VideoDuration,
  fps: VideoFps,
  resolution: VideoResolution,
  characterAnchor?: string,
  aspectRatio?: string,
  promptOptions?: any,
  promptEngineVersion?: 'v1' | 'v2'
): Promise<ReplicateResponse> => {
  // ★ Clean, Narrative-First Video Prompts
  // Video models perform best when they receive a clean, descriptive narrative of the action.
  // We append the character anchor gracefully at the end, but strictly enforce 3D and motion consistency.
  // ★ Intent Routing & Anchor Gating
  const { intent, presence } = classifyShotIntent(prompt);
  const routing = getRoutingRules(intent, presence, promptOptions?.contains_character);

  // CRITICAL FIX: If routing says no cast anchor allowed, strictly strip it out.
  let activeCharacterAnchor = characterAnchor;
  let activeStoryEntities = Array.isArray(promptOptions?.storyEntities)
    ? promptOptions.storyEntities.filter((e: any) => e?.is_locked)
    : [];

  if (!routing.allowCastAnchor) {
    activeCharacterAnchor = undefined;

    // Also strip out any story entity that is a 'character'
    activeStoryEntities = activeStoryEntities.filter((e: any) => String(e?.type || '').toLowerCase() !== 'character');

    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
      console.log(`[EntityRouter] 🚫 Blocked cast anchor leakage for ${intent} shot.`);
    }
  }

  let finalPrompt = prompt;

  let entityRules = '';
  if (activeStoryEntities.length > 0) {
    const lockedEntities = activeStoryEntities;
    if (lockedEntities.length > 0) {
      entityRules = lockedEntities.map((e: any) => `[${e.type.toUpperCase()}: ${e.name}] ${e.description}`).join(' | ');
      finalPrompt = `${prompt}. [IDENTITY LOCK] Ensure the following entities appear exactly as described: ${entityRules}. Critically important: Maintain exact features and clothing strictly consistent throughout the entire motion.`;
    }
  }

  const lockedCastLine = activeStoryEntities
    .filter((e: any) => String(e?.type || '').toLowerCase() === 'character')
    .map((e: any) => `${e.name}: ${e.description}`)
    .join(' | ');
  if (lockedCastLine) {
    finalPrompt = `${finalPrompt}. [CAST LOCK - MUST FOLLOW EXACTLY] Start Cast Bible: ${lockedCastLine}. Every generated frame must match these cast identities exactly. No face drift, no costume drift, no replacement actors.`;
  }

  // Full anchor constraint injection:
  if (generationMode === 'strict_reference' && promptOptions?.anchorPackage) {
    // We do not append the default IDENTITY LOCK because the anchor package handles it densely in v2 prompt engine.
    finalPrompt = `${prompt}. [SUPER STRICT ANCHOR LOCK] Animate this exact frame. Do not redesign the subject, environment, composition, architecture, camera angle, or time of day. Preserve the visual identity of the image. Only introduce motion consistent with this exact frame.`;
  } else {
    // Fallback to legacy character anchor if no entity rules exist
    if (activeCharacterAnchor && !entityRules) {
      // Add strong continuous consistency constraint, specifically targeting head turns
      finalPrompt = `${finalPrompt}. Character Identity: ${activeCharacterAnchor}. Critically important: Maintain the exact same facial features, identity, and clothing strictly consistent throughout the entire motion, regardless of angle changes or head turns.`;
    }

    // Universal frame-identity lock only if characters are allowed
    if (routing.allowCastAnchor) {
      finalPrompt = `${finalPrompt}. [FRAME LOCK] The subject in the provided first-frame image must remain the exact same person in every frame. Do not change facial structure, hairstyle, age, skin tone, outfit, jewelry, or accessories. Preserve identity and costume continuity absolutely.`;
    }
  }

  let modelIdentifier = modelType.includes('/')
    ? modelType
    : (REPLICATE_MODEL_MAP[modelType] || REPLICATE_MODEL_MAP['hailuo_02_fast']);

  const headers = await getAuthHeaders();

  const videoOptions: VideoOptions = {
    duration: duration,
    aspectRatio: aspectRatio || '16:9',
    generationMode: generationMode,
    anchorPackage: promptOptions?.anchorPackage,
    ...(promptOptions || {})
  };

  const response = await fetch(`${API_BASE}/predict`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      version: modelIdentifier,
      input: buildVideoInput(modelType, finalPrompt, startImageUrl, videoOptions, promptEngineVersion),
      storyEntities: activeStoryEntities,
      continuity: promptOptions?.continuity,
      project_id: promptOptions?.project_id,
      shot_id: promptOptions?.shot_id,
    })
  });

  if (response.status === 402) {
    const data = await response.json();
    const error: any = new Error("INSUFFICIENT_CREDITS");
    error.code = "INSUFFICIENT_CREDITS";
    error.details = data;
    throw error;
  }

  if (!response.ok) {
    throw await toServiceError(response, `HTTP ${response.status}`);
  }

  return await response.json();
};

export async function checkPredictionStatus(id: string): Promise<ReplicateResponse> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE}/status/${id}`, {
    method: 'GET',
    headers
  });

  if (!response.ok) {
    throw await toServiceError(response, `HTTP ${response.status}`);
  }

  return await response.json();
}
