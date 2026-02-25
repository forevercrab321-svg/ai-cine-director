/**
 * Segment — 片段定义
 *
 * 一个 Shot 可能被拆分为多个 Segment（例如每段 ≤ 5 秒），
 * 每段通过首尾帧锚点串联，保证镜头内的连贯性。
 */

/** 片段 */
export type Segment = {
  /** 唯一标识 */
  id: string;
  /** 所属镜头 ID */
  shotId: string;
  /** 所属项目 ID */
  projectId: string;
  /** 该片段在镜头内的序号（从 0 开始） */
  segmentIndex: number;
  /** 片段实际时长（秒） */
  durationSec: number;

  // ─── 锚点帧 ───────────────────────────────────────────
  /** 传递锚点：上一段末帧的资产 ID（首段可为空） */
  startFrameAssetId?: string;
  /** 生成后抽取的末帧资产 ID，用于传递给下一段 */
  endFrameAssetId?: string;

  // ─── 锚点帧（本地路径版） ─────────────────────────────
  /** 下一段用的锚点起始帧（本地 png 路径） */
  startFramePath?: string;
  /** 当前段抽取的末帧（本地 png 路径） */
  endFramePath?: string;

  // ─── 生成参数 ─────────────────────────────────────────
  /** 最终编译出来的 prompt（系统生成，不由用户直接填写） */
  prompt?: string;
  /** 随机种子，用于复现 */
  seed?: number;
  /** 角色一致性强度 0~1 */
  identityStrength?: number;
  /** 风格一致性强度 0~1 */
  styleStrength?: number;
  /** 运动自由度 0~1（值越高，AI 可自由发挥的空间越大） */
  motionFreedom?: number;

  // ─── 产出 ─────────────────────────────────────────────
  /** 该段生成的视频资产 ID */
  outputVideoAssetId?: string;
  /** 当前段输出视频（本地 mp4 路径） */
  outputVideoPath?: string;
};
