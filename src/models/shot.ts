/**
 * Shot — 镜头定义
 *
 * 一个 Shot 对应影片中的一个镜头，
 * 描述该镜头的剧本内容、摄影规格和涉及的角色。
 */

/** 镜头 */
export type Shot = {
  /** 唯一标识 */
  id: string;
  /** 所属项目 ID */
  projectId: string;
  /** 镜头在时间线中的顺序（从 0 开始） */
  order: number;
  /** 这一镜头发生什么（剧本描述） */
  script: string;
  /** 景别 / 机位 / 镜头 / 运镜规格 */
  cameraSpec: string;
  /** 目标时长（秒），例如 6 */
  durationTargetSec: number;
  /** 该 shot 涉及的角色包 ID 列表 */
  characterIds: string[];
};
