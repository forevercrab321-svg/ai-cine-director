import {
  generateImage,
  startVideoTask,
  checkPredictionStatus,
} from "./replicateService";
import { supabase } from '../lib/supabaseClient';
import type {
  VideoModel,
  ImageModel,
  VideoStyle,
  GenerationMode,
  VideoQuality,
  VideoDuration,
  VideoFps,
  VideoResolution,
} from "../types";

/**
 * ★ SERVER-SIDE FRAME EXTRACTION — Replaces browser canvas approach
 * The browser canvas method fails with CORS SecurityError on replicate.delivery URLs.
 * This calls the backend API which downloads the video server-side (no CORS) and
 * runs ffmpeg to extract the last frame as Base64 JPEG.
 */
async function extractLastFrameServerSide(videoUrl: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  console.log(`📸 [FrameExtract] Calling server-side frame extractor...`);

  const response = await fetch('/api/extract-frame', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`
    },
    body: JSON.stringify({ videoUrl })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Frame extraction failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  if (!data.frame) {
    throw new Error('Frame extraction returned no frame data');
  }

  // ★ Validate: frame MUST be a base64 data URL, not a raw video URL
  const frame = data.frame as string;
  const isVideoUrl = /\.(mp4|webm|mov|avi)/i.test(frame) || (frame.includes('replicate.delivery') && !frame.startsWith('data:'));
  if (isVideoUrl) {
    throw new Error(
      '⚠️ 尾帧截取失败（服务器无ffmpeg）。\n\n请在设置里切换到“wanvideo”模型重试，或联系客服升级为支持ffmpeg的服务器版本。'
    );
  }

  console.log(`✅ [FrameExtract] Server-side frame extraction success`);
  return data.frame;
}


export interface StoryboardShot {
  image_prompt: string;
  video_prompt?: string;         // legacy alias
  video_motion_prompt?: string;  // ★ backend field name (video_motion_prompt from Gemini API)
  transition?: "hard_cut" | "seamless";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 轮询等待视频生成完成并获取最终视频 URL
 * @param predictionId 模型生成任务的 ID
 */
async function waitForVideoCompletion(predictionId: string): Promise<string> {
  while (true) {
    await sleep(3000); // 轮询间隔：3秒
    const prediction = await checkPredictionStatus(predictionId);

    if (prediction.status === "succeeded") {
      const output = prediction.output;
      // Replicate 的输出可能是一个数组或字符串，这里提取首个 URL
      return typeof output === "string" ? output : output[0];
    }

    if (prediction.status === "failed" || prediction.status === "canceled") {
      throw new Error(
        `Video generation failed: ${prediction.error || "Task canceled"}`,
      );
    }
  }
}

/**
 * 运行“导演模式”的无缝串联生成工作流。
 * 执行逻辑：
 * 1. 遍历镜头，第一镜通过文本生成首帧图像。
 * 2. 后续镜头直接复用上一镜最后抽取的画面 (Base64) 作为这镜的首帧。
 * 3. 并发送为视频。
 * 4. 非最终镜，抽取最终视频画面的最后一帧，供下一次迭代使用。
 *
 * @param storyboard 故事板镜头数组，包含 image_prompt 和 video_prompt
 * @param characterAnchor 角色特征锚点
 * @returns 包含所有生成的连续视频 URL 数组
 */
export const generateSceneChain = async (
  sceneId: string,
  storyboard: any[],
  extractedAnchor: string,
  videoModel: VideoModel = 'hailuo_02_fast',  // ★ Now accepts user-selected model (default: hailuo)
  imageModel: ImageModel = 'flux', // ★ user-selected image model
  referenceImageBase64?: string, // ★ NEW: Fast forwarding base64 image reference to backend
  existingSceneUrls: Record<number, string> = {}, // ★ RESUME SUPPORT
  onProgress?: (data: {
    index: number;
    stage: string;
    imageUrl?: string;
    videoUrl?: string;
    predictionId?: string;
  }) => void
) => {
  let _previousVideoLastFrame: string | null = null; // Unused, but kept for TS compilation if needed
  let globalAutoAnchorBase64: string | null = null; // ★ 新增：全片霸权面部锚点
  const videoUrls: string[] = [];

  for (let i = 0; i < storyboard.length; i++) {
    const shot = storyboard[i];
    const sNum = shot.scene_number;
    let currentStartImage: string;

    console.log(`\n🎬 --- 开始制作第 ${i + 1} 镜 ---`);

    // ★ RESUME LOGIC: Check if this scene is already fully generated
    if (existingSceneUrls[sNum]) {
      console.log(`⏭️ [第 ${i + 1} 场] 检测到该场景已生成视频，跳过重新生成...`);
      const existingUrl = existingSceneUrls[sNum];
      videoUrls.push(existingUrl);

      if (onProgress) {
        onProgress({ index: i, stage: "video_done", videoUrl: existingUrl });
      }

      // ★ 核心一致性补救：如果我们因为缓存跳过了全片第一场的生成，必须设法找回它的起步图作为后续的人脸垫图
      if (i === 0 && !referenceImageBase64) {
        globalAutoAnchorBase64 = shot.image_url || null;
        console.log(`✅ [第 ${i + 1} 场 SKIP] 初始化霸权缓存首图: ${globalAutoAnchorBase64 ? '成功' : '失败'}`);
      }

      continue; // Skip the heavy generation part
    }

    // ★ 全片一致性升级：每个Scene生成新背景(Hard Cut)，但死死锁住首图的人脸！
    console.log(`🚀 [第 ${i + 1} 场] 正在强制使用 ${imageModel} 引擎生成该场景的新起步图...`);
    const masterFaceAnchor = referenceImageBase64 || globalAutoAnchorBase64;
    const imgPrompt = shot.image_prompt || shot.visual_description || `Cinematic shot, Scene ${i + 1}`;

    currentStartImage = await generateImage(
      imgPrompt,
      imageModel,
      "none",
      "16:9",
      extractedAnchor,
      masterFaceAnchor // ★ pass image so Pulid clones the face perfectly into new environment
    );

    // ★ 缓存全片第一帧人脸
    if (i === 0 && !referenceImageBase64) {
      globalAutoAnchorBase64 = currentStartImage;
      console.log(`✅ [第 ${i + 1} 场] 已自动嗅探全片首帧，将作为后续场景的绝对脸部基准垫图！`);
    }

    if (onProgress) {
      onProgress({ index: i, stage: "image_done", imageUrl: currentStartImage });
    }

    console.log(`🎥 [阶段 2] 发送视频生成请求: ${shot.video_prompt}`);
    if (onProgress) {
      onProgress({ index: i, stage: "video_starting" });
    }

    // ★ CRITICAL: Combine full visual context with the specific motion to prevent clothing/logic hallucinations
    const rawVideoPrompt = shot.video_motion_prompt || shot.video_prompt || shot.shot_type || `Cinematic motion, scene ${i + 1}`;
    const richContext = shot.image_prompt ? `Visual Context: ${shot.image_prompt}. ` : '';

    // 使用更自然的描述格式，避免触发API过滤
    const characterNote = extractedAnchor
      ? `Ensure main character matches identity: ${extractedAnchor}`
      : '';

    // 格式更自然，不使用"LOCK"等可能触发过滤的词汇
    const lockedVideoPrompt = `${richContext}Cinematic Action: ${rawVideoPrompt}. ${characterNote}`.trim();

    console.log(`🔒 [Shot ${i + 1}] Character anchor: ${characterNote ? 'ACTIVE' : 'NONE'}`);

    // 注意：这里所有的视频都统一锁定同一个模型（例如 hailuo_02_fast），保证运动物理引擎一致
    // 传入音频提示（如果shot有音频描述）
    const audioPrompt = shot.audio_description || shot.dialogue_text || '';
    const videoPrediction = await startVideoTask(
      lockedVideoPrompt,
      currentStartImage,
      videoModel,  // ★ Use user-selected model instead of hardcoded hailuo_02_fast
      "none" as VideoStyle,
      "storyboard" as GenerationMode,
      "standard" as VideoQuality,
      6 as unknown as VideoDuration,  // Fixed: use number 6 instead of string "6s"
      "24fps" as unknown as VideoFps,
      "720p" as VideoResolution,
      extractedAnchor,   // Still passed here so buildVideoInput can also append it
      "16:9",
      { audioPrompt }  // Pass audio prompt
    );

    if (onProgress) {
      onProgress({ index: i, stage: "video_polling", predictionId: videoPrediction.id });
    }

    // 这里 startVideoTask 只返回了任务的状态信息，我们需要轮询查询获得最终视频 URL
    const generatedVideoUrl = await waitForVideoCompletion(videoPrediction.id);
    videoUrls.push(generatedVideoUrl);
    console.log(`✅ [第 ${i + 1} 镜] 视频生成成功: ${generatedVideoUrl}`);

    if (onProgress) {
      onProgress({ index: i, stage: "video_done", videoUrl: generatedVideoUrl });
    }

    // 以前这里会提取尾帧给下一个Scene用，现在我们实施Hard Cut跳切场景，
    // 因此这里不再需要为了下一个Scene去提取尾帧。
    // 但是在这个闭环内，我们仍然留着日志打印完成。
  }

  console.log("🎉 全部锁链生成完毕，真正的一镜到底！");
  return videoUrls;
};
