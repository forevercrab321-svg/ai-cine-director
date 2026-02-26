import {
  generateImage,
  startVideoTask,
  checkPredictionStatus,
} from "./replicateService";
import { extractLastFrameFromVideo } from "../utils/video-helpers";
import type {
  VideoModel,
  VideoStyle,
  GenerationMode,
  VideoQuality,
  VideoDuration,
  VideoFps,
  VideoResolution,
} from "../types";

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
  let tailFrameBase64: string | null = null;
  const videoUrls: string[] = [];

  for (let i = 0; i < storyboard.length; i++) {
    const shot = storyboard[i];
    let currentStartImage: string;

    console.log(`\n🎬 --- 开始制作第 ${i + 1} 镜 ---`);
    if (i === 0) {
      console.log("🎨 [阶段 1] 第一镜：使用 Flux 生成世界源头图...");
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
      console.log("🔗 [阶段 1] 延续镜头：跳过生图，强行读取上一段视频尾帧...");
      if (!tailFrameBase64) throw new Error("链条断裂：未能获取到上一镜尾帧");
      currentStartImage = tailFrameBase64;
      if (onProgress) {
        onProgress({ index: i, stage: "image_done", imageUrl: currentStartImage });
      }
    }

    console.log(`🎥 [阶段 2] 发送视频生成请求: ${shot.video_prompt}`);
    if (onProgress) {
      onProgress({ index: i, stage: "video_starting" });
    }

    // 注意：这里所有的视频都统一锁定同一个模型（例如 hailuo_02_fast），保证运动物理引擎一致
    const videoPrediction = await startVideoTask(
      shot.video_prompt,
      currentStartImage,
      "hailuo_02_fast" as VideoModel,
      "none" as VideoStyle,
      "fast" as GenerationMode,
      "standard" as VideoQuality,
      "6s" as unknown as VideoDuration,
      "24fps" as unknown as VideoFps,
      "720p" as VideoResolution,
      extractedAnchor,
      "16:9"
    );

    if (onProgress) {
      onProgress({ index: i, stage: "video_polling", predictionId: videoPrediction.id });
    }

    // 这里 startVideoTask 只返回了任务的状态信息，我们需要轮询查询获得最终视频 URL
    const videoUrl = await waitForVideoCompletion(videoPrediction.id);
    videoUrls.push(videoUrl);
    console.log(`✅ [阶段 3] 第 ${i + 1} 镜视频生成完毕: ${videoUrl}`);

    if (onProgress) {
      onProgress({ index: i, stage: "video_done", videoUrl });
    }

    // 只要不是最后一个镜头，就死等截取尾帧
    if (i < storyboard.length - 1) {
      console.log(`📸 [阶段 4] 正在静默截取当前视频最后 0.1 秒的画面，制作接力棒...`);
      tailFrameBase64 = await extractLastFrameFromVideo(videoUrl);
      console.log(`✅ 尾帧接力棒制作成功，准备进入下一镜。\n`);
    }
  }

  console.log("🎉 全部锁链生成完毕，真正的一镜到底！");
  return videoUrls;
};
