/**
 * promptBuilder — Prompt 编译器
 *
 * 将 Project / Shot / Segment / CharacterPack 编译为结构化的 Gemini prompt，
 * 用于指导视频生成模型生成单段镜头。
 *
 * 零外部依赖，纯字符串拼装。
 */

import type { Project } from '../models/project';
import type { Shot } from '../models/shot';
import type { Segment } from '../models/segment';
import type { CharacterPack } from '../models/characterPack';

// ─── 默认参数 ─────────────────────────────────────────────

const DEFAULT_IDENTITY_STRENGTH = 0.85;
const DEFAULT_STYLE_STRENGTH = 0.8;
const DEFAULT_MOTION_FREEDOM = 0.5;

// ─── 工具函数 ─────────────────────────────────────────────

/** 构建一个带标题的 prompt 模块 */
function section(title: string, body: string): string {
  return `[${title}]\n${body}`;
}

/** 安全取值：trim 后如果为空返回 "(none)" */
function safeText(value: string | undefined | null): string {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : '(none)';
}

/** 格式化数字，保留两位小数 */
function num(value: number | undefined, fallback: number): string {
  return (value ?? fallback).toFixed(2);
}

// ─── 各模块构建器 ─────────────────────────────────────────

function buildRoleSection(): string {
  return section(
    'ROLE',
    [
      '你是电影导演与摄影指导。',
      '你的目标是生成一个"单段视频镜头"的生成指令（给视频生成模型使用），',
      '强调角色与风格一致性。',
    ].join('\n'),
  );
}

function buildGlobalRulesSection(): string {
  return section(
    'GLOBAL RULES - STRICT',
    [
      '- 保持人物身份一致（脸、发型、身形、年龄感）',
      '- 保持服装一致（除非明确要求换装）',
      '- 保持风格一致（色调、光线、材质、镜头语言）',
      '- 不要增加新角色/新物体/新文字水印/字幕/Logo',
      '- 不要改变人物种族/性别/年龄',
      '- 不要出现畸形脸/多手/多指/扭曲身体',
      '- 画面稳定，不要闪烁、不要风格漂移',
    ].join('\n'),
  );
}

function buildProjectBibleSection(project: Project): string {
  return section('PROJECT BIBLE', safeText(project.styleBible));
}

function buildGlobalNegativeSection(project: Project): string {
  return section('GLOBAL NEGATIVE', safeText(project.globalNegative));
}

function buildCharacterLocksSection(characterPacks: CharacterPack[]): string {
  if (characterPacks.length === 0) {
    return section('CHARACTER LOCKS', '(no characters in this shot)');
  }

  const entries = characterPacks.map((cp, idx) => {
    const lines: string[] = [
      `Character #${idx + 1}: ${cp.name}`,
      `  Hair:   ${safeText(cp.lockedTraits.hair)}`,
      `  Face:   ${safeText(cp.lockedTraits.face)}`,
      `  Body:   ${safeText(cp.lockedTraits.body)}`,
      `  Outfit: ${safeText(cp.lockedTraits.outfit)}`,
    ];

    if (cp.referenceImageAssetIds.length > 0) {
      lines.push(`  Reference Assets: ${cp.referenceImageAssetIds.join(', ')}`);
    }

    if (cp.styleTokens.length > 0) {
      lines.push(`  Style Tokens: ${cp.styleTokens.join(', ')}`);
    }

    return lines.join('\n');
  });

  return section('CHARACTER LOCKS', entries.join('\n\n'));
}

function buildShotContextSection(shot: Shot): string {
  return section(
    'SHOT CONTEXT',
    [
      `Script: ${safeText(shot.script)}`,
      `Camera Spec: ${safeText(shot.cameraSpec)}`,
      `Involved Characters: ${shot.characterIds.length > 0 ? shot.characterIds.join(', ') : '(none)'}`,
    ].join('\n'),
  );
}

function buildSegmentContextSection(
  segment: Segment,
  startFrameHint?: { assetId?: string; path?: string; description?: string },
): string {
  const lines: string[] = [
    `Segment Index: ${segment.segmentIndex}`,
    `Duration: ${segment.durationSec}s`,
    `Identity Strength: ${num(segment.identityStrength, DEFAULT_IDENTITY_STRENGTH)}`,
    `Style Strength: ${num(segment.styleStrength, DEFAULT_STYLE_STRENGTH)}`,
    `Motion Freedom: ${num(segment.motionFreedom, DEFAULT_MOTION_FREEDOM)}`,
  ];

  let body = lines.join('\n');

  // 追加锚点帧信息（支持 assetId 或本地 path）
  if (startFrameHint && (startFrameHint.assetId || startFrameHint.path || startFrameHint.description)) {
    const anchorLines: string[] = [];
    if (startFrameHint.assetId) {
      anchorLines.push(`Asset ID: ${startFrameHint.assetId}`);
    }
    if (startFrameHint.path) {
      anchorLines.push(`Local Path: ${startFrameHint.path}`);
    }
    if (startFrameHint.description) {
      anchorLines.push(`Description: ${startFrameHint.description}`);
    }
    body += '\n\n' + section('ANCHOR START FRAME', anchorLines.join('\n'));
  }

  return section('SEGMENT CONTEXT', body);
}

function buildOutputFormatSection(): string {
  const jsonExample = [
    '{',
    '  "prompt": "<给视频生成模型的最终英文 prompt（一句到三句，专业镜头语言）>",',
    '  "negative_prompt": "<英文负面词（短句）>",',
    '  "notes": "<简短导演备注（可选，中英皆可）>"',
    '}',
  ].join('\n');

  return section(
    'OUTPUT FORMAT',
    [
      '请严格输出以下 JSON 格式（纯文本，不要 markdown code fence）：',
      '',
      jsonExample,
      '',
      '要求：',
      '- 三个字段必须齐全，不可省略',
      '- "prompt" 和 "negative_prompt" 必须使用英文',
      '- "notes" 可中英混合，尽量简短',
      '- 不要输出 JSON 以外的任何内容',
    ].join('\n'),
  );
}

// ─── 主入口 ───────────────────────────────────────────────

/**
 * 将 Project / Shot / Segment / CharacterPack 编译为 Gemini 最终 prompt。
 *
 * @param args.project         当前项目
 * @param args.shot            当前镜头
 * @param args.segment         当前片段
 * @param args.characterPacks  该 shot 涉及的角色包（已过滤）
 * @param args.startFrameHint  上一段末帧的锚点提示（可选）
 * @returns 结构化 prompt 字符串
 */
export function buildGeminiPrompt(args: {
  project: Project;
  shot: Shot;
  segment: Segment;
  characterPacks: CharacterPack[];
  startFrameHint?: {
    assetId?: string;
    path?: string;
    description?: string;
  };
}): string {
  const { project, shot, segment, characterPacks, startFrameHint } = args;

  const sections: string[] = [
    buildRoleSection(),
    buildGlobalRulesSection(),
    buildProjectBibleSection(project),
    buildGlobalNegativeSection(project),
    buildCharacterLocksSection(characterPacks),
    buildShotContextSection(shot),
    buildSegmentContextSection(segment, startFrameHint),
    buildOutputFormatSection(),
  ];

  return sections.join('\n\n');
}
