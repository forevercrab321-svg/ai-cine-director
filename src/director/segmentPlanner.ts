/**
 * segmentPlanner — "火车车厢规划器"
 *
 * 负责把一个 Shot（镜头）按目标时长拆分为多个 Segment（片段），
 * 每段通过首尾帧锚点串联，实现平滑过渡。
 *
 * 零外部依赖，仅使用 TypeScript 类型和 Node / 浏览器内置 API。
 */

import type { Project } from '../models/project';
import type { Shot } from '../models/shot';
import type { Segment } from '../models/segment';

// ─── 默认生成参数 ─────────────────────────────────────────
const DEFAULT_SEGMENT_SEC = 6;
const DEFAULT_IDENTITY_STRENGTH = 0.85;
const DEFAULT_STYLE_STRENGTH = 0.8;
const DEFAULT_MOTION_FREEDOM = 0.5;

/** 生成一个 UUID，环境不支持则降级为拼接字符串 */
function generateId(shotId: string, segmentIndex: number): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `${shotId}-${segmentIndex}-${Date.now()}`;
  }
}

// ─── planSegmentsForShot ──────────────────────────────────

/**
 * 将单个 Shot 拆分为多个 Segment。
 *
 * 拆分规则：
 * - 每段不超过 defaultSegmentSec 秒
 * - 最后一段取剩余时长（最少 1 秒）
 * - 各段按 segmentIndex 升序排列
 *
 * @param args.project       当前项目（预留，后续可用于注入 styleBible 等）
 * @param args.shot          要拆分的镜头
 * @param args.defaultSegmentSec 每段默认时长（秒），默认 6
 * @returns 按 segmentIndex 排序的 Segment 数组
 */
export function planSegmentsForShot(args: {
  project: Project;
  shot: Shot;
  defaultSegmentSec?: number;
}): Segment[] {
  const { project, shot, defaultSegmentSec = DEFAULT_SEGMENT_SEC } = args;

  const totalSec = shot.durationTargetSec;
  const segmentCount = Math.max(1, Math.ceil(totalSec / defaultSegmentSec));

  const segments: Segment[] = [];
  let remaining = totalSec;

  for (let i = 0; i < segmentCount; i++) {
    // 前面段用 defaultSegmentSec，最后一段取剩余（至少 1 秒）
    const isLast = i === segmentCount - 1;
    const duration = isLast ? Math.max(1, remaining) : defaultSegmentSec;

    segments.push({
      id: generateId(shot.id, i),
      shotId: shot.id,
      projectId: shot.projectId,
      segmentIndex: i,
      durationSec: duration,

      // 锚点帧 — 由后续流程填充
      startFrameAssetId: undefined,
      endFrameAssetId: undefined,

      // 生成参数 — 给予合理默认值
      prompt: undefined,
      seed: undefined,
      identityStrength: DEFAULT_IDENTITY_STRENGTH,
      styleStrength: DEFAULT_STYLE_STRENGTH,
      motionFreedom: DEFAULT_MOTION_FREEDOM,

      // 产出
      outputVideoAssetId: undefined,
    });

    remaining -= duration;
  }

  return segments;
}

// ─── planSegmentsForProject ───────────────────────────────

/**
 * 对项目中所有 Shot 进行拆段，按 shot.order → segmentIndex 排序返回。
 *
 * @param args.project           当前项目
 * @param args.shots             需要拆分的镜头列表
 * @param args.defaultSegmentSec 每段默认时长（秒），默认 6
 * @returns 所有 Segment 的有序数组
 */
export function planSegmentsForProject(args: {
  project: Project;
  shots: Shot[];
  defaultSegmentSec?: number;
}): Segment[] {
  const { project, shots, defaultSegmentSec } = args;

  // 按 order 升序排列
  const sortedShots = [...shots].sort((a, b) => a.order - b.order);

  const allSegments: Segment[] = [];

  for (const shot of sortedShots) {
    const segments = planSegmentsForShot({ project, shot, defaultSegmentSec });
    allSegments.push(...segments);
  }

  return allSegments;
}
