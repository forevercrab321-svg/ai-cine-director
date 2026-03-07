
// ═══════════════════════════════════════════════════════════════
// Shot System — Enhanced shot-level types for production-ready storyboards
// ═══════════════════════════════════════════════════════════════

export type ShotStatus = 'draft' | 'generated' | 'locked';
export type CameraType = 'wide' | 'medium' | 'close' | 'ecu' | 'over-shoulder' | 'pov' | 'aerial' | 'two-shot';
export type CameraMovement = 'static' | 'push-in' | 'pull-out' | 'pan-left' | 'pan-right' | 'tilt-up' | 'tilt-down' | 'dolly' | 'tracking' | 'crane' | 'handheld' | 'steadicam' | 'whip-pan' | 'zoom';
export type TimeOfDay = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'golden-hour' | 'dusk' | 'night' | 'blue-hour';
export type LocationType = 'INT' | 'EXT' | 'INT/EXT';

/** Full shot specification for a single cinematic shot */
export interface Shot {
  shot_id: string;               // Stable UUID — never changes
  scene_id: string;              // Parent scene UUID
  scene_title: string;           // Human-readable scene name
  shot_number: number;           // Ordinal within scene (1-based)
  duration_sec: number;          // Estimated duration in seconds

  // Location & Time
  location_type: LocationType;
  location: string;              // e.g. "Rooftop garden, Tokyo"
  time_of_day: TimeOfDay;

  // Characters & Action
  characters: string[];          // Names of characters in shot
  action: string;                // What happens in this shot
  dialogue: string;              // Dialogue line (can be empty)

  // Camera
  camera: CameraType;
  lens: string;                  // e.g. "35mm anamorphic", "85mm f/1.4"
  movement: CameraMovement;
  composition: string;           // Rule of thirds, leading lines, etc.

  // Visual
  lighting: string;              // Key light, fill, practical, color temp
  art_direction: string;         // Set dressing, props, wardrobe notes
  mood: string;                  // Emotional keywords
  sfx_vfx: string;              // Special effects notes
  audio_notes: string;           // Sound design, music cues
  continuity_notes: string;      // Continuity with adjacent shots

  // Image Generation
  image_prompt: string;          // Full prompt for image generation
  negative_prompt: string;       // Negative prompt (optional)
  seed_hint: number | null;      // Seed for consistency (optional)
  reference_policy: 'none' | 'anchor' | 'first-frame' | 'previous-frame';

  // State
  status: ShotStatus;
  locked_fields: string[];       // Field names that AI must not modify
  version: number;               // Optimistic lock version counter
  updated_at: string;            // ISO timestamp

  // Generated assets (populated after generation)
  image_url?: string;
  video_url?: string;

  // Shot-level images (in-memory, not persisted in Shot row)
  images?: ShotImage[];
  primary_image_id?: string;
}

// ═══════════════════════════════════════════════════════════════
// Shot Image System — Images linked 1:N to shots
// ═══════════════════════════════════════════════════════════════

export type ImageStatus = 'pending' | 'generating' | 'succeeded' | 'failed';
export type ImageEditMode = 'reroll' | 'reference_edit' | 'attribute_edit';

/** A generated image belonging to a shot */
export interface ShotImage {
  id: string;                    // UUID
  shot_id: string;               // Parent shot
  project_id?: string;           // Parent project (for fast queries)
  url: string;                   // CDN / Replicate output URL
  thumbnail_url?: string;        // Optional thumbnail
  is_primary: boolean;           // Only one per shot
  status: ImageStatus;
  label?: string;                // User-friendly label (e.g. "Take 3")
  created_at: string;            // ISO timestamp

  // Generation parameters (audit trail)
  generation?: ImageGeneration;
}

/** Full record of a single image generation attempt */
export interface ImageGeneration {
  id: string;                    // UUID
  image_id?: string;             // Resulting image (null if failed)
  shot_id: string;
  project_id?: string;

  // Prompt
  prompt: string;                // Full prompt sent to model
  negative_prompt: string;
  delta_instruction?: string;    // User's edit instruction (for edits)

  // Model config
  model: ImageModel | string;    // e.g. 'flux', 'flux_schnell'
  aspect_ratio: AspectRatio;
  style: VideoStyle;
  seed: number | null;

