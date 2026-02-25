/**
 * E2E pipeline test: Plan → Prompt → Anchor Chaining
 *
 * npx tsx scripts/testFullPipeline.ts
 */

import { planSegmentsForShot } from '../src/director/segmentPlanner';
import { buildGeminiPrompt } from '../src/director/promptBuilder';
import { buildNextStartFrameHint, applyStartFrameToSegment } from '../src/director/anchorManager';
import type { Project } from '../src/models/project';
import type { Shot } from '../src/models/shot';
import type { Segment } from '../src/models/segment';

const project: Project = {
  id: 'p1',
  title: 'Test',
  styleBible: 'Neo-noir warm tungsten',
  globalNegative: 'blurry, watermark',
  characterPacks: [
    {
      id: 'c1',
      name: 'Lin',
      referenceImageAssetIds: ['ref-1'],
      lockedTraits: { hair: 'black', face: 'asian female', body: 'slim', outfit: 'coat' },
      styleTokens: ['film grain'],
    },
  ],
};

const shot: Shot = {
  id: 'sh1',
  projectId: 'p1',
  order: 0,
  script: 'Lin walks into cafe',
  cameraSpec: '35mm dolly',
  durationTargetSec: 14,
  characterIds: ['c1'],
};

console.log('=== Full Pipeline E2E Test ===\n');

// 1) Plan segments
const segments = planSegmentsForShot({ project, shot });
console.log('1) Segments planned:', segments.length, segments.length === 3 ? '✅' : '❌');

// 2) Simulate anchor chaining across segments
let prevSeg: Segment | undefined = undefined;
for (const seg of segments) {
  const hint = buildNextStartFrameHint({ prevSegment: prevSeg });
  const prompt = buildGeminiPrompt({
    project,
    shot,
    segment: seg,
    characterPacks: project.characterPacks,
    startFrameHint: hint ? { path: hint.path, description: hint.description } : undefined,
  });

  const anchorOk =
    seg.segmentIndex === 0
      ? hint === undefined
        ? '✅'
        : '❌'
      : hint !== undefined
        ? '✅'
        : '❌';

  console.log(
    `2) Seg #${seg.segmentIndex}: prompt ${prompt.length} chars, anchor=${!!hint} ${anchorOk}`,
  );

  // Simulate: after generation, set endFramePath on this segment
  prevSeg = { ...seg, endFramePath: `/tmp/${seg.id}_end.png` };
}

// 3) Test applyStartFrameToSegment immutability
const updated = applyStartFrameToSegment({
  segment: segments[1],
  startFramePath: '/tmp/anchor.png',
});
console.log(
  '3) Apply anchor:',
  updated.startFramePath === '/tmp/anchor.png' ? '✅' : '❌',
);
console.log(
  '   Immutable:',
  segments[1].startFramePath === undefined ? '✅' : '❌',
);

console.log('\n=== Full Pipeline OK ===');
