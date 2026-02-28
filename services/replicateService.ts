// ═══════════════════════════════════════════════════════════════
// replicateService.ts — Enhanced with Real Face-Cloning (InstantID/Face-Adapter)
// ═══════════════════════════════════════════════════════════════
import { VideoStyle, ImageModel, AspectRatio, GenerationMode, VideoQuality, VideoDuration, VideoFps, VideoResolution, VideoModel, REPLICATE_MODEL_PATHS } from '../types';
import { buildVideoPrompt } from '../lib/promptEngine/promptEngine';
import { supabase } from '../lib/supabaseClient';

export interface ReplicateResponse {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: any;
  error?: string;
  logs?: string;
}

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
  if (typeof window === 'undefined') return { useMockMode: false }; // Default to real in prod/dev if backend ready
  const saved = localStorage.getItem('app_settings');
  if (!saved) return { useMockMode: false }; // Default false to enforce credit check
  const parsed = JSON.parse(saved);
  return { useMockMode: parsed.useMockMode ?? false };
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

// 风格预设
export const STYLE_PRESETS: Record<string, string> = {
  cinematic: "cinematic film still, shallow depth of field, color graded, highly detailed",
  anime: "anime style, vibrant colors, detailed line art, studio Ghibli aesthetic",
  pixar: "3d render, Pixar style, cute, cartoon character, expressive, subsurface scattering",
  cyberpunk: "cyberpunk aesthetic, neon lights, retro-futuristic, rain, detailed, dark atmosphere",
};

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
  referenceImageBase64?: string | null
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
      const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(errData.error || `Generate image failed (${response.status})`);
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
  [key: string]: any;
}

function buildVideoInput(modelType: VideoModel, prompt: string, imageUrl: string, options: VideoOptions = {}, promptEngineVersion?: 'v1' | 'v2'): Record<string, any> {
  const STRICT_CONSISTENCY = "Strict visual consistency with the input image. Do NOT change the character's face, hair, skin tone, costume, or art style. The character must remain IDENTICAL across all frames. Maintain exact same proportions and appearance. Smooth natural motion only.";
  let finalPrompt = prompt;
  // PROMPT ENGINE VERSION SWITCH
  const version = promptEngineVersion || (typeof process !== 'undefined' && process.env && process.env.PROMPT_ENGINE_VERSION) || 'v1';
  if (version === 'v2') {
    // v2: use Director Prompt Engine
    finalPrompt = buildVideoPrompt({ scene_text: prompt }, (options && typeof options === 'object' ? options : {}) as any);
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
      // 开发环境日志
      console.log(`[PromptEngine] Using v2, prompt:`, finalPrompt.slice(0, 500));
    }
  } else {
    // v1: legacy
    finalPrompt = `${STRICT_CONSISTENCY} ${prompt}`;
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
      console.log(`[PromptEngine] Using v1, prompt:`, finalPrompt.slice(0, 500));
    }
  }
  const duration = options.duration || 6;
  const aspectRatio = options.aspectRatio || '16:9';

  switch (modelType) {
    case 'wan_2_2_fast':
      return { prompt: finalPrompt, image: imageUrl, prompt_optimizer: true, seed: 142857 };
    case 'hailuo_02_fast':
      return { prompt: finalPrompt, first_frame_image: imageUrl, duration, resolution: "512P", aspect_ratio: aspectRatio, prompt_optimizer: true, seed: 142857 };
    case 'seedance_lite':
      return { prompt: finalPrompt, image: imageUrl, duration, resolution: "720p", seed: 142857 };
    case 'kling_2_5':
      return { prompt: finalPrompt, image: imageUrl, duration, cfg_scale: 0.8, seed: 142857 };
    case 'hailuo_live':
      return { prompt: finalPrompt, first_frame_image: imageUrl, prompt_optimizer: true, seed: 142857 };
    case 'google_gemini_nano_banana':
      return { prompt: finalPrompt, first_frame_image: imageUrl, prompt_optimizer: true, seed: 142857 };
    default:
      return { prompt: finalPrompt, first_frame_image: imageUrl, prompt_optimizer: true, seed: 142857 };
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
  const finalPrompt = characterAnchor ? `${characterAnchor}, ${prompt}` : prompt;

  let modelIdentifier = modelType.includes('/')
    ? modelType
    : (REPLICATE_MODEL_MAP[modelType] || REPLICATE_MODEL_MAP['hailuo_02_fast']);

  const headers = await getAuthHeaders();

  const videoOptions: VideoOptions = {
    duration: duration,
    aspectRatio: aspectRatio || '16:9',
    ...(promptOptions || {})
  };

  const response = await fetch(`${API_BASE}/predict`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      version: modelIdentifier,
      input: buildVideoInput(modelType, finalPrompt, startImageUrl, videoOptions, promptEngineVersion)
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
    const errText = await response.text();
    throw new Error(errText || `HTTP ${response.status}`);
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
    throw new Error(`HTTP ${response.status}`);
  }

  return await response.json();
}
