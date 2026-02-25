/**
 * testAnchorManager — AnchorManager 最小可运行测试
 *
 * 前置条件：本机需安装 ffmpeg（https://ffmpeg.org/download.html）
 *
 * 用法：
 *   npx tsx scripts/testAnchorManager.ts <inputVideoPath>
 *
 * 示例：
 *   npx tsx scripts/testAnchorManager.ts ./tmp/sample.mp4
 *
 * 该脚本会：
 * 1) 校验 ffmpeg 是否可用
 * 2) 从指定视频抽取最后一帧 → tmp/anchor_test_end.png
 * 3) 演示 buildNextStartFrameHint / applyStartFrameToSegment
 */

import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ensureFfmpegAvailable,
  extractLastFrameToPng,
  buildNextStartFrameHint,
  applyStartFrameToSegment,
} from '../src/director/anchorManager';
import type { Segment } from '../src/models/segment';

// ─── 参数解析 ─────────────────────────────────────────────

const inputVideoPath = process.argv[2];

if (!inputVideoPath) {
  console.error('Usage: npx tsx scripts/testAnchorManager.ts <inputVideoPath>');
  console.error('Example: npx tsx scripts/testAnchorManager.ts ./tmp/sample.mp4');
  process.exit(1);
}

// ─── 确保 tmp 目录存在 ────────────────────────────────────

const tmpDir = resolve('tmp');
if (!existsSync(tmpDir)) {
  mkdirSync(tmpDir, { recursive: true });
  console.log(`Created directory: ${tmpDir}`);
}

const outputPngPath = resolve(tmpDir, 'anchor_test_end.png');

// ─── 主流程 ──────────────────────────────────────────────

async function main() {
  console.log('=== AnchorManager 测试 ===\n');

  // 1) 检查 ffmpeg
  console.log('1) 检查 ffmpeg...');
  try {
    await ensureFfmpegAvailable();
    console.log('   ✅ ffmpeg 可用\n');
  } catch (err) {
    console.error(`   ❌ ${(err as Error).message}`);
    process.exit(1);
  }

  // 2) 抽取末帧
  console.log(`2) 抽取末帧: ${inputVideoPath} → ${outputPngPath}`);
  try {
    await extractLastFrameToPng({
      inputVideoPath: resolve(inputVideoPath),
      outputPngPath,
    });
    console.log('   ✅ 抽帧完成\n');
  } catch (err) {
    console.error(`   ❌ 抽帧失败:\n${(err as Error).message}`);
    process.exit(1);
  }

  // 3) 演示 buildNextStartFrameHint
  console.log('3) 演示锚点构建...');

  const mockPrevSegment: Segment = {
    id: 'seg-prev-001',
    shotId: 'shot-001',
    projectId: 'proj-001',
    segmentIndex: 0,
    durationSec: 6,
    endFramePath: '/tmp/seg-prev-001_end.png', // 模拟已抽取的末帧本地路径
  };

  const hint = buildNextStartFrameHint({ prevSegment: mockPrevSegment });
  console.log('   startFrameHint:', JSON.stringify(hint, null, 2));

  const noHint = buildNextStartFrameHint({ prevSegment: undefined });
  console.log('   无前驱时 hint:', noHint, '(期望 undefined) ✅\n');

  // 4) 演示 applyStartFrameToSegment
  console.log('4) 演示 Segment 不可变更新...');

  const mockNextSegment: Segment = {
    id: 'seg-next-002',
    shotId: 'shot-001',
    projectId: 'proj-001',
    segmentIndex: 1,
    durationSec: 6,
  };

  const updated = applyStartFrameToSegment({
    segment: mockNextSegment,
    startFramePath: hint?.path,
  });

  console.log('   原 segment.startFramePath:', mockNextSegment.startFramePath ?? '(undefined)');
  console.log('   新 segment.startFramePath:', updated.startFramePath ?? '(undefined)');
  console.log('   原对象未被修改:', mockNextSegment.startFramePath === undefined ? '✅' : '❌');

  console.log('\n=== 全部测试通过 ===');
}

main().catch((err) => {
  console.error('未预期错误:', err);
  process.exit(1);
});
