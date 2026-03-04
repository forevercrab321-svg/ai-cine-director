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
  audioPrompt?: string;  // 音频描述
  [key: string]: any;
}

function buildVideoInput(modelType: VideoModel, prompt: string, imageUrl: string, options: VideoOptions = {}, promptEngineVersion?: 'v1' | 'v2'): Record<string, any> {
  // ★ 角色一致性：最高优先级指令 — 放在 prompt 最前面，模型优先读取
  const CONSISTENCY_CORE = "CRITICAL: The generated video MUST maintain 100% visual consistency with the input image. The character's face, hair color, skin tone, body proportions, clothing, and art style must remain IDENTICAL in every single frame. Do NOT alter, morph, or replace any character. Smooth natural motion only.";

  let finalPrompt = prompt;
  // PROMPT ENGINE VERSION SWITCH
  const version = promptEngineVersion || (typeof process !== 'undefined' && process.env && process.env.PROMPT_ENGINE_VERSION) || 'v1';
  if (version === 'v2') {
    // v2: use Director Prompt Engine
    finalPrompt = buildVideoPrompt({ scene_text: prompt }, (options && typeof options === 'object' ? options : {}) as any);
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
      console.log(`[PromptEngine] Using v2, prompt:`, finalPrompt.slice(0, 500));
    }
  } else {
    // v1: legacy — 把一致性指令焊在 prompt 最前方
    finalPrompt = `${CONSISTENCY_CORE} ${prompt}`;
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
      console.log(`[PromptEngine] Using v1, prompt:`, finalPrompt.slice(0, 500));
    }
  }
  const duration = options.duration || 6;
  const aspectRatio = options.aspectRatio || '16:9';
  const audioPrompt = options.audioPrompt || '';  // 获取音频描述

  // ★ 每个模型的参数和一致性策略都不同，必须分别处理
  switch (modelType) {
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
      const hailuoInput: any = { prompt: finalPrompt, first_frame_image: imageUrl, duration, resolution: "512P", aspect_ratio: aspectRatio, prompt_optimizer: false, seed: 142857 };
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
      return { prompt: finalPrompt, image: imageUrl, duration, cfg_scale: 0.5, seed: 142857 };
    case 'kling_2_1':
      // Kling 2.1: 稳定版
      return { prompt: finalPrompt, image: imageUrl, duration, cfg_scale: 0.5, seed: 142857 };
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
  // ★ 角色锚点放在 prompt 末尾作为"加固指令"，buildVideoInput 会在前方插入一致性核心指令
  // 结构: [CONSISTENCY_CORE] [scene action] [character anchor constraint]
  const finalPrompt = characterAnchor
    ? `${prompt}. Character identity lock: ${characterAnchor}`
    : prompt;

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
