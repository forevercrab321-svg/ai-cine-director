// Minimal test for prompt engine v1/v2
// Usage: npx tsx scripts/testPromptEngine.ts

import { buildVideoPrompt, VIDEO_PROMPT_PRESETS } from '../lib/promptEngine/promptEngine';

const sampleInput = {
  scene_text: 'A young woman stands in the rain outside a neon-lit bar, hesitating before entering. The city glows behind her, reflections shimmering on the wet pavement.',
};

console.log('==== PROMPT ENGINE TEST ====');
console.log('Sample input:', sampleInput.scene_text);

// v2
const v2Prompt = buildVideoPrompt(sampleInput, { stylePreset: 'neo_noir' });
console.log('\n--- v2 prompt (neo_noir) ---\n');
console.log(v2Prompt);

// v1 (simulate: just output scene_text)
const v1Prompt = sampleInput.scene_text;
console.log('\n--- v1 prompt (baseline) ---\n');
console.log(v1Prompt);

// Check structure
if (!v2Prompt.includes('[Narrative Layer]') || !v2Prompt.includes('[Cinematic Layer]')) {
  throw new Error('❌ v2 prompt missing required structure layers');
}
if (!v2Prompt.trim()) {
  throw new Error('❌ v2 prompt is empty');
}
console.log('\n✅ v2 prompt structure OK');
