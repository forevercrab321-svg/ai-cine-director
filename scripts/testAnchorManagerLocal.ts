/**
 * testAnchorManagerLocal — 本地路径版 AnchorManager 端到端测试
 *
 * 前置条件：本机需安装 ffmpeg（https://ffmpeg.org/download.html）
 *
 * 用法：
 *   npx tsx scripts/testAnchorManagerLocal.ts <inputVideoPath>
 *
 * 示例：
 *   npx tsx scripts/testAnchorManagerLocal.ts ./tmp/sample.mp4
 *
 * 该脚本会：
 * 1) 校验 ffmpeg 是否可用
 * 2) 构造 mock segment，以 inputVideoPath 作为 outputVideoPath
 * 3) 用 deriveEndFramePath 推导末帧 PNG 路径
 * 4) 调用 extractLastFrameToPng 抽取末帧
 * 5) 将 endFramePath 写入 segment 并演示 buildNextStartFrameHint
 * 6) 用 applyStartFrameToSegment 构建下一段 segment
 */

import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ensureFfmpegAvailable,
  extractLastFrameToPng,
  deriveEndFramePath,
  buildNextStartFrameHint,
  applyStartFrameToSegment,
} from '../src/director/anchorManager';
import type { Segment } from '../src/models/segment';

// ─── 参数解析 ─────────────────────────────────────────────

const inputVideoPath = process.argv[2];

if (!inputVideoPath) {
  console.error('Usage: npx tsx scripts/testAnchorManagerLocal.ts <inputVideoPath>');
  console.error('Example: npx tsx scripts/testAnchorManagerLocal.ts ./tmp/sample.mp4');
  process.exit(1);
}

// ─── 确保 tmp 目录存在 ────────────────────────────────────

const tmpDir = resolve('tmp');
if (!existsSync(tmpDir)) {
  mkdirSync(tmpDir, { recursive: true });
  console.log(`Created directory: ${tmpDir}`);
}

// ─── 主流程 ──────────────────────────────────────────────

async function main() {
  console.log('=== AnchorManager Local 端到端测试 ===\n');

  // 1) 检查 ffmpeg
  console.log('1) 检查 ffmpeg...');
  await ensureFfmpegAvailable();
  console.log('   ✅ ffmpeg 可用\n');

  // 2) 构造 mock segment
  const segmentId = 'seg_test';
  const segment: Segment = {
    id: segmentId,
    shotId: 'shot-001',
    projectId: 'proj-001',
    segmentIndex: 0,
    durationSec: 6,
    outputVideoPath: resolve(inputVideoPath),
  };

  console.log(`2) Mock segment 构造完成:`);
  console.log(`   id: ${segment.id}`);
  console.log(`   outputVideoPath: ${segment.outputVideoPath}\n`);

  // 3) 推导末帧 PNG 路径
  const endFramePng = deriveEndFramePath({ outputDir: tmpDir, segmentId: segment.id });
  console.log(`3) 末帧路径推导: ${endFramePng}\n`);

  // 4) 抽取末帧
  console.log(`4) 抽取末帧: ${segment.outputVideoPath} → ${endFramePng}`);
  await extractLastFrameToPng({
    inputVideoPath: segment.outputVideoPath!,
    outputPngPath: endFramePng,
  });
  console.log('   ✅ 抽帧完成\n');

  // 5) 将 endFramePath 写入 segment
  const segmentWithEndFrame: Segment = { ...segment, endFramePath: endFramePng };
  console.log(`5) segment.endFramePath = ${segmentWithEndFrame.endFramePath}`);

  // 演示 buildNextStartFrameHint
  const hint = buildNextStartFrameHint({ prevSegment: segmentWithEndFrame });
  console.log('   startFrameHint:', JSON.stringify(hint, null, 2));

  const noHint = buildNextStartFrameHint({ prevSegment: undefined });
  console.log(`   无前驱时 hint: ${noHint} (期望 undefined) ${noHint === undefined ? '✅' : '❌'}\n`);

  // 6) 用 applyStartFrameToSegment 构建下一段
  console.log('6) 构建下一段 segment...');
  const nextSegment: Segment = {
    id: 'seg_test_next',
    shotId: 'shot-001',
    projectId: 'proj-001',
    segmentIndex: 1,
    durationSec: 6,
  };

  const nextWithAnchor = applyStartFrameToSegment({
    segment: nextSegment,
    startFramePath: hint?.path,
  });

  console.log(`   原 segment.startFramePath: ${nextSegment.startFramePath ?? '(undefined)'}`);
  console.log(`   新 segment.startFramePath: ${nextWithAnchor.startFramePath ?? '(undefined)'}`);
  console.log(`   原对象未被修改: ${nextSegment.startFramePath === undefined ? '✅' : '❌'}`);

  // 验证文件存在
  console.log(`\n   末帧 PNG 文件存在: ${existsSync(endFramePng) ? '✅' : '❌'}`);

  console.log('\n=== OK ===');
}

main().catch((err) => {
  console.error('❌ 错误:', (err as Error).message);
  process.exit(1);
});
