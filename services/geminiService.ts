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
  identityAnchor?: string,
  sceneCount?: number
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
        sceneCount: sceneCount || 5,
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
 * 支持完整 data URL (data:image/jpeg;base64,...) 或裸 base64
 */
const compressBase64Image = (base64Data: string, maxSizeKB: number = 500): Promise<string> => {
  return new Promise((resolve) => {
    // 计算实际 base64 部分的大小
    const rawBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const sizeKB = (rawBase64.length * 3) / 4 / 1024;
    
    if (sizeKB <= maxSizeKB) {
      console.log(`[RefImage] Image size ${Math.round(sizeKB)}KB <= ${maxSizeKB}KB, no compression needed`);
      resolve(base64Data);
      return;
    }

    // ★ 确保 img.src 使用完整 data URL 格式，否则浏览器无法加载
    const dataUrl = base64Data.includes(',') 
      ? base64Data  // 已经是完整 data URL
      : `data:image/jpeg;base64,${base64Data}`;  // 裸 base64 → 添加前缀

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
      
      // 使用较低质量的 JPEG — 返回完整 data URL
      const compressed = canvas.toDataURL('image/jpeg', 0.7);
      const compressedRaw = compressed.split(',')[1] || compressed;
      const compressedKB = Math.round((compressedRaw.length * 3) / 4 / 1024);
      console.log(`[RefImage] Compressed from ${Math.round(sizeKB)}KB to ${compressedKB}KB (${width}x${height})`);
      resolve(compressed);
    };
    img.onerror = (err) => {
      console.warn('[RefImage] Image compression failed, using original:', err);
      // 即使压缩失败，也确保返回有效的 data URL
      resolve(dataUrl);
    };
    img.src = dataUrl;
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
    console.log(`[RefImage] Input data length: ${base64Data.length}, hasPrefix: ${base64Data.startsWith('data:')}`);
    const compressedData = await compressBase64Image(base64Data, 400);
    console.log(`[RefImage] Compressed data length: ${compressedData.length}, hasPrefix: ${compressedData.startsWith('data:')}`);

    const response = await fetch(`${API_BASE}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({ base64Data: compressedData }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      console.error(`[RefImage] Analyze failed with status ${response.status}:`, errText);
      throw new Error(`Analyze API failed: ${response.status}`);
    }

    const data = await response.json();
    console.log('[RefImage] ✅ Gemini Vision anchor result:', data.anchor?.substring(0, 100) + '...');
    
    // ★ 检查是否返回了默认 fallback（意味着分析可能失败了）
    if (!data.anchor || data.anchor === 'A cinematic character') {
      console.warn('[RefImage] ⚠️ Got default fallback anchor — analysis may have failed');
    }
    
    return data.anchor || 'A cinematic character';
  } catch (error) {
    console.error('[RefImage] ❌ Identity Analysis Error:', error);
    return 'A cinematic character';
  }
};
