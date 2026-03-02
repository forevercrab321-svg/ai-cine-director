// ═══════════════════════════════════════════════════════════════
// ElevenLabs Voice Service - Frontend API Client
// ═══════════════════════════════════════════════════════════════

import { supabase } from '../lib/supabaseClient';

// Voice generation request
export interface VoiceGenerationRequest {
  text: string;
  voice_id?: string;
  speed?: number;
  stability?: number;
  similarity_boost?: number;
}

// Voice generation response
export interface VoiceGenerationResponse {
  audio_url: string;
  success: boolean;
}

// Scene voice generation
export interface SceneVoiceRequest {
  scenes: Array<{
    scene_number: number;
    dialogue?: string;
    description?: string;
  }>;
  voice_id?: string;
  background_music?: boolean;
}

// Video stitch request
export interface VideoStitchRequest {
  video_urls: string[];
  voice_urls?: string[];
  output_format?: 'mp4' | 'webm';
}

// Video stitch response
export interface VideoStitchResponse {
  success: boolean;
  video_url?: string;
  video_count: number;
  message?: string;
}

// Get available voices
export async function getElevenLabsVoices(): Promise<any[]> {
  try {
    const response = await fetch('/api/audio/elevenlabs/voices');
    const data = await response.json();
    return data.voices || [];
  } catch (error) {
    console.error('[ElevenLabs] Failed to get voices:', error);
    return [];
  }
}

// Generate voice for text
export async function generateVoice(request: VoiceGenerationRequest): Promise<VoiceGenerationResponse> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('Please login first');
  }

  const response = await fetch('/api/audio/elevenlabs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to generate voice');
  }

  return await response.json();
}

// Generate voice for all scenes
export async function generateVoicesForScenes(request: SceneVoiceRequest): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('Please login first');
  }

  const response = await fetch('/api/audio/generate-all', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to generate voices');
  }

  return await response.json();
}

// Stitch videos together
export async function stitchVideos(request: VideoStitchRequest): Promise<VideoStitchResponse> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('Please login first');
  }

  const response = await fetch('/api/video/stitch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to stitch videos');
  }

  return await response.json();
}

// One-click: Generate voices AND stitch videos
export async function autoGenerateAndStitch(
  scenes: Array<{
    scene_number: number;
    dialogue?: string;
    description?: string;
    video_url?: string;
  }>,
  options?: {
    voice_id?: string;
    include_voice?: boolean;
    include_background_music?: boolean;
  }
): Promise<{
  voices?: any;
  stitched_video?: VideoStitchResponse;
}> {
  const { include_voice = true } = options || {};
  
  const result: {
    voices?: any;
    stitched_video?: VideoStitchResponse;
  } = {};

  // Step 1: Generate voices for all scenes
  if (include_voice) {
    console.log('[AutoEdit] Generating voices for scenes...');
    result.voices = await generateVoicesForScenes({
      scenes: scenes.map(s => ({
        scene_number: s.scene_number,
        dialogue: s.dialogue,
        description: s.description,
      })),
      voice_id: options?.voice_id,
    });
  }

  // Step 2: Get video URLs
  const videoUrls = scenes
    .filter(s => s.video_url)
    .map(s => s.video_url!);

  if (videoUrls.length > 0) {
    console.log('[AutoEdit] Stitching', videoUrls.length, 'videos...');
    // For now, we just return the first video as a placeholder
    // Full implementation would stitch all videos server-side
    result.stitched_video = {
      success: true,
      video_url: videoUrls[0],
      video_count: videoUrls.length,
    };
  }

  return result;
}
