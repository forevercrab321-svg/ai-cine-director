/**
 * testPromptBuilder — PromptBuilder 最小可运行测试
 *
 * 用法：
 *   npx tsx scripts/testPromptBuilder.ts
 *
 * 构造 mock 数据，验证 buildGeminiPrompt 输出的结构化 prompt。
 */

import type { Project } from '../src/models/project';
import type { Shot } from '../src/models/shot';
import type { CharacterPack } from '../src/models/characterPack';
import { planSegmentsForShot } from '../src/director/segmentPlanner';
import { buildGeminiPrompt } from '../src/director/promptBuilder';

// ─── Mock 数据 ────────────────────────────────────────────

const mockCharacter: CharacterPack = {
  id: 'char-lin',
  name: 'Lin',
  referenceImageAssetIds: ['asset-lin-front', 'asset-lin-half', 'asset-lin-full'],
  lockedTraits: {
    hair: 'Shoulder-length black hair, slightly wavy, side-parted',
    face: 'East-Asian female, mid-20s, soft jawline, dark brown eyes',
    body: 'Slim build, 165cm, graceful posture',
    outfit: 'Charcoal wool coat over cream turtleneck, black trousers',
  },
  styleTokens: ['film grain', 'warm tungsten', 'shallow DOF'],
};

const mockProject: Project = {
  id: 'proj-noir-001',
  title: 'Café Noir',
  styleBible:
    'Neo-noir aesthetic with warm tungsten interior lighting.\n' +
    'Shoot on anamorphic 2.39:1. Shallow depth of field.\n' +
    'Desaturated palette with selective amber highlights.',
  globalNegative:
    'blurry, low quality, watermark, text overlay, cartoon, anime, ' +
    'deformed fingers, extra limbs, neon colors',
  characterPacks: [mockCharacter],
};

const mockShot: Shot = {
  id: 'shot-open-001',
  projectId: mockProject.id,
  order: 0,
  script:
    'Lin pushes open the heavy wooden door of the café. ' +
    'Warm light spills onto the rainy street behind her. ' +
    'She pauses at the threshold, scanning the dim interior.',
  cameraSpec: 'Medium close-up, eye-level, 40mm anamorphic, slow dolly in',
  durationTargetSec: 14,
  characterIds: [mockCharacter.id],
};

// ─── 执行 ────────────────────────────────────────────────

console.log('=== PromptBuilder 测试 ===\n');

// 1) 拆段
const segments = planSegmentsForShot({
  project: mockProject,
  shot: mockShot,
});

console.log(`Shot "${mockShot.id}" (${mockShot.durationTargetSec}s) → ${segments.length} segments\n`);

// 2) 对第 0 段编译 prompt
const firstSegment = segments[0];
const prompt = buildGeminiPrompt({
  project: mockProject,
  shot: mockShot,
  segment: firstSegment,
  characterPacks: [mockCharacter],
  startFrameHint: {
    description: 'Rainy street exterior, door slightly ajar, warm light leaking out',
  },
});

console.log('─'.repeat(60));
console.log('Segment #0 — compiled prompt:');
console.log('─'.repeat(60));
console.log(prompt);
console.log('─'.repeat(60));

// 3) 对第 1 段（无锚点）也编译一下做对比
if (segments.length > 1) {
  const secondPrompt = buildGeminiPrompt({
    project: mockProject,
    shot: mockShot,
    segment: segments[1],
    characterPacks: [mockCharacter],
    // 无 startFrameHint
  });

  console.log('\nSegment #1 — compiled prompt (no anchor):');
  console.log('─'.repeat(60));
  console.log(secondPrompt);
  console.log('─'.repeat(60));
}