  // Consistency
  anchor_refs: string[];         // Character anchor text(s)
  reference_image_url?: string;  // Base image for reference edits
  reference_policy: 'none' | 'anchor' | 'first-frame' | 'previous-frame';
  edit_mode?: ImageEditMode;     // null for fresh gen, else edit type

  // Result
  status: ImageStatus;
  output_url?: string;
  error?: string;
  replicate_prediction_id?: string;

  // Timing
  created_at: string;
  completed_at?: string;
  duration_ms?: number;
}

/** Request to generate an image for a shot */
export interface ShotImageGenerateRequest {
  shot_id: string;
  prompt?: string;               // Override shot.image_prompt
  negative_prompt?: string;
  delta_instruction?: string;    // Append instruction
  model?: ImageModel;
  aspect_ratio?: AspectRatio;
  style?: VideoStyle;
  seed?: number | null;
  character_anchor?: string;
  reference_policy?: 'none' | 'anchor' | 'first-frame' | 'previous-frame';
}

/** Request to edit an existing image */
export interface ShotImageEditRequest {
  image_id: string;
  edit_mode: ImageEditMode;
  delta_instruction: string;     // "Change lighting to golden hour"
  reference_image_url?: string;  // For reference_edit mode
  locked_attributes?: string[];  // e.g. ['character', 'composition']
  model?: ImageModel;
  seed?: number | null;
}

/** A single revision record for a shot */
export interface ShotRevision {
  revision_id: string;
  shot_id: string;
  version: number;
  snapshot: Partial<Shot>;       // Full shot state at this revision
  change_source: 'user' | 'ai-rewrite';
  change_description: string;
  changed_fields: string[];
  created_at: string;
}

/** Enhanced Scene that contains shots */
export interface EnhancedScene {
  scene_id: string;
  scene_number: number;
  scene_title: string;
  location: string;
  time_of_day: TimeOfDay;
  synopsis: string;              // Brief scene description
  shots: Shot[];
}

/** Enhanced project with scenes containing shots */
export interface EnhancedProject {
  id?: string;
  project_title: string;
  visual_style: string;
  character_anchor: string;
  identity_strength?: number;
  scenes: EnhancedScene[];
}

