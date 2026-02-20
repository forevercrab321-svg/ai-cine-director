/**
 * Gemini Service - 前端代理层
 * 所有请求通过后端 API Server 转发，不包含任何 API Key
 */
import { StoryboardProject, Language, GenerationMode } from '../types';

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
    const response = await fetch(`${API_BASE}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
 * 分析角色锚点 - 通过后端代理调用 Gemini Vision
 */
export const analyzeImageForAnchor = async (base64Data: string): Promise<string> => {
  try {
    const response = await fetch(`${API_BASE}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Data }),
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
