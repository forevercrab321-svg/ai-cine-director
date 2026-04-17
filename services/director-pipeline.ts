import {
  generateImage,
  startVideoTask,
  checkPredictionStatus,
} from "./replicateService";
import { extractShotBible } from './shotBibleService';
import { validateVideoDrift } from './videoValidator';
import { supabase } from '../lib/supabaseClient';
import type {
  VideoModel,
  ImageModel,
  StoryEntity,
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

interface RateLimitLikeError extends Error {
  status?: number;
  code?: string;
  retryAfter?: number;
}

const parseRetryAfterFromMessage = (message?: string): number | undefined => {
  if (!message) return undefined;
  const zhMatch = message.match(/(\d+)\s*秒后/);
  if (zhMatch) return Number(zhMatch[1]);

  const enMatch = message.match(/(?:after|in)\s*(\d+)\s*(?:s|sec|secs|second|seconds)/i);
  if (enMatch) return Number(enMatch[1]);

  return undefined;
};

const isRateLimitError = (err: any): boolean => {
  const message = String(err?.message || '');
  return err?.status === 429
    || err?.code === 'RATE_LIMITED'
    || /rate\s*limit|too many|throttle|限流|请求过于频繁/i.test(message);
};

const getRetryDelayMs = (err: any, attempt: number): number => {
  const hintedSeconds = Number((err as RateLimitLikeError)?.retryAfter)
    || parseRetryAfterFromMessage((err as Error)?.message);

  if (Number.isFinite(hintedSeconds) && hintedSeconds > 0) {
    return Math.max(1000, hintedSeconds * 1000);
  }

  // Exponential backoff fallback: 2s, 4s, 8s...
  return Math.min(2000 * Math.pow(2, attempt), 12000);
};

async function withRateLimitRetry<T>(label: string, task: () => Promise<T>, maxRetries = 3): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await task();
    } catch (err: any) {
      if (!isRateLimitError(err) || attempt >= maxRetries) {
        throw err;
      }

      const delayMs = getRetryDelayMs(err, attempt);
      const retryAfterSec = Math.ceil(delayMs / 1000);
      console.warn(`⏳ [RateLimit] ${label} 被限流，${retryAfterSec} 秒后自动重试 (${attempt + 1}/${maxRetries})`);
      await sleep(delayMs);
      attempt += 1;
    }
  }
}

/**
 * 轮询等待视频生成完成并获取最终视频 URL
 * @param predictionId 模型生成任务的 ID
 */
