
import { VideoModel } from '../types';

export interface RecommendationResult {
  model: VideoModel;
  reason: string;
  isDialogue?: boolean;
}

export const analyzePromptAndRecommendModel = (
  prompt: string
): RecommendationResult | null => {
  const p = prompt.toLowerCase();

  // 1. Dialogue / Audio Check → Seedance Lite (supports audio)
  const dialogueKeywords = ['speak', 'talk', 'say', 'sing', 'voice', 'sound', 'dialogue', 'monologue', 'speech', 'chat', 'shout', 'whisper', '"'];
  const isDialogue = dialogueKeywords.some(k => p.includes(k));

  if (isDialogue) {
    return { model: 'seedance_pro', reason: 'Audio/Lip-Sync Detected', isDialogue: true };
  }

  // 2. High Motion / Action → Hailuo-02 Fast (fast + good motion)
  const motionKeywords = ['run', 'fight', 'dance', 'fast', 'jump', 'action', 'chase', 'explode', 'crash', 'fly', 'spin', 'rapid'];
  if (motionKeywords.some(k => p.includes(k))) {
    return { model: 'hailuo_02_fast', reason: 'Complex Motion Detected' };
  }

  // 3. Narrative / Cinematic → Kling 2.5 Pro (best physics & cinema quality)
  const narrativeKeywords = ['story', 'sequence', 'transition', 'journey', 'timeline', 'montage', 'plot', 'unfold'];
  if (narrativeKeywords.some(k => p.includes(k))) {
    return { model: 'kling_2_5_pro', reason: 'Narrative Flow Detected' };
  }

  // 4. High Quality Animation → Veo 3 (Google flagship)
  const animationKeywords = ['live2d', 'anime', 'illustration', 'character', 'portrait', 'style', 'artistic', '2d'];
  if (animationKeywords.some(k => p.includes(k))) {
    return { model: 'veo_3', reason: 'Animation Style Detected' };
  }

  // 5. Default fallback → wan_2_2_fast (cheapest)
  return null;
};
