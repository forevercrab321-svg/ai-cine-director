// ═══════════════════════════════════════════════════════════════
// Audio Service - Coqui XTTS-v2 语音合成服务
// ═══════════════════════════════════════════════════════════════

import { supabase } from '../lib/supabaseClient';

// 语音配置类型
export interface VoiceConfig {
  voice_id: string;
  name: string;
  language: string;
  description: string;
}

// 语音生成请求
export interface GenerateAudioRequest {
  text: string;
  voice_id?: string;        // 预设声音ID
  reference_audio_url?: string;  // 用户上传的参考音频URL（用于声音克隆）
  language?: string;
  speed?: number;          // 语速 0.5-2.0
}

// 语音生成响应
export interface GenerateAudioResponse {
  audio_url: string;
  duration_seconds: number;
  cost_credits: number;
}

// ★ 预设语音列表 (无需上传参考音频)
export const PRESET_VOICES: VoiceConfig[] = [
  // 中文语音
  { voice_id: 'zh_male_1', name: '中文男声-成熟', language: 'zh', description: '成熟稳重的男声' },
  { voice_id: 'zh_female_1', name: '中文女声-温柔', language: 'zh', description: '温柔甜美的女声' },
  { voice_id: 'zh_male_narrator', name: '中文旁白-专业', language: 'zh', description: '专业纪录片旁白' },
  { voice_id: 'zh_female_young', name: '中文女声-年轻', language: 'zh', description: '活泼年轻的女声' },
  
  // 英文语音
  { voice_id: 'en_male_natural', name: 'English Male-Natural', language: 'en', description: 'Natural American male voice' },
  { voice_id: 'en_female_natural', name: 'English Female-Natural', language: 'en', description: 'Natural American female voice' },
  { voice_id: 'en_male_narrator', name: 'English Narrator', language: 'en', description: 'Professional narrator voice' },
  { voice_id: 'en_female_british', name: 'English Female-British', language: 'en', description: 'British female accent' },
  
  // 日文语音
  { voice_id: 'ja_male_1', name: '日本語男性', language: 'ja', description: '自然な日本語男性声' },
  { voice_id: 'ja_female_1', name: '日本語女性', language: 'ja', description: '自然な日本語女性声' },
  
  // 韩文语音
  { voice_id: 'ko_male_1', name: '한국어 남자', language: 'ko', description: '한국어男性声音' },
  { voice_id: 'ko_female_1', name: '한국어 여자', language: 'ko', description: '한국어女性声音' },
];

// 语言代码映射
const LANGUAGE_MAP: Record<string, string> = {
  'zh': 'zh-cn',
  'en': 'en',
  'ja': 'ja',
  'ko': 'ko',
  'es': 'es',
  'fr': 'fr',
  'de': 'de',
  'it': 'it',
  'pt': 'pt',
  'ru': 'ru',
};

/**
 * 获取认证头
 */
async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("请先登录以生成语音");
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`
  };
}

/**
 * 语音生成 (调用后端API)
 */
export async function generateAudio(
  text: string,
  options: {
    voice_id?: string;
    reference_audio_url?: string;
    language?: string;
    speed?: number;
  } = {}
): Promise<GenerateAudioResponse> {
  try {
    const headers = await getAuthHeaders();
    
    const requestBody = {
      text,
      voice: options.voice_id || 'zh_female_1',
      emotion: 'neutral',
      language: options.language || 'zh',
      speed: options.speed || 1.0
    };

    const response = await fetch('/api/audio/generate-dialogue', {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
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
      throw new Error(errData.error || `Generate audio failed (${response.status})`);
    }

    const data = await response.json();
    const estimatedDuration = typeof data.duration === 'number'
      ? data.duration
      : Math.max(1, text.split(/\s+/).filter(Boolean).length / 2.5);
    return {
      audio_url: data.audio_url || data.url,
      duration_seconds: estimatedDuration,
      cost_credits: estimateAudioCost(text)
    };
  } catch (error: any) {
    console.error("[AudioService] GenerateAudio Error:", error);
    throw error;
  }
}

/**
 * 上传参考音频用于声音克隆
 */
export async function uploadReferenceAudio(
  audioFile: File
): Promise<{ url: string; duration: number }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("请先登录");

    const fileName = `voice_ref_${Date.now()}_${audioFile.name}`;
    const filePath = `reference_audio/${session.user.id}/${fileName}`;

    const { data, error } = await supabase.storage
      .from('audio')
      .upload(filePath, audioFile, {
        cacheControl: '3600',
        upsert: false,
        contentType: audioFile.type
      });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
      .from('audio')
      .getPublicUrl(filePath);

    // 获取音频时长（这里简化处理，实际需要解析音频文件）
    return {
      url: publicUrl,
      duration: 0 // 实际需要用音频库解析
    };
  } catch (error: any) {
    console.error("[AudioService] Upload Error:", error);
    throw error;
  }
}

/**
 * 获取用户的语音库（已克隆的声音）
 */
export async function getUserVoiceLibrary(): Promise<{
  id: string;
  name: string;
  reference_url: string;
  created_at: string;
}[]> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch('/api/audio/elevenlabs/voices', {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch voices: ${response.status}`);
    }

    const data = await response.json();
    return data.voices || [];
  } catch (error: any) {
    console.error("[AudioService] GetVoices Error:", error);
    return [];
  }
}

/**
 * 估算语音生成费用
 * @param text 文本长度（字符数）
 * @returns 预估 credits
 */
export function estimateAudioCost(text: string): number {
  // 基于字符数估算：每100字符约需1 credit
  const chars = text.length;
  const minutes = chars / 200; // 假设每分钟200字符
  return Math.max(1, Math.ceil(minutes * 8)); // 8 credits/分钟
}

// ★ 语音成本配置
export const AUDIO_COSTS = {
  // 预设声音 (使用预训练模型)
  PRESET_VOICE: 8, // 8 credits/分钟
  
  // 声音克隆 (需要额外处理)
  CLONED_VOICE: 15, // 15 credits/分钟
  
  // 最少收费
  MIN_COST: 1 // 最少1 credit
};
