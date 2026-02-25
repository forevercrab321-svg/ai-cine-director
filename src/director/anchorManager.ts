/**
 * anchorManager — 锚点管理器（本地路径版）
 *
 * 负责从生成的视频中抽取末帧（end frame），并将其作为下一段的
 * startFrame，实现"火车接车厢"式的帧级串联。
 *
 * 本模块使用本地文件路径（而非远程 assetId），适合本地开发 / CLI 工作流。
 * 未来接入上传服务后，可同时保留 assetId 字段做云端兼容。
 *
 * 依赖：系统级 ffmpeg（通过 child_process 调用），零 npm 依赖。
 */

import { exec } from 'node:child_process';
import { join } from 'node:path';
import type { Segment } from '../models/segment';

// ─── ffmpeg 可用性检查 ────────────────────────────────────

/**
 * 检查当前环境是否安装了 ffmpeg。
 * 如果 `ffmpeg -version` 执行失败，抛出友好错误。
 */
export async function ensureFfmpegAvailable(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    exec('ffmpeg -version', (error) => {
      if (error) {
        reject(
          new Error(
            'ffmpeg not found. Please install ffmpeg and ensure it is in PATH.',
          ),
        );
      } else {
        resolve();
      }
    });
  });
}

// ─── 末帧抽取 ─────────────────────────────────────────────

/**
 * 使用 ffmpeg 从视频文件抽取最后一帧并保存为 PNG。
 *
 * 命令：
 *   ffmpeg -y -sseof -0.05 -i <input> -frames:v 1 <output>
 *
 * @throws 抽帧失败时抛出 Error，携带 command 和 stderr 信息
 */
export async function extractLastFrameToPng(args: {
  inputVideoPath: string;
  outputPngPath: string;
}): Promise<void> {
  const { inputVideoPath, outputPngPath } = args;

  await ensureFfmpegAvailable();

  const command = `ffmpeg -y -sseof -0.05 -i "${inputVideoPath}" -frames:v 1 "${outputPngPath}"`;

  return new Promise<void>((resolve, reject) => {
    exec(command, (error, _stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `extractLastFrameToPng failed.\n` +
              `  Command: ${command}\n` +
              `  Stderr:  ${stderr?.trim() ?? '(empty)'}`,
          ),
        );
      } else {
        resolve();
      }
    });
  });
}

// ─── 路径推导 ─────────────────────────────────────────────

/**
 * 根据 outputDir 和 segmentId 推导末帧 PNG 的存放路径。
 * 使用 path.join 保证跨平台兼容。
 *
 * @example deriveEndFramePath({ outputDir: 'tmp', segmentId: 'seg_001' })
 *          // => 'tmp/seg_001_end.png'
 */
export function deriveEndFramePath(args: {
  outputDir: string;
  segmentId: string;
}): string {
  return join(args.outputDir, `${args.segmentId}_end.png`);
}

// ─── 锚点构建（本地路径版）────────────────────────────────

/**
 * 根据上一段 Segment 的 endFramePath 构建 startFrameHint。
 *
 * @param args.prevSegment 上一段 Segment（可选）
 * @returns startFrameHint 对象，或 undefined（首段无前驱时）
 */
export function buildNextStartFrameHint(args: {
  prevSegment?: Segment;
}): { path?: string; description?: string } | undefined {
  const { prevSegment } = args;

  if (!prevSegment || !prevSegment.endFramePath) {
    return undefined;
  }

  return {
    path: prevSegment.endFramePath,
    description:
      'Use previous segment end frame as anchor start frame to preserve identity and style.',
  };
}

// ─── Segment 不可变更新 ───────────────────────────────────

/**
 * 返回一个新 Segment 对象，其 startFramePath 被更新。
 * **不会 mutate 原对象。**
 *
 * @param args.segment        原始 Segment
 * @param args.startFramePath 要写入的起始帧本地路径（可选）
 * @returns 新 Segment（浅拷贝 + 覆盖 startFramePath）
 */
export function applyStartFrameToSegment(args: {
  segment: Segment;
  startFramePath?: string;
}): Segment {
  const { segment, startFramePath } = args;

  return {
    ...segment,
    ...(startFramePath !== undefined ? { startFramePath } : {}),
  };
}