/** Request to AI-rewrite specific fields of a shot */
export interface ShotRewriteRequest {
  shot_id: string;
  fields_to_rewrite: string[];   // Which fields to regenerate
  user_instruction: string;      // "Make it more dramatic", etc.
  locked_fields: string[];       // Fields AI must NOT touch
  current_shot: Partial<Shot>;   // Current shot state for context
  project_context: {
    visual_style: string;
    character_anchor: string;
    scene_title: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// Legacy types (kept for backward compatibility)
// ═══════════════════════════════════════════════════════════════

export interface Scene {
  id?: string; // Database ID
  scene_number: number;
  scene_setting?: string; // Unique location/time for this scene (e.g., "A neon-lit alley — midnight")
  visual_description: string;
  audio_description: string;
  dialogue_text?: string;
  dialogue_speaker?: string;
  voice_characteristics?: string;
  shot_type: string;

  scene_reference_image_url?: string; // ★ 新增：场次基准锚点图 (URL)
  scene_reference_image_base64?: string; // ★ 新增：场次人物定妆图 Base64（最高优先级）

  image_prompt?: string;
  video_motion_prompt?: string;
  image_url?: string;
  video_url?: string;
  audio_url?: string;
}

export interface StoryboardProject {
  id?: string; // Database ID
  project_title: string;
  visual_style: string;
  character_anchor: string;
  identity_strength?: number;
  scenes: Scene[];
}

export interface GenerateRequest {
  storyIdea: string;
  visualStyle: string;
  identityAnchor?: string;
  identityStrength?: number;
}

export enum VisualStyle {
  POP_MART = "Pop Mart 3D",
  GHIBLI = "Studio Ghibli Anime",
  REALISM = "Cinematic Realism",
  CYBERPUNK = "Cyberpunk / Synthwave",
  PIXAR = "Disney / Pixar 3D",
  WATERCOLOR = "Abstract Watercolor"
}

export type Language = 'en' | 'zh';
export type AspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

export type ImageModel = 'flux' | 'flux_schnell' | 'nano_banana';

export type VideoModel =
  // ★ 性价比模型 (2个) - 快速出片
  | 'wan_2_2_fast'           // ★ Alibaba Wan 2.2 - 性价比之王 $0.01-0.02
  | 'hailuo_02_fast'        // ★ MiniMax Hailuo-02 - 均衡之选 $0.10-0.15

  // ★ 顶级画质模型 (4个) - 电影级质量
  | 'kling_2_5_pro'        // ★ 快手Kling 2.5 Pro - 顶级物理 $0.50-0.90
  | 'veo_3'                // ★ Google Veo 3 - 最高质量 $3.00+
  | 'seedance_pro'          // ★ ByteDance Seedance Pro - 首帧尾帧 $0.30-0.72
  | 'sora_2';              // ★ OpenAI Sora 2 - 最新AI视频 $2.50

export type GenerationMode = 'storyboard' | 'story';

export type VideoMethod = 'stable' | 'ai';
export type MotionIntensity = 'low' | 'medium' | 'high';
export type VideoQuality = 'draft' | 'standard' | 'pro';
/**
 * ★ 视频时长选择
 * 支持: 4s, 5s, 6s, 8s, 10s
 * 根据不同模型支持不同长度
 */
export type VideoDuration = 4 | 5 | 6 | 8 | 10;
export type VideoFps = 12 | 24;
export type VideoResolution = '720p' | '1080p';

export type VideoStyle =
  | 'none'
  | 'chinese_3d'
  | 'chinese_ink'
  | 'pop_mart'
  | 'realism'
  | 'blockbuster_3d'
  | 'cyberpunk'
  | 'ghibli'
  | 'shinkai';

// ═══════════════════════════════════════════════════════════════
// 🎤 Voice Configuration Types
// ═══════════════════════════════════════════════════════════════

export type VoiceLanguage = 'zh' | 'en' | 'ja' | 'ko' | 'es' | 'fr' | 'de';

/**
 * 语音配置
 */
export interface VoiceSettings {
  enabled: boolean;           // 是否启用语音合成
  voiceId: string;           // 选中的声音ID
  language: VoiceLanguage;   // 语言
  speed: number;             // 语速 0.5-2.0
  referenceAudioUrl?: string; // 参考音频URL（用于克隆）
}

export interface StylePreset {
  id: VideoStyle;
  label: string;
  category: string;
  promptModifier: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'chinese_3d',
    label: 'Chinese 3D Anime (国漫)',
    category: '🇨🇳 Chinese Aesthetics',
    promptModifier: ', 3D donghua style, Light Chaser Animation aesthetic, White Snake inspired, oriental fantasy, highly detailed 3D render, blind box texture, 8k, ethereal lighting, martial arts vibe, consistent character features'
  },
  {
    id: 'chinese_ink',
    label: 'Chinese Ink Wash (水墨)',
    category: '🇨🇳 Chinese Aesthetics',
    promptModifier: ', traditional Chinese ink wash painting, shuimo style, watercolor texture, flowing ink, negative space, oriental landscape, artistic, Shanghai Animation Film Studio style, masterpiece'
  },
  {
    id: 'pop_mart',
    label: 'Pop Mart 3D (盲盒)',
    category: '🇨🇳 Chinese Aesthetics',
    promptModifier: ', Pop Mart style, blind box toy, C4D render, clay material, cute proportions, studio lighting, clean background, 3D character design, plastic texture'
  },
  {
    id: 'realism',
    label: 'Hyper Realism (4K ARRI)',
    category: '🎥 Cinema & Realism',
    promptModifier: ', photorealistic, shot on ARRI Alexa, 35mm lens, cinematic lighting, depth of field, hyper-realistic, live action footage, raytracing, 8k, raw photo'
  },
  {
    id: 'blockbuster_3d',
    label: 'Hollywood Blockbuster',
    category: '🎥 Cinema & Realism',
    promptModifier: ', hollywood blockbuster style, Unreal Engine 5 render, IMAX quality, cinematic composition, dramatic lighting, highly detailed VFX, transformers style, sci-fi masterpiece'
  },
  {
    id: 'cyberpunk',
    label: 'Cinematic Cyberpunk',
    category: '🎥 Cinema & Realism',
    promptModifier: ', futuristic sci-fi masterpiece, neon lights, high tech, cybernetic atmosphere, blade runner style, night city, volumetric fog, cinematic'
  },
  {
    id: 'ghibli',
    label: 'Studio Ghibli (吉卜力)',
    category: '🎨 Art & Anime',
    promptModifier: ', Studio Ghibli style, Hayao Miyazaki, hand drawn anime, cel shading, vibrant colors, picturesque scenery, 2D animation, cinematic'
  },
  {
    id: 'shinkai',
    label: 'Makoto Shinkai (新海诚)',
    category: '🎨 Art & Anime',
    promptModifier: ', Makoto Shinkai style, Your Name style, vibrant vivid colors, highly detailed background art, lens flare, emotional lighting, anime masterpiece, 8k wallpaper'
  }
];

/**
 * CREDIT Pricing — 基于 Replicate API 实际成本 + 40-60% 利润
 * 1 credit ≈ $0.01 USD
 * 定价公式: API成本(USD) × 100 × 1.5(50%利润) ≈ credits
 * 最后更新: 2025-08
 * 
 * ★ TOP 5 性价比模型推荐:
 * 1. Wan 2.2 Fast - $0.01/视频 (性价比之王)
 * 2. Hailuo-02 Fast - $0.10/视频 (中国顶尖)
 * 3. Runway Gen-4 Turbo - $0.25/视频 (极速22秒)
 * 4. Seedance Lite - $0.09/视频 (首帧尾帧)
 * 5. Kling 2.5 - $0.25/视频 (电影级质量)
 */
export const MODEL_COSTS: Record<VideoModel | 'DEFAULT', number> = {
  // ★ 性价比模型 (2个) - 快速出片
  wan_2_2_fast: 8,           // API: ~$0.02/video → 8 💎  ⚡ 最便宜
  hailuo_02_fast: 22,        // API: ~$0.10/video → 22 💎  🇨🇳 均衡之选

  // ★ 顶级画质模型 (4个) - 电影级质量
  kling_2_5_pro: 85,        // API: ~$0.50/video → 85 💎  🏆 顶级物理
  veo_3: 300,               // API: ~$3.00/video → 300 💎  👑 最高质量
  seedance_pro: 55,         // API: ~$0.35/video → 55 💎  🎬 首帧尾帧
  sora_2: 250,             // API: ~$2.50/video → 250 💎  🤖 OpenAI最新

  DEFAULT: 22
};

/**
 * Replicate模型路径映射
 * 将VideoModel枚举映射到Replicate API的完整模型路径
 * 用于调用Replicate API时确定正确的endpoint
 * 
 * ★ TOP 5 模型路径:
 */
export const REPLICATE_MODEL_PATHS: Record<VideoModel | ImageModel, string> = {
  // ★ 性价比模型 (2个)
  wan_2_2_fast: "wan-video/wan-2.2-i2v-fast",
  hailuo_02_fast: "minimax/hailuo-02-fast",

  // ★ 顶级画质模型 (4个)
  kling_2_5_pro: "kwaivgi/kling-v2.5-turbo-pro",
  veo_3: "google/veo-3",
  seedance_pro: "bytedance/seedance-1-pro",
  sora_2: "openai/sora-2",

  // Image models
  flux: "black-forest-labs/flux-1.1-pro",
  flux_schnell: "black-forest-labs/flux-schnell",
  nano_banana: "google/gemini-nano-banana"
};

/**
 * 图片模型成本定义
 */
export const IMAGE_MODEL_COSTS: Record<ImageModel, number> = {
  flux: 6,           // Flux Pro: ~$0.04/image
  flux_schnell: 1,   // Flux Schnell: ~$0.003/image (fast budget option)
  nano_banana: 2     // Gemini Nano: experimental
};

/**
 * 根据Replicate路径获取模型成本
 * 用于后端API路由，支持反向查找
 * @param replicatePath - Replicate完整模型路径 (如 "wan-video/wan-2.2-i2v-fast")
 * @returns 成本（credits）
 */
export function getCostForReplicatePath(replicatePath: string): number {
  // 尝试匹配视频模型
  for (const [model, path] of Object.entries(REPLICATE_MODEL_PATHS)) {
    if (path === replicatePath) {
      const videoModel = model as VideoModel;
      if (MODEL_COSTS[videoModel] !== undefined) {
        return MODEL_COSTS[videoModel];
      }
      // 检查是否是图片模型
      const imageModel = model as ImageModel;
      if (IMAGE_MODEL_COSTS[imageModel] !== undefined) {
        return IMAGE_MODEL_COSTS[imageModel];
      }
    }
  }
  return MODEL_COSTS.DEFAULT;
}

export const MODEL_METADATA: Record<VideoModel, { label: string; tags: string[]; audio?: boolean; badge?: string; priceLabel: string; resolution: string; duration: string; speed: string }> = {
  // ★ 性价比模型 (2个) - 快速出片
  wan_2_2_fast: {
    label: "Wan 2.2 Fast (Alibaba)",
    tags: ["⚡ 极速", "💰 性价比王", "🏷️ 5秒"],
    badge: "💰 首选",
    priceLabel: "8 credits",
    resolution: "480p-720p",
    duration: "5秒",
    speed: "⚡⚡⚡⚡⚡ 最快6秒"
  },
  hailuo_02_fast: {
    label: "Hailuo-02 (MiniMax)",
    tags: ["⚡ 快速", "🎬 高质量", "🇨🇳 中国顶尖", "🏷️ 6-10秒"],
    badge: "⭐ 推荐",
    priceLabel: "22 credits",
    resolution: "512p-768p",
    duration: "6-10秒",
    speed: "⚡⚡⚡⚡ 41秒"
  },

  // ★ 顶级画质模型 (3个) - 电影级质量
  kling_2_5_pro: {
    label: "Kling 2.5 Pro (快手)",
    tags: ["🏆 顶级物理", "🎬 电影级", "📹 1080p", "🏷️ 5-10秒"],
    badge: "🔥 Pro",
    priceLabel: "85 credits",
    resolution: "720p-1080p",
    duration: "5-10秒",
    speed: "⚡⚡⚡ 2-4分钟"
  },
  veo_3: {
    label: "Veo 3 (Google)",
    tags: ["👑 最高质量", "🎬 电影级", "🔊 原生音频", "📹 1080p", "🏷️ 8秒"],
    badge: "👑 旗舰",
    priceLabel: "300 credits",
    resolution: "720p-1080p",
    duration: "8秒",
    speed: "⚡⚡⚡ 59秒"
  },
  seedance_pro: {
    label: "Seedance Pro (ByteDance)",
    tags: ["🎨 风格多样", "🔗 首帧尾帧", "🏷️ 5-10秒"],
    badge: "🎬 Pro",
    priceLabel: "55 credits",
    resolution: "480p-1080p",
    duration: "5-10秒",
    speed: "⚡⚡⚡⚡ 25秒"
  },
  sora_2: {
    label: "Sora 2 (OpenAI)",
    tags: ["🤖 最新AI", "🎬 电影级", "🔊 原生音频", "📹 1080p", "🏷️ 5-20秒"],
    badge: "🤖 New",
    priceLabel: "250 credits",
    resolution: "720p-1080p",
    duration: "5-20秒",
    speed: "⚡⚡⚡ 1-3分钟"
  }
};

/**
 * Image & misc credit costs
 * flux-1.1-pro: API $0.04/img → 4 × 1.5 = 6
 * flux-schnell: API $0.003/img → minimum 1 credit
 */
export const CREDIT_COSTS = {
  IMAGE_FLUX: 6,           // API: $0.04/image
  IMAGE_FLUX_SCHNELL: 1,   // API: $0.003/image (minimum charge)
  IMAGE_NANO: 0,
  VIDEO_STABLE: 1,
  QUALITY_PRO_EXTRA: 8,    // 1080p / Pro quality surcharge
  RES_1080P_EXTRA: 8
};


export const MODEL_MULTIPLIERS: Record<VideoModel, number> = {
  // ★ 性价比模型
  wan_2_2_fast: 1.0,
  hailuo_02_fast: 1.2,

  // ★ 顶级画质模型
  kling_2_5_pro: 1.6,
  veo_3: 2.0,
  seedance_pro: 1.3,
  sora_2: 1.8
};

export const CREDIT_PACKS = [
  { id: 'pack_small', price: 5, credits: 500, label: 'Starter Pack', priceId: 'price_1T4l2pJ3FWUBvlCmbdxyNavw' },
  { id: 'pack_medium', price: 10, credits: 1200, label: 'Value Pack', popular: true, priceId: 'price_1T4l2pJ3FWUBvlCmS8qBhrW5' },
  { id: 'pack_large', price: 25, credits: 3500, label: 'Pro Pack', priceId: 'price_1T4l2pJ3FWUBvlCmuM0Ki56j' }
];

// ═══════════════════════════════════════════════════════════════
// B2B 企业订阅套餐 (月度)
// ═══════════════════════════════════════════════════════════════
export interface BusinessPlan {
  id: string;
  name: string;
  nameZh: string;
  priceMonthly: number;
  creditsMonthly: number;
  pricePerCredit: number;  // 单价
  features: string[];
  target: 'starter' | 'pro' | 'business' | 'enterprise';
  popular?: boolean;
}

export const BUSINESS_PLANS: BusinessPlan[] = [
  {
    id: 'plan_starter',
    name: 'Studio Starter',
    nameZh: '小型工作室',
    priceMonthly: 299,
    creditsMonthly: 3000,
    pricePerCredit: 0.10,
    features: [
      '3,000 credits/月',
      '基础视频模型',
      '标准优先级队列',
      '邮件支持',
      '720p 输出',
      '自动剪辑拼接'
    ],
    target: 'starter'
  },
  {
    id: 'plan_pro',
    name: 'Studio Pro',
    nameZh: '中型工作室',
    priceMonthly: 999,
    creditsMonthly: 15000,
    pricePerCredit: 0.067,
    features: [
      '15,000 credits/月',
      '全部视频模型',
      '优先处理队列',
      '优先客服支持',
      '1080p 输出',
      '语音合成',
      '首帧尾帧链接',
      '自动剪辑拼接',
      '团队协作(3人)'
    ],
    target: 'pro',
    popular: true
  },
  {
    id: 'plan_business',
    name: 'Enterprise',
    nameZh: '大型企业',
    priceMonthly: 1999,
    creditsMonthly: 50000,
    pricePerCredit: 0.040,
    features: [
      '50,000 credits/月',
      '全部视频模型+Veo3',
      'VIP 优先队列',
      '24/7 专属客服',
      '4K 输出',
      'API 接入',
      '自定义品牌水印',
      '团队协作(10人)',
      '定制化服务',
      '专属客户经理'
    ],
    target: 'business'
  },
  {
    id: 'plan_enterprise',
    name: 'Enterprise',
    nameZh: '集团企业',
    priceMonthly: 2999,
    creditsMonthly: 300000,
    pricePerCredit: 0.010,
    features: [
      '300,000 credits/月',
      '全部模型无限用',
      '极速专用队列',
      '专属技术经理',
      '4K 输出',
      '完整API接入',
      '白标定制',
      '团队协作(无限)',
      '定制模型训练',
      '专属服务器'
    ],
    target: 'enterprise'
  }
];

// ═══════════════════════════════════════════════════════════════
// B2B API 接入套餐
// ═══════════════════════════════════════════════════════════════
export interface APIPlan {
  id: string;
  name: string;
  nameZh: string;
  priceMonthly: number;
  apiCallsMonthly: number;
  overageRate: number;
  features: string[];
}

export const API_PLANS: APIPlan[] = [
  {
    id: 'api_startup',
    name: 'API Startup',
    nameZh: 'API创业版',
    priceMonthly: 199,
    apiCallsMonthly: 10000,
    overageRate: 0.025,
    features: [
      '10,000 次API调用/月',
      'RESTful API',
      '基础文档',
      '邮件支持'
    ]
  },
  {
    id: 'api_business',
    name: 'API Business',
    nameZh: 'API商务版',
    priceMonthly: 499,
    apiCallsMonthly: 50000,
    overageRate: 0.015,
    features: [
      '50,000 次API调用/月',
      'Webhooks',
      '完整文档',
      '优先技术支持',
      'SLA 99.5%'
    ]
  },
  {
    id: 'api_enterprise',
    name: 'API Enterprise',
    nameZh: 'API企业版',
    priceMonthly: 1499,
    apiCallsMonthly: 200000,
    overageRate: 0.008,
    features: [
      '200,000 次API调用/月',
      '专属API服务器',
      '7x24 技术支持',
      'SLA 99.9%',
      '定制化开发',
      '专属客户经理'
    ]
  }
];

// ═══════════════════════════════════════════════════════════════
// 增值服务定价
// ═══════════════════════════════════════════════════════════════
export const ADDON_SERVICES = {
  custom_model_training: {
    name: 'Custom Model Training',
    nameZh: '定制模型训练',
    price: 5000,
    description: '为企业训练专属AI模型'
  },
  dedicated_support: {
    name: 'Dedicated Support',
    nameZh: '专属客服',
    price: 500,
    description: '24/7 专属技术支持'
  },
  priority_queue: {
    name: 'Priority Queue',
    nameZh: '优先队列',
    price: 200,
    description: '任务优先处理'
  },
  white_label: {
    name: 'White Label',
    nameZh: '白标定制',
    price: 10000,
    description: '完全品牌定制'
  }
};

export const PLAN_LIMITS = {
  creator: 1000,
  director: 3500
};

export interface UserCreditState {
  balance: number;
  isPro: boolean;
  isAdmin?: boolean;
  monthlyUsage: number;
  planType: 'creator' | 'director';
}

export const STRIPE_PRICES = {
  CREATOR_MONTHLY: 'price_1SykM5J3FWUBvlCmYotWtUGA',
  CREATOR_YEARLY: 'price_1SykwsJ3FWUBvlCmoNwqi0EY',
  DIRECTOR_MONTHLY: 'price_1SyknyJ3FWUBvlCmXPbBj3si',
  DIRECTOR_YEARLY: 'price_1SykxoJ3FWUBvlCmZeIFDxFJ',
};

export const STRIPE_PUBLISHABLE_KEY = 'pk_test_mock_key';

// ═══════════════════════════════════════════════════════════════
// Batch Job System — Queued batch image generation
// ═══════════════════════════════════════════════════════════════

export type BatchJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type BatchItemStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type ContinueStrategy = 'strict' | 'skip_failed';

/** A batch job (e.g. "generate images for first 9 shots") */
export interface BatchJob {
  id: string;                    // UUID
  project_id: string;
  user_id?: string;
  type: 'gen_images' | 'gen_images_continue';  // Extensible for future batch types
  total: number;                 // Total items
  done: number;                  // Completed (succeeded + failed)
  succeeded: number;
  failed: number;
  status: BatchJobStatus;
  created_at: string;
  updated_at: string;
  concurrency: number;           // Max concurrent tasks (e.g. 2)

