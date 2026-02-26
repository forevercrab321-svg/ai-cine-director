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
export async function runSeamlessStoryboard(
  storyboard: StoryboardShot[],
  characterAnchor: string,
): Promise<string[]> {
  const videoUrls: string[] = [];

  // 声明接力棒：保存上一个视频提取出的最后一帧（Base64 URL）
  let previousVideoLastFrame: string | null = null;

  for (let i = 0; i < storyboard.length; i++) {
    const shot = storyboard[i];
    let currentStartImage: string;

    try {
      console.log(
        `[Director Pipeline] 🎬 开始处理镜头 ${i + 1}/${storyboard.length}...`,
      );

      // 当 i === 0 (第一镜) 时
      if (i === 0) {
        console.log(`[Director Pipeline] 🖼️ (镜头 1) 正在生成初始图像...`);
        // 调用 generateImage，模型强制选择 'flux_schnell'，传入 characterAnchor
        currentStartImage = await generateImage(
          shot.image_prompt,
          "flux_schnell",
          "none", // videoStyle
          "16:9", // aspectRatio
          characterAnchor,
        );
      } else {
        // 当 i > 0 (后续镜头) 时
        console.log(
          `[Director Pipeline] 🔄 (镜头 ${i + 1}) 跳过生图步骤，复用上一镜头的最后一帧...`,
        );
        if (!previousVideoLastFrame) {
          throw new Error("上一镜头最后一帧提取失败或为空，无法进行无缝衔接。");
        }
        currentStartImage = previousVideoLastFrame;
      }

      // 紧接着调用 startVideoTask 生成视频
      console.log(`[Director Pipeline] 🎥 (镜头 ${i + 1}) 正在请求生成视频...`);

      const videoPrediction = await startVideoTask(
        shot.video_prompt,
        currentStartImage,
        "hailuo_02_fast" as VideoModel, // 模型强制锁定为 'hailuo_02_fast'
        "none" as VideoStyle, // 默认参数
        "fast" as GenerationMode, // 默认模式
        "standard" as VideoQuality, // 默认质量
        "6s" as VideoDuration, // 默认时长 (可以是 4, 6 或 8, 需视你的类型而定)
        "24fps" as VideoFps, // 默认帧率
        "720p" as VideoResolution, // 默认分辨率
        characterAnchor, // 必须传入 characterAnchor 确保角色一致
        "16:9", // 约束画幅比例
      );

      // 这里 startVideoTask 只返回了任务的状态信息，我们需要轮询查询获得最终视频 URL
      const finalVideoUrl = await waitForVideoCompletion(videoPrediction.id);
      videoUrls.push(finalVideoUrl);
      console.log(
        `[Director Pipeline] ✅ 镜头 ${i + 1} 视频生成完毕: ${finalVideoUrl}`,
      );

      // 当前不是最后一个镜头时，使用 Canvas 提取最后一帧
      if (i < storyboard.length - 1) {
        console.log(
          `[Director Pipeline] ✂️ 正在提取当前视频的最后一帧用于下一个镜头的起始帧...`,
        );
        // 提取返回 base64
        previousVideoLastFrame = await extractLastFrameFromVideo(finalVideoUrl);
        console.log(
          `[Director Pipeline] ✔️ 最后一帧提取成功，接力棒交接完毕！`,
        );
      }
    } catch (error) {
      console.error(
        `[Director Pipeline] ❌ 镜头 ${i + 1} 工作流中断执行抛错:`,
        error,
      );
      throw error; // 直接抛出以便前端 catch 报错给用户
    }
  }

  console.log(
    `[Director Pipeline] 🎉 导演模式短剧串联工作流执行完毕！共生成 ${videoUrls.length} 个镜头。`,
  );
  return videoUrls;
}
