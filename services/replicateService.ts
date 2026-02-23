/**
 * Replicate Service - Client Proxy
 * Forwards requests to backend /api/replicate which handles Auth & Credits
 */
import { VideoStyle, ImageModel, AspectRatio, GenerationMode, VideoQuality, VideoDuration, VideoFps, VideoResolution, VideoModel, REPLICATE_MODEL_PATHS } from '../types';
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

/**
 * Generate Image
 */
export const generateImage = async (
  prompt: string,
  modelType: ImageModel = 'flux',
  videoStyle: VideoStyle = 'none',
  aspectRatio: AspectRatio = '16:9',
  characterAnchor?: string
): Promise<string> => {
  //   const { useMockMode } = getConfig(); // Disabled for robust credit test
  //   if (useMockMode) return generateMockImage(prompt);

  // ★ CHARACTER CONSISTENCY: Single scene with consistent character
  const CONSISTENCY_PREFIX = "[CRITICAL: Single cinematic scene only. NOT a character sheet or reference sheet. Show ONE character in ONE specific action/pose. Maintain exact character identity: same face, same hairstyle, same costume, same body proportions.]";
  const CONSISTENCY_SUFFIX = "[IMPORTANT: This is a SINGLE SCENE from a storyboard, NOT a character design sheet. Show the character in the described action/environment only. Cinematic composition, dynamic angle.]";
  const ANTI_SHEET = "NOT multiple views, NOT character sheet, NOT reference poses, NOT turnaround.";

  const finalPrompt = characterAnchor
    ? `${CONSISTENCY_PREFIX} Character: ${characterAnchor}. Scene: ${prompt}. ${ANTI_SHEET} ${CONSISTENCY_SUFFIX}`
    : `${prompt}. Single cinematic shot, NOT a character sheet.`;

  // Logical Change: If modelType contains '/', treat it as a direct Replicate ID.
  const modelIdentifier = modelType.includes('/')
    ? modelType
    : (REPLICATE_MODEL_MAP[modelType] || REPLICATE_MODEL_MAP['flux']);

  const headers = await getAuthHeaders();

  const sendRequest = async (promptText: string) => {
    return await fetch(`${API_BASE}/predict`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        version: modelIdentifier,
        input: {
          prompt: promptText,
          aspect_ratio: aspectRatio,
          output_format: "jpg",
          seed: 142857
        }
      })
    });
  };

  let response = await sendRequest(finalPrompt);

  if (response.status === 402) {
    const data = await response.json();
    // Throw structured error for UI to catch and show PricingModal
    const error: any = new Error("INSUFFICIENT_CREDITS");
    error.code = "INSUFFICIENT_CREDITS";
    error.details = data; // { available, required }
    throw error;
  }

  if (!response.ok) {
    const errText = await response.text();

    // Auto-retry once with safer wording when moderation falsely blocks myth/action prompts
    if (isNsfwError(errText)) {
      const safePrompt = sanitizePromptForSafety(finalPrompt);
      response = await sendRequest(safePrompt);
      if (!response.ok) {
        const retryErrText = await response.text();

        // Last fallback: try a stricter-safe model once
        if (modelIdentifier !== REPLICATE_MODEL_MAP['flux_schnell']) {
          const fallbackResponse = await fetch(`${API_BASE}/predict`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              version: REPLICATE_MODEL_MAP['flux_schnell'],
              input: {
                prompt: safePrompt,
                aspect_ratio: aspectRatio,
                output_format: "jpg",
                seed: 142857
              }
            })
          });

          if (fallbackResponse.ok) {
            response = fallbackResponse;
          } else {
            const fallbackErrText = await fallbackResponse.text();
            throw new Error(fallbackErrText || retryErrText || errText || `HTTP ${fallbackResponse.status}`);
          }
        } else {
          throw new Error(retryErrText || errText || `HTTP ${response.status}`);
        }
      }
    } else {
      throw new Error(errText || `HTTP ${response.status}`);
    }
  }

  let prediction = await response.json();

  // Poll
  while (['starting', 'processing'].includes(prediction.status)) {
    await sleep(3000);
    prediction = await checkPredictionStatus(prediction.id);
  }

  if (prediction.status === "succeeded") {
    const output = prediction.output;
    return Array.isArray(output) ? output[0] : output;
  }

  throw new Error(prediction.error || 'Generation failed');
};

interface VideoOptions {
  duration?: number;  // 4, 6, 8 秒
  aspectRatio?: string;  // "16:9" | "9:16"
}

function buildVideoInput(modelType: VideoModel, prompt: string, imageUrl: string, options: VideoOptions = {}): Record<string, any> {
  const STRICT_CONSISTENCY = "Strict visual consistency with the input image. Do NOT change the character's face, hair, skin tone, costume, or art style. The character must remain IDENTICAL across all frames. Maintain exact same proportions and appearance. Smooth natural motion only.";
  const strictPrompt = `${STRICT_CONSISTENCY} ${prompt}`;
  const duration = options.duration || 6;
  const aspectRatio = options.aspectRatio || '16:9';

  switch (modelType) {
    case 'wan_2_2_fast':
      // Wan 2.2: 使用 image 字段
      return { prompt: strictPrompt, image: imageUrl, prompt_optimizer: true, seed: 142857 };
    case 'hailuo_02_fast':
      // Hailuo: resolution 必须是 "512P"，支持 aspect_ratio
      return { prompt: strictPrompt, first_frame_image: imageUrl, duration, resolution: "512P", aspect_ratio: aspectRatio, prompt_optimizer: true, seed: 142857 };
    case 'seedance_lite':
      // Seedance: resolution 是 "720p"（小写）
      return { prompt: strictPrompt, image: imageUrl, duration, resolution: "720p", seed: 142857 };
    case 'kling_2_5':
      // Kling 2.5: 支持 duration 和 cfg_scale
      return { prompt: strictPrompt, image: imageUrl, duration, cfg_scale: 0.8, seed: 142857 };
    case 'hailuo_live':
      // Hailuo Live: 用于 Live2D 风格动画
      return { prompt: strictPrompt, first_frame_image: imageUrl, prompt_optimizer: true, seed: 142857 };
    case 'google_gemini_nano_banana':
      // 实验性模型
      return { prompt: strictPrompt, first_frame_image: imageUrl, prompt_optimizer: true, seed: 142857 };
    default:
      return { prompt: strictPrompt, first_frame_image: imageUrl, prompt_optimizer: true, seed: 142857 };
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
  aspectRatio?: string
): Promise<ReplicateResponse> => {
  const finalPrompt = characterAnchor ? `${characterAnchor}, ${prompt}` : prompt;

  // Logical Change: If modelType contains '/', treat it as a direct Replicate ID.
  // Otherwise, look it up in the map.
  let modelIdentifier = modelType.includes('/')
    ? modelType
    : (REPLICATE_MODEL_MAP[modelType] || REPLICATE_MODEL_MAP['hailuo_02_fast']);

  const headers = await getAuthHeaders();

  // 使用传入的 duration 和 aspectRatio 参数
  const videoOptions: VideoOptions = {
    duration: duration,
    aspectRatio: aspectRatio || '16:9',
  };

  const response = await fetch(`${API_BASE}/predict`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      version: modelIdentifier,
      input: buildVideoInput(modelType, finalPrompt, startImageUrl, videoOptions)
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
