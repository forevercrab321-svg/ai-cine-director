/**
 * Gemini Service - 前端代理层
 * 所有请求通过后端 API Server 转发，不包含任何 API Key
 */
import { StoryboardProject, Language, GenerationMode } from '../types';
import { supabase } from '../lib/supabaseClient';

const API_BASE = '/api/gemini';

/**
 * 生成故事板 - 通过后端代理调用 Gemini API
 */
export const generateStoryboard = async (
  storyIdea: string,
  visualStyle: string,
  language: Language,
  mode: GenerationMode,
  identityAnchor?: string
): Promise<StoryboardProject> => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const response = await fetch(`${API_BASE}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({
        storyIdea,
        visualStyle,
        language,
        mode,
        identityAnchor,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(errData.error || `Gemini API 调用失败 (${response.status})`);
    }

    return await response.json();
  } catch (error) {
    console.error('Gemini Director Error:', error);
    throw error;
  }
};

/**
 * 压缩 base64 图片以避免 413 错误（Vercel 限制 4.5MB）
 */
const compressBase64Image = (base64Data: string, maxSizeKB: number = 500): Promise<string> => {
  return new Promise((resolve) => {
    // 如果已经很小，直接返回
    const sizeKB = (base64Data.length * 3) / 4 / 1024;
    if (sizeKB <= maxSizeKB) {
      resolve(base64Data);
      return;
    }

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      
      // 按比例缩小到合理尺寸
      const maxDim = 800;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      
      // 使用较低质量的 JPEG
      const compressed = canvas.toDataURL('image/jpeg', 0.7);
      console.log(`[RefImage] Compressed from ${Math.round(sizeKB)}KB to ${Math.round((compressed.length * 3) / 4 / 1024)}KB`);
      resolve(compressed);
    };
    img.onerror = () => resolve(base64Data);  // 失败时返回原图
    img.src = base64Data;
  });
};

/**
 * 分析角色锚点 - 通过后端代理调用 Gemini Vision
 */
export const analyzeImageForAnchor = async (base64Data: string): Promise<string> => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    // ★ 压缩图片避免 413 错误
    console.log('[RefImage] Analyzing image with Gemini Vision...');
    const compressedData = await compressBase64Image(base64Data, 400);

    const response = await fetch(`${API_BASE}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({ base64Data: compressedData }),
    });

    if (!response.ok) {
      console.error('Analyze failed, using fallback');
      return 'A cinematic character';
    }

    const data = await response.json();
    return data.anchor || 'A cinematic character';
  } catch (error) {
    console.error('Identity Analysis Error:', error);
    return 'A cinematic character';
  }
};