async function waitForVideoCompletion(predictionId: string): Promise<string> {
  while (true) {
    await sleep(3000); // 轮询间隔：3秒
    const prediction = await withRateLimitRetry(
      `poll:${predictionId}`,
      () => checkPredictionStatus(predictionId),
      5
    );

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
  videoModel: VideoModel = 'wan_2_2_fast',  // ★ Now accepts user-selected model (default: wan)
  imageModel: ImageModel = 'flux', // ★ user-selected image model
  referenceImageBase64?: string, // ★ NEW: Fast forwarding base64 image reference to backend
  storyEntities: StoryEntity[] = [], // ★ NEW: pass locked entities to reinforce identity consistency
  existingSceneUrls: Record<number, string> = {}, // ★ RESUME SUPPORT
  onProgress?: (data: {
    index: number;
    stage: string;
    imageUrl?: string;
    videoUrl?: string;
    predictionId?: string;
  }) => void,
  generationMode: GenerationMode = 'storyboard'
) => {
  let _previousVideoLastFrame: string | null = null; // Unused, but kept for TS compilation if needed
  let globalAutoAnchorBase64: string | null = null; // ★ 新增：全片霸权面部锚点
  let globalTailFrameBase64: string | null = null; // ★ 全片连续基准：上一镜尾帧
  const videoUrls: string[] = [];
  const lockedCastLine = (storyEntities || [])
    .filter((e: any) => e?.is_locked && String(e?.type || '').toLowerCase() === 'character')
    .map((e: any) => `${e?.name || 'Character'}: ${e?.description || ''}`.trim())
    .filter(Boolean)
    .join(' | ');

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

      try {
        globalTailFrameBase64 = await extractLastFrameServerSide(existingUrl);
        if (i === 0 && !referenceImageBase64) {
          globalAutoAnchorBase64 = shot.image_url || globalTailFrameBase64 || null;
          console.log(`✅ [第 ${i + 1} 场 SKIP] 初始化全片连续锚点: ${globalAutoAnchorBase64 ? '成功' : '失败'}`);
        }
      } catch (extractErr: any) {
        console.warn(`⚠️ [第 ${i + 1} 场 SKIP] 已有视频尾帧提取失败: ${extractErr?.message || extractErr}`);
      }

      continue; // Skip the heavy generation part
    }

    if (i === 0 || !globalTailFrameBase64) {
      // ★ 首镜初始化：生图一次，建立全片连续锁链
      console.log(`🚀 [第 ${i + 1} 场] 正在使用 ${imageModel} 生成首镜起步图...`);
      const masterFaceAnchor = referenceImageBase64 || globalAutoAnchorBase64;
      const imgPrompt = shot.image_prompt || shot.visual_description || `Cinematic shot, Scene ${i + 1}`;

      currentStartImage = await withRateLimitRetry(
        `generateImage:scene-${i + 1}`,
        () => generateImage(
          imgPrompt,
          imageModel,
          "none",
          "16:9",
          extractedAnchor,
          masterFaceAnchor, // ★ pass image so Pulid clones the face perfectly into new environment
          storyEntities
        ),
        3
      );

      // ★ 缓存全片第一帧人脸
      if (i === 0 && !referenceImageBase64) {
        globalAutoAnchorBase64 = currentStartImage;
        console.log(`✅ [第 ${i + 1} 场] 已自动嗅探全片首帧，将作为后续场景的绝对脸部基准垫图！`);
      }
    } else {
      // ★ 全片无跳切：后续场次与镜头统一继承上一镜尾帧
      currentStartImage = globalTailFrameBase64;
      console.log(`🔗 [第 ${i + 1} 场] 继承上一镜尾帧作为起点（全片无跳切）`);
    }

    if (onProgress) {
      onProgress({ index: i, stage: "image_done", imageUrl: currentStartImage });
    }

    let anchorPackage = null;
    if (generationMode === 'strict_reference' && currentStartImage) {
      try {
        if (onProgress) onProgress({ index: i, stage: "extracting_bible" });
        console.log(`[ShotBible] Extracting strict constraints for Shot ${i + 1}...`);
        const { anchorPackage: pkg } = await extractShotBible(currentStartImage);
        anchorPackage = pkg;
      } catch (err) {
        console.error(`[ShotBible] Failed to extract bible, proceeding without strict anchor:`, err);
      }
    }

    let videoAttempts = 0;
    const maxVideoAttempts = (generationMode === 'strict_reference' && anchorPackage) ? 3 : 1;
    let finalVideoUrl = "";
    let finalTailFrame = null;
    let retryFeedbackPrompt = "";

    while (videoAttempts < maxVideoAttempts) {
      videoAttempts++;
      console.log(`🎥 [阶段 2] 发送视频生成请求 (Attempt ${videoAttempts}/${maxVideoAttempts})`);
      if (onProgress) onProgress({ index: i, stage: "video_starting" });

      // ── Use video_prompt set by composeAllPrompts() during shot planning.
      // All prompt construction lives in lib/shotPromptCompiler.ts.
      // Only append runtime context (cast lock, identity continuity) here —
      // these cannot be known at planning time.
      const baseVideoPrompt = shot.video_prompt || shot.video_motion_prompt || shot.shot_type || `Cinematic motion, scene ${i + 1}`;

      const castLockRule = lockedCastLine
        ? `[CAST LOCK - MUST FOLLOW EXACTLY] Start Cast Bible: ${lockedCastLine}.`
        : '';

      let lockedVideoPrompt = [
        baseVideoPrompt,
        '[IDENTITY CONTINUITY] Keep the exact same protagonist identity and costume as the provided first frame image.',
        castLockRule,
      ].filter(Boolean).join(' ').trim();

      if (retryFeedbackPrompt) {
        lockedVideoPrompt += `\nCRITICAL FIX NEEDED: ${retryFeedbackPrompt}`;
      }

      console.log(`🔒 [Shot ${i + 1}] Target Action: ${lockedVideoPrompt}`);

      const audioPrompt = shot.audio_description || shot.dialogue_text || '';
      const videoPrediction = await withRateLimitRetry(
        `startVideoTask:scene-${i + 1}`,
        () => startVideoTask(
          lockedVideoPrompt,
          currentStartImage,
          videoModel,
          "none" as VideoStyle,
          generationMode,
          "standard" as VideoQuality,
          6 as unknown as VideoDuration,
          "24fps" as unknown as VideoFps,
          "720p" as VideoResolution,
          extractedAnchor,
          "16:9",
          { audioPrompt, storyEntities, anchorPackage }
        ),
        3
      );

      if (onProgress) {
        onProgress({ index: i, stage: "video_polling", predictionId: videoPrediction.id });
      }

      const generatedVideoUrl = await waitForVideoCompletion(videoPrediction.id);

      if (generationMode === 'strict_reference' && anchorPackage) {
        try {
          if (onProgress) onProgress({ index: i, stage: "validating_video" });
          const tailFrame = await extractLastFrameServerSide(generatedVideoUrl);
          const validation = await validateVideoDrift(tailFrame, anchorPackage);

          console.log(`[Validator] Shot ${i + 1} Attempt ${videoAttempts} Score: ${validation.score} - ${validation.feedback}`);

          if (!validation.passed && videoAttempts < maxVideoAttempts) {
            console.warn(`[Validator] Video rejected (Score ${validation.score} < 85). Retrying...`);
            retryFeedbackPrompt = `PREVIOUS ATTEMPT FAILED INCORRECTLY: ${validation.feedback}. YOU MUST STRICTLY MATCH THE FIRST FRAME IMAGE IN EXACT ARCHITECTURE, SUBJECT, AND LIGHTING.`;
            // Keep the best logic would save the highest scored, but for simplicity we keep retrying and default to last one if fail.
            finalVideoUrl = generatedVideoUrl;
            finalTailFrame = tailFrame;
            continue;
          }
          finalVideoUrl = generatedVideoUrl;
          finalTailFrame = tailFrame;
          console.log(`✅ [第 ${i + 1} 镜] 视频通过 Validation: ${generatedVideoUrl}`);
          break;
        } catch (e: any) {
          console.warn(`[Validator] Failed to validate, accepting video:`, e.message);
          finalVideoUrl = generatedVideoUrl;
          break; // extract error or validation error -> assume success
        }
      } else {
        finalVideoUrl = generatedVideoUrl;
        break;
      }
    }

    videoUrls.push(finalVideoUrl);
    if (onProgress) {
      onProgress({ index: i, stage: "video_done", videoUrl: finalVideoUrl });
    }

    if (finalTailFrame) {
      globalTailFrameBase64 = finalTailFrame;
    } else {
      try {
        globalTailFrameBase64 = await extractLastFrameServerSide(finalVideoUrl);
      } catch (extractErr: any) {
        console.warn(`⚠️ [第 ${i + 1} 场] 尾帧提取失败，将在下一场回退锚点生图: ${extractErr?.message || extractErr}`);
        globalTailFrameBase64 = null;
      }
    }
  }

  console.log("🎉 全部锁链生成完毕，真正的一镜到底！");
  return videoUrls;
};
