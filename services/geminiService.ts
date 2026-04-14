/**
 * Gemini Service - 前端代理层
 * 所有请求通过后端 API Server 转发，不包含任何 API Key
 * Mock 模式仅在设置中明确启用时激活，不会静默回退
 */
import { StoryboardProject, Language, GenerationMode, DirectorControls } from '../types';
import { supabase } from '../lib/supabaseClient';

const API_BASE = '/api/gemini';

const inferNonHumanSpecies = (...inputs: Array<string | undefined>) => {
  const text = inputs.filter(Boolean).join(' ').toLowerCase();
  const entries: Array<[string, RegExp[]]> = [
    ['cat', [/\bcat\b/, /\bkitten\b/, /猫/g, /小猫/g, /猫咪/g]],
    ['dog', [/\bdog\b/, /\bpuppy\b/, /狗/g, /小狗/g, /狗狗/g]],
    ['rabbit', [/\brabbit\b/, /\bbunny\b/, /兔/g]],
    ['bear', [/\bbear\b/, /熊/g, /小熊/g]],
    ['fox', [/\bfox\b/, /狐狸/g]],
    ['animal', [/\banimal\b/, /动物/g, /宠物/g, /萌宠/g]],
  ];
  return entries.find(([, patterns]) => patterns.some((pattern) => pattern.test(text)))?.[0] || null;
};

// Mock data for offline/demo mode - FIXED to show diverse scenes
const generateMockStoryboard = (
  storyIdea: string,
  visualStyle: string,
  language: Language,
  mode: GenerationMode,
  sceneCount: number = 5,
  identityAnchor?: string
): StoryboardProject => {
  const detectedSpecies = inferNonHumanSpecies(storyIdea, identityAnchor);
  const anchor = identityAnchor?.trim() || (detectedSpecies
    ? `A ${detectedSpecies} protagonist with clear species-specific anatomy, expressive eyes, and consistent signature accessories`
    : 'Main protagonist');
  const scenes = [];
  const sceneSettings = [
    { location: 'A modern city rooftop at sunset', time: 'golden hour', action: 'Character looks out over the city skyline, wind in hair' },
    { location: 'A dark forest with mist', time: 'night', action: 'Character walks through trees, flashlight beam cutting through fog' },
    { location: 'An ancient temple', time: 'morning', action: 'Character discovers mysterious artifacts on stone altar' },
    { location: 'A futuristic laboratory', time: 'day', action: 'Character examines holographic displays, technology hums' },
    { location: 'An underwater base', time: 'underwater', action: 'Character peers through reinforced glass at deep ocean creatures' },
  ];

  for (let i = 0; i < sceneCount; i++) {
    const sceneSetting = sceneSettings[i % sceneSettings.length];
    const storyPrefix = i === 0 ? storyIdea.slice(0, 60) : `Continuing the story`;

    scenes.push({
      id: `scene-${i + 1}`,
      scene_number: i + 1,
      scene_setting: `${sceneSetting.location} — ${sceneSetting.time}`,
      visual_description: `${storyPrefix}. Location: ${sceneSetting.location}. Action: ${sceneSetting.action}`,
      audio_description: `Cinematic ambient music. Environment: ${sceneSetting.location}.`,
      shot_type: 'cinematic wide shot',
      image_prompt: `${storyIdea.slice(0, 40)}, ${visualStyle}, ${sceneSetting.location}, ${sceneSetting.time}, ${sceneSetting.action}`,
    });
  }

  return {
    project_title: storyIdea.slice(0, 50),
    visual_style: visualStyle,
    character_anchor: anchor,
    story_entities: [{
      id: crypto.randomUUID(),
      type: 'character',
      name: detectedSpecies ? `${detectedSpecies} protagonist` : 'Main Character',
      description: anchor,
      is_locked: true,
    }],
    scenes,
  };
};

/**
 * 生成故事板 - 通过后端代理调用 Gemini API
 * 后端不可用时使用 Mock 模式
 */
/**
 * Check if mock mode is explicitly enabled in user settings
 */
function isExplicitMockMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const saved = localStorage.getItem('appSettings');
    if (!saved) return false;
    return JSON.parse(saved)?.useMockMode === true;
  } catch { return false; }
}

export const generateStoryboard = async (
  storyIdea: string,
  visualStyle: string,
  language: Language,
  mode: GenerationMode,
  identityAnchor?: string,
  sceneCount?: number,
  forceHasCast?: boolean,
  projectType?: string,
  directorControls?: DirectorControls
): Promise<StoryboardProject> => {
  // ★ EXPLICIT MOCK MODE — only if user opts in via settings
  if (isExplicitMockMode()) {
    console.warn('[Gemini] ⚠️ Mock mode EXPLICITLY enabled in settings. Returning mock data.');
    return generateMockStoryboard(storyIdea, visualStyle, language, mode, sceneCount || 5, identityAnchor);
  }

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  if (!token) {
    throw new Error('请先登录以生成故事板 (Login required to generate storyboard)');
  }

  const response = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      storyIdea,
      visualStyle,
      language,
      mode,
      identityAnchor,
      sceneCount: sceneCount || 5,
      forceHasCast,
      projectType,
      directorControls,
    }),
  });

  if (!response.ok) {
    let errorMessage = `故事板生成失败 (Storyboard generation failed: ${response.status})`;
    try {
      const errData = await response.json();
      errorMessage = errData?.error || errData?.message || errorMessage;
    } catch { /* keep default message */ }
    console.error('[Gemini] ❌ Backend error:', errorMessage);
    throw new Error(errorMessage);
  }

  return await response.json();
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
      // Fallback to default anchor if backend unavailable
      console.warn('[RefImage] Backend unavailable, using default anchor');
      return 'A cinematic character with distinctive features';
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
