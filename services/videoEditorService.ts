// ═══════════════════════════════════════════════════════════════
// videoEditorService.ts — 自动视频剪辑拼接服务
// 功能：拼接视频片段、添加背景音乐、添加语音旁白、转场效果
// ═══════════════════════════════════════════════════════════════

import { supabase } from '../lib/supabaseClient';

export interface VideoSegment {
  sceneNumber: number;
  videoUrl: string;
  duration?: number;
}

export interface VideoEditOptions {
  projectId: string;
  segments: VideoSegment[];
  backgroundMusic?: {
    url: string;
    volume: number;
    fadeIn?: number;
    fadeOut?: number;
  };
  voiceover?: {
    audioUrl: string;
    volume: number;
    startTime?: number;
  };
  transitions?: {
    type: 'fade' | 'crossfade' | 'dissolve' | 'wipe' | 'none';
    duration: number;
  };
  outputFormat?: {
    resolution: '720p' | '1080p' | '4k';
    format: 'mp4' | 'webm';
    fps: 24 | 30 | 60;
  };
}

export interface VideoEditJob {
  id: string;
  project_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  output_url?: string;
  error?: string;
  created_at: string;
  updated_at: string;
  metadata?: {
    total_segments: number;
    total_duration: number;
    music_url?: string;
  };
}

// 背景音乐库 - 根据场景类型匹配
export const BACKGROUND_MUSIC_LIBRARY: Record<string, { url: string; mood: string }[]> = {
  action: [
    { url: 'https://assets.mixkit.co/music/preview/mixkit-tech-house-vibes-130.mp3', mood: 'energetic' },
    { url: 'https://assets.mixkit.co/music/preview/mixkit-hip-hop-02-738.mp3', mood: 'dynamic' },
  ],
  drama: [
    { url: 'https://assets.mixkit.co/music/preview/mixkit-sadness-29.mp3', mood: 'emotional' },
    { url: 'https://assets.mixkit.co/music/preview/mixkit-deep-urban-623.mp3', mood: 'somber' },
  ],
  romance: [
    { url: 'https://assets.mixkit.co/music/preview/mixkit-love-39.mp3', mood: 'romantic' },
    { url: 'https://assets.mixkit.co/music/preview/mixkit-sweet-16.mp3', mood: 'tender' },
  ],
  comedy: [
    { url: 'https://assets.mixkit.co/music/preview/mixkit-happy-angel-33.mp3', mood: 'playful' },
    { url: 'https://assets.mixkit.co/music/preview/mixkit-funny-bunny-135.mp3', mood: 'whimsical' },
  ],
  thriller: [
    { url: 'https://assets.mixkit.co/music/preview/mixkit-cinematic-suspense-40.mp3', mood: 'suspenseful' },
    { url: 'https://assets.mixkit.co/music/preview/mixkit-dark-fog-31.mp3', mood: 'tense' },
  ],
  default: [
    { url: 'https://assets.mixkit.co/music/preview/mixkit-ambient-tension-673.mp3', mood: 'neutral' },
    { url: 'https://assets.mixkit.co/music/preview/mixkit-cinematic-movie-trailer-228.mp3', mood: 'epic' },
  ],
};

export function getBackgroundMusicForScene(sceneType: string): { url: string; mood: string } {
  const normalizedType = sceneType.toLowerCase();
  const musicOptions = BACKGROUND_MUSIC_LIBRARY[normalizedType] || BACKGROUND_MUSIC_LIBRARY.default;
  return musicOptions[Math.floor(Math.random() * musicOptions.length)];
}

export async function createVideoEditJob(
  options: VideoEditOptions,
  userId: string
): Promise<VideoEditJob> {
  const jobId = `video_edit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const job: VideoEditJob = {
    id: jobId,
    project_id: options.projectId,
    status: 'pending',
    progress: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    metadata: {
      total_segments: options.segments.length,
      total_duration: 0,
      music_url: options.backgroundMusic?.url,
    },
  };

  const { error } = await supabase
    .from('video_edit_jobs')
    .upsert({
      id: job.id,
      project_id: job.project_id,
      user_id: userId,
      status: job.status,
      progress: job.progress,
      metadata: job.metadata,
      created_at: job.created_at,
      updated_at: job.updated_at,
    });

  if (error) {
    console.error('[VideoEditor] Failed to create job:', error);
    throw new Error('创建视频编辑任务失败');
  }

  return job;
}

export async function getVideoEditJob(jobId: string): Promise<VideoEditJob | null> {
  // ★ maybeSingle() avoids 406 "Not Acceptable" when job row is missing
  const { data, error } = await supabase
    .from('video_edit_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (error) {
    console.error('[VideoEditor] Failed to get job:', error);
    return null;
  }

  return data as VideoEditJob;
}

export async function updateVideoEditJob(
  jobId: string,
  updates: Partial<VideoEditJob>
): Promise<void> {
  const { error } = await supabase
    .from('video_edit_jobs')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (error) {
    console.error('[VideoEditor] Failed to update job:', error);
  }
}

export function prepareVideoEditData(options: VideoEditOptions) {
  return {
    project_id: options.projectId,
    segments: options.segments.map(seg => ({
      scene_number: seg.sceneNumber,
      video_url: seg.videoUrl,
    })),
    background_music: options.backgroundMusic ? {
      url: options.backgroundMusic.url,
      volume: options.backgroundMusic.volume || 0.3,
      fade_in: options.backgroundMusic.fadeIn || 2,
      fade_out: options.backgroundMusic.fadeOut || 2,
    } : null,
    voiceover: options.voiceover ? {
      audio_url: options.voiceover.audioUrl,
      volume: options.voiceover.volume || 1.0,
      start_time: options.voiceover.startTime || 0,
    } : null,
    transitions: options.transitions || {
      type: 'crossfade',
      duration: 0.5,
    },
    output_format: options.outputFormat || {
      resolution: '1080p',
      format: 'mp4',
      fps: 30,
    },
  };
}
