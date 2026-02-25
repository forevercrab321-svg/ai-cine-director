/**
 * CharacterPack — 角色包定义
 *
 * 每个角色包包含参考图、锁定特征描述和可选的风格 token，
 * 用于在多镜头/多段生成中保持角色一致性。
 */

/** 角色锁定特征（文字描述），确保跨镜头不漂移 */
export interface LockedTraits {
  /** 发型 / 发色 */
  hair: string;
  /** 面部特征 */
  face: string;
  /** 体型 / 身材 */
  body: string;
  /** 服装 / 配饰 */
  outfit: string;
}

/** 角色包 */
export type CharacterPack = {
  /** 唯一标识 */
  id: string;
  /** 角色名称 */
  name: string;
  /** 角色参考图资产 ID（正脸 / 半身 / 全身） */
  referenceImageAssetIds: string[];
  /** 锁定特征（文字描述），防止跨镜头漂移 */
  lockedTraits: LockedTraits;
  /** 角色相关的风格 token（可选） */
  styleTokens: string[];
};
