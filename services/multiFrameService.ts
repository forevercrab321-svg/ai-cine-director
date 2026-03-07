/**
 * 多帧关键帧视频生成服务
 * 实现类似 Runway/Kling 的多帧链接生成
 */

import { VideoModel, VideoOptions, VideoDuration } from '../types';
import { generateVideo, extractLastFrameWithFallback, type ReplicateResponse } from './replicateService';

export interface MultiFrameOptions {
  frames: {
    imageUrl?: string;      // 关键帧图片URL
    prompt: string;         // 该段视频的描述
    duration?: VideoDuration; // 时长 (6或10秒)
  }[];
  model: VideoModel;
  aspectRatio?: string;
  characterAnchor?: string;
  startImageUrl?: string;
  continuityMode?: 'link' | 'independent'; // link: 链式继承, independent: 独立生成
}

export interface FrameResult {
  frameIndex: number;
  videoUrl: string;
  lastFrameUrl: string;
  success: boolean;
  error?: string;
  replicateResponse?: ReplicateResponse;
}

/**
 * 多帧链式生成主函数
 * 
 * @param options 多帧选项
 * @param onProgress 进度回调 (frameIndex, status)
 * @returns 每帧的结果数组
 */
export async function generateMultiFrameVideo(
  options: MultiFrameOptions,
  onProgress?: (frameIndex: number, status: 'generating' | 'extracting' | 'done' | 'error', message?: string) => void
): Promise<FrameResult[]> {
  const results: FrameResult[] = [];
  let previousFrameUrl: string | undefined = undefined;

  console.log(`[MultiFrame] Starting generation with ${options.frames.length} frames, mode: ${options.continuityMode || 'link'}`);

  for (let i = 0; i < options.frames.length; i++) {
    const frame = options.frames[i];
    console.log(`[MultiFrame] Processing frame ${i + 1}/${options.frames.length}`);

    try {
      onProgress?.(i, 'generating', `Generating video ${i + 1}...`);

      // 确定起始图片
      let startImage: string | undefined;
      
      if (options.continuityMode === 'link' && previousFrameUrl) {
        // 链式模式: 使用上一帧的尾帧
        startImage = previousFrameUrl;
        console.log(`[MultiFrame] Frame ${i + 1}: Using previous frame as start image`);
      } else if (frame.imageUrl) {
        // 使用用户指定的关键帧
        startImage = frame.imageUrl;
        console.log(`[MultiFrame] Frame ${i + 1}: Using user-provided keyframe`);
      } else if (options.startImageUrl && i === 0) {
        // 第一帧使用全局起始图
        startImage = options.startImageUrl;
      }

      // 如果是链式模式，添加一致性提示词
      let enhancedPrompt = frame.prompt;
      if (startImage && options.continuityMode === 'link') {
        enhancedPrompt = `🎬 CONTINUITY: This video continues from the previous frame. ` +
          `Maintain EXACT same character appearance, clothing, and scene. ` +
          `Smooth transition from previous frame. ` +
          `${frame.prompt}`;
      }

      // 生成视频
      const videoResult = await generateVideo(
        options.model,
        enhancedPrompt,
        startImage,
        {
          duration: frame.duration || 6,
          aspectRatio: options.aspectRatio || '16:9',
          characterAnchor: options.characterAnchor,
          promptEngineVersion: 'v1'
        }
      );

      console.log(`[MultiFrame] Frame ${i + 1} generated, status: ${videoResult.status}`);

      if (videoResult.status === 'succeeded' && videoResult.output) {
        // 获取输出视频URL
        const videoUrl = Array.isArray(videoResult.output) 
          ? videoResult.output[0] 
          : videoResult.output;

        let lastFrameUrl: string = '';

        // 提取尾帧 (除非是最后一帧且用户选择不提取)
        if (i < options.frames.length - 1 || options.continuityMode === 'link') {
          onProgress?.(i, 'extracting', 'Extracting last frame for continuity...');
          try {
            lastFrameUrl = await extractLastFrameWithFallback(videoUrl);
            console.log(`[MultiFrame] Frame ${i + 1}: Last frame extracted successfully`);
          } catch (err: any) {
            console.warn(`[MultiFrame] Frame ${i + 1}: Failed to extract last frame:`, err.message);
            // 不阻塞生成过程，只是记录警告
          }
        }

        previousFrameUrl = lastFrameUrl;

        results.push({
          frameIndex: i,
          videoUrl,
          lastFrameUrl,
          success: true,
          replicateResponse: videoResult
        });

        onProgress?.(i, 'done', 'Frame generated successfully');
      } else {
        const errorMsg = videoResult.error || 'Video generation failed';
        console.error(`[MultiFrame] Frame ${i + 1} failed:`, errorMsg);
        
        results.push({
          frameIndex: i,
          videoUrl: '',
          lastFrameUrl: '',
          success: false,
          error: errorMsg
        });

        onProgress?.(i, 'error', errorMsg);

        // 如果是链式模式，一帧失败可能导致后续帧无法生成
        if (options.continuityMode === 'link') {
          console.warn('[MultiFrame] Chain broken due to frame failure, stopping generation');
          break;
        }
      }

    } catch (err: any) {
      console.error(`[MultiFrame] Frame ${i + 1} exception:`, err);
      
      results.push({
        frameIndex: i,
        videoUrl: '',
        lastFrameUrl: '',
        success: false,
        error: err.message
      });

      onProgress?.(i, 'error', err.message);

      if (options.continuityMode === 'link') {
        break;
      }
    }
  }

  console.log(`[MultiFrame] Completed. Success: ${results.filter(r => r.success).length}/${results.length}`);
  return results;
}

/**
 * 从已有视频列表生成链式视频
 * 适用于用户已有多个视频，需要把它们链接起来的情况
 */
export async function chainExistingVideos(
  videoUrls: string[],
  options: {
    model: VideoModel;
    aspectRatio?: string;
    characterAnchor?: string;
  },
  onProgress?: (index: number, status: 'extracting' | 'done', message?: string) => void
): Promise<FrameResult[]> {
  const results: FrameResult[] = [];

  for (let i = 0; i < videoUrls.length; i++) {
    onProgress?.(i, 'extracting', `Extracting frame ${i + 1}...`);

    try {
      const lastFrameUrl = await extractLastFrameWithFallback(videoUrls[i]);
      
      results.push({
        frameIndex: i,
        videoUrl: videoUrls[i],
        lastFrameUrl,
        success: true
      });

      onProgress?.(i, 'done', 'Frame extracted');
    } catch (err: any) {
      console.warn(`[ChainVideos] Failed to extract frame ${i + 1}:`, err.message);
      
      results.push({
        frameIndex: i,
        videoUrl: videoUrls[i],
        lastFrameUrl: '',
        success: false,
        error: err.message
      });
    }
  }

  return results;
}