  // Continue-generation range tracking
  range_start_scene?: number;    // First scene in this batch
  range_start_shot?: number;     // First shot number in this batch
  range_end_scene?: number;      // Last scene in this batch
  range_end_shot?: number;       // Last shot number in this batch
  strategy?: ContinueStrategy;   // Strategy used for this batch
  all_done?: boolean;            // True when all project shots have images
  remaining_count?: number;      // How many shots still need images after this batch
}

/** A single item within a batch job */
export interface BatchJobItem {
  id: string;                    // UUID
  job_id: string;
  shot_id: string;
  shot_number: number;           // For display ordering
  scene_number: number;
  status: BatchItemStatus;
  image_id?: string;             // Resulting image ID (on success)
  image_url?: string;            // Resulting image URL (on success)
  error?: string;                // Error message (on failure)
  started_at?: string;
  completed_at?: string;
}

// ============================================
// 多帧关键帧系统类型
// ============================================

export interface MultiFrameConfig {
  enabled: boolean;                    // 是否启用多帧模式
  continuityMode: 'link' | 'independent'; // 链式或独立
  keyframes: MultiFrameKeyframe[];     // 关键帧配置
}

export interface MultiFrameKeyframe {
  index: number;                       // 帧序号 (0, 1, 2...)
  imageUrl?: string;                   // 关键帧图片 (可选，不提供则使用前一段尾帧)
  prompt: string;                      // 该段视频的描述
  duration?: VideoDuration;            // 时长
  useAsKeyframe?: boolean;            // 是否作为下一段的关键帧
}

export interface MultiFrameResult {
  frameIndex: number;
  videoUrl: string;
  lastFrameUrl: string;
  thumbnailUrl?: string;
  success: boolean;
  error?: string;
  duration: number;
  model: VideoModel;
}

export type MultiFrameProgressStatus = 
  | 'preparing'
  | 'generating'
  | 'extracting'
  | 'done'
  | 'error';

export interface MultiFrameProgress {
  frameIndex: number;
  status: MultiFrameProgressStatus;
  message?: string;
  progress?: number; // 0-100
}
