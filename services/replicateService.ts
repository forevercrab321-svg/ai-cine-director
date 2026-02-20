/**
 * Replicate Service - Client Proxy
 * Forwards requests to backend /api/replicate which handles Auth & Credits
 */
import { VideoStyle, ImageModel, AspectRatio, GenerationMode, VideoQuality, VideoDuration, VideoFps, VideoResolution, VideoModel } from '../types';
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

const REPLICATE_MODEL_MAP: Record<string, string> = {
  // Image models
  flux: "black-forest-labs/flux-1.1-pro",
  flux_schnell: "black-forest-labs/flux-schnell",
  nano_banana: "google/gemini-nano-banana", // Placeholder ID for Image Model
  // Video models
  wan_2_2_fast: "wan-video/wan-2.2-i2v-fast",
  hailuo_02_fast: "minimax/hailuo-02-fast",
  seedance_lite: "bytedance/seedance-1-lite",
  kling_2_5: "kwaivgi/kling-v2.5-turbo-pro",
  hailuo_live: "minimax/video-01-live",
  google_gemini_nano_banana: "google/gemini-nano-banana", // Placeholder ID - user can update or system handles
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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

  // ★ HARDCODED CONSISTENCY: Strict character lock
  const CONSISTENCY_PREFIX = "[CRITICAL: Maintain exact same character identity across all frames. Same face, same hairstyle, same costume, same body proportions. Do NOT change or deviate from the character description below.]";
  const CONSISTENCY_SUFFIX = "[IMPORTANT: The character must look IDENTICAL to the description above. Do not alter any facial features, hair color, outfit, or art style.]";

  const finalPrompt = characterAnchor
    ? `${CONSISTENCY_PREFIX} ${characterAnchor}. ${prompt}. ${CONSISTENCY_SUFFIX}`
    : prompt;

  // Logical Change: If modelType contains '/', treat it as a direct Replicate ID.
  const modelIdentifier = modelType.includes('/')
    ? modelType
    : (REPLICATE_MODEL_MAP[modelType] || REPLICATE_MODEL_MAP['flux']);

  const headers = await getAuthHeaders();

  const response = await fetch(`${API_BASE}/predict`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      version: modelIdentifier,
      input: {
        prompt: finalPrompt,
        aspect_ratio: aspectRatio,
        output_format: "jpg"
      }
    })
  });

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
    throw new Error(errText || `HTTP ${response.status}`);
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

function buildVideoInput(modelType: VideoModel, prompt: string, imageUrl: string): Record<string, any> {
  const STRICT_CONSISTENCY = "Strict visual consistency with the input image. Do NOT change the character's face, hair, skin tone, costume, or art style. The character must remain IDENTICAL across all frames. Maintain exact same proportions and appearance. Smooth natural motion only.";
  const strictPrompt = `${STRICT_CONSISTENCY} ${prompt}`;

  switch (modelType) {
    case 'wan_2_2_fast':
      return { prompt: strictPrompt, image: imageUrl, prompt_optimizer: true };
    case 'hailuo_02_fast':
      return { prompt: strictPrompt, first_frame_image: imageUrl, duration: 6, resolution: "720p", prompt_optimizer: true };
    case 'seedance_lite':
      return { prompt: strictPrompt, image: imageUrl, duration: 5, resolution: "720p" };
    case 'kling_2_5':
      return { prompt: strictPrompt, image: imageUrl, duration: 5, cfg_scale: 0.8 };
    case 'hailuo_live':
      return { prompt: strictPrompt, first_frame_image: imageUrl, prompt_optimizer: true };
    case 'google_gemini_nano_banana':
      // Assuming it works like Hailuo for now
      return { prompt: strictPrompt, first_frame_image: imageUrl, prompt_optimizer: true };
    default:
      return { prompt: strictPrompt, first_frame_image: imageUrl, prompt_optimizer: true };
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
  characterAnchor?: string
): Promise<ReplicateResponse> => {
  const finalPrompt = characterAnchor ? `${characterAnchor}, ${prompt}` : prompt;

  // Logical Change: If modelType contains '/', treat it as a direct Replicate ID.
  // Otherwise, look it up in the map.
  let modelIdentifier = modelType.includes('/')
    ? modelType
    : (REPLICATE_MODEL_MAP[modelType] || REPLICATE_MODEL_MAP['hailuo_02_fast']);

  const headers = await getAuthHeaders();

  const response = await fetch(`${API_BASE}/predict`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      version: modelIdentifier,
      input: buildVideoInput(modelType, finalPrompt, startImageUrl)
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
