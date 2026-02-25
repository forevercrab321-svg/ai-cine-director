/**
 * planSegments — 最小可运行测试脚本
 *
 * 用法：
 *   npx tsx scripts/planSegments.ts
 *
 * 构造 mock 数据，验证 planSegmentsForProject 的拆段结果。
 */

import type { Project } from '../src/models/project';
import type { Shot } from '../src/models/shot';
import { planSegmentsForProject } from '../src/director/segmentPlanner';

// ─── Mock 数据 ────────────────────────────────────────────

const mockProject: Project = {
  id: 'proj-001',
  title: 'Test Film',
  styleBible: 'Cinematic, warm tones, shallow depth of field',
  globalNegative: 'blurry, low quality, watermark',
  characterPacks: [],
};

const mockShots: Shot[] = [
  {
    id: 'shot-001',
    projectId: mockProject.id,
    order: 0,
    script: 'A woman walks into a dimly lit café.',
    cameraSpec: 'Medium shot, eye-level, 35mm lens, slow dolly in',
    durationTargetSec: 6,
    characterIds: [],
  },
  {
    id: 'shot-002',
    projectId: mockProject.id,
    order: 1,
    script: 'She sits down, orders coffee, and notices a stranger.',
    cameraSpec: 'Wide shot → close-up rack focus, 50mm lens, static → pan',
    durationTargetSec: 14,
    characterIds: [],
  },
];

// ─── 执行 ────────────────────────────────────────────────

console.log('=== planSegmentsForProject 测试 ===\n');

const segments = planSegmentsForProject({
  project: mockProject,
  shots: mockShots,
});

console.log(`总镜头数: ${mockShots.length}`);
console.log(`总片段数: ${segments.length}\n`);

for (const seg of segments) {
  console.log(
    `  [shot=${seg.shotId}] segment #${seg.segmentIndex}  duration=${seg.durationSec}s` +
      `  identity=${seg.identityStrength}  style=${seg.styleStrength}  motion=${seg.motionFreedom}`
  );
}

// ─── 简单断言 ────────────────────────────────────────────

const shot1Segments = segments.filter((s) => s.shotId === 'shot-001');
const shot2Segments = segments.filter((s) => s.shotId === 'shot-002');

console.log(`\n--- 验证 ---`);
console.log(`Shot 1 (6s)  → ${shot1Segments.length} 段  [期望 1]  ${shot1Segments.length === 1 ? '✅' : '❌'}`);
console.log(`Shot 2 (14s) → ${shot2Segments.length} 段  [期望 3]  ${shot2Segments.length === 3 ? '✅' : '❌'}`);

const shot2Durations = shot2Segments.map((s) => s.durationSec);
console.log(`Shot 2 各段时长: ${shot2Durations.join(' + ')} = ${shot2Durations.reduce((a, b) => a + b, 0)}s  [期望 14s]`);

const totalDuration = segments.reduce((sum, s) => sum + s.durationSec, 0);
const expectedTotal = mockShots.reduce((sum, s) => sum + s.durationTargetSec, 0);
console.log(`总时长: ${totalDuration}s  [期望 ${expectedTotal}s]  ${totalDuration === expectedTotal ? '✅' : '❌'}`);
