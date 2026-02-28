import {
  generateImage,
  startVideoTask,
  checkPredictionStatus,
} from "./replicateService";
import { supabase } from '../lib/supabaseClient';
import type {
  VideoModel,
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

  if (data.fallback) {
    console.warn(`⚠️ [FrameExtract] ffmpeg unavailable, using raw URL fallback — backend will convert to Base64`);
  } else {
    console.log(`✅ [FrameExtract] Server-side frame extraction success`);
  }

  return data.frame;
}


export interface StoryboardShot {
  image_prompt: string;
  video_prompt: string;
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
  onProgress?: (data: {
    index: number;
    stage: string;
    imageUrl?: string;
    videoUrl?: string;
    predictionId?: string;
  }) => void
) => {
  let previousVideoLastFrame: string | null = null;
  const videoUrls: string[] = [];

  for (let i = 0; i < storyboard.length; i++) {
    const shot = storyboard[i];
    let currentStartImage: string;

    console.log(`\n🎬 --- 开始制作第 ${i + 1} 镜 ---`);
    if (i === 0) {
      console.log("🚀 [第一镜] 强制使用 Flux 引擎生成初始起步图...");
      const imgPrompt = shot.image_prompt || shot.visual_description || `Cinematic shot, Scene ${i + 1}`;
      currentStartImage = await generateImage(
        imgPrompt,
        "flux_schnell",
        "none",
        "16:9",
        extractedAnchor
      );
      if (onProgress) {
        onProgress({ index: i, stage: "image_done", imageUrl: currentStartImage });
      }
    } else {
      console.log(`🚀 [第 ${i + 1} 镜] 强制拦截！拒绝重新生图，直接读取上一镜的尾帧作为起步图！`);
      if (!previousVideoLastFrame) {
        console.error("❌ 严重错误：尾帧接力棒丢失！");
        throw new Error("无法获取上一镜头的尾帧，连续生成被迫终止。");
      }
      // 【强制写死】：绝对不允许在 i > 0 时调用 generateImage。必须使用 Base64 尾帧。
      currentStartImage = previousVideoLastFrame;
      if (onProgress) {
        onProgress({ index: i, stage: "image_done", imageUrl: currentStartImage });
      }
    }

    console.log(`🎥 [阶段 2] 发送视频生成请求: ${shot.video_prompt}`);
    if (onProgress) {
      onProgress({ index: i, stage: "video_starting" });
    }

    // ★ 双重死锁：1)视觉锁(尾帧图片) 2)文字锁(角色锚点注入 prompt)
    // 不允许只发动作描述！锚点必须焊入每一镜的 prompt，防止大模型角色幻觉
    const rawVideoPrompt = shot.video_prompt || shot.video_motion_prompt || `Cinematic motion, scene ${i + 1}`;
    const lockedVideoPrompt = extractedAnchor
      ? `${rawVideoPrompt}. IDENTITY LOCK: ${extractedAnchor}.`
      : rawVideoPrompt;

    console.log(`🔒 [Shot ${i + 1}] Locked prompt: ${lockedVideoPrompt.slice(0, 120)}...`);

    // 注意：这里所有的视频都统一锁定同一个模型（例如 hailuo_02_fast），保证运动物理引擎一致
    const videoPrediction = await startVideoTask(
      lockedVideoPrompt,
      currentStartImage,
      "hailuo_02_fast" as VideoModel,
      "none" as VideoStyle,
      "storyboard" as GenerationMode,
      "standard" as VideoQuality,
      "6s" as unknown as VideoDuration,
      "24fps" as unknown as VideoFps,
      "720p" as VideoResolution,
      extractedAnchor,   // Still passed here so buildVideoInput can also append it
      "16:9"
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

    // 【强制写死】：只要当前不是最后一个镜头，死等截帧完成！
    if (i < storyboard.length - 1) {
      console.log(`📸 [Shot ${i + 1}] 正在调用服务端截帧（绕过 CORS）...`);
      try {
        previousVideoLastFrame = await extractLastFrameServerSide(generatedVideoUrl);
        const frameType = previousVideoLastFrame.startsWith('data:') ? 'Base64' : 'URL';
        console.log(`✅ [Shot ${i + 1}] 尾帧截取成功 (${frameType})，Base64 长度: ${previousVideoLastFrame.length}`);
        console.log(`[Chain Check] Shot ${i + 2} will use tail frame: ${frameType}, size=${previousVideoLastFrame.length}, hasData=${previousVideoLastFrame.length > 100}`);
      } catch (frameErr: any) {
        console.error(`❌ [Shot ${i + 1}] 尾帧截取失败！错误: ${frameErr.message}`);
        console.error(`❌ 锁链将在第 ${i + 2} 镜断裂 — 中止执行。`);
        throw frameErr; // Propagate up — do NOT let chain continue silently
      }
    }
  }

  console.log("🎉 全部锁链生成完毕，真正的一镜到底！");
  return videoUrls;
};
