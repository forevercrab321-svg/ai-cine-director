/**
 * Project — 项目定义
 *
 * 一个 Project 代表一部完整的影片/故事板项目，
 * 包含全局风格圣经、负面提示词以及所有角色包。
 */

import type { CharacterPack } from './characterPack';

/** 项目 */
export type Project = {
  /** 唯一标识 */
  id: string;
  /** 项目标题 */
  title: string;
  /** 全片统一风格 / 摄影语言 / 世界观描述 */
  styleBible: string;
  /** 全局禁用词 / 漂移禁止（negative prompt） */
  globalNegative: string;
  /** 项目中包含的所有角色包 */
  characterPacks: CharacterPack[];
};
