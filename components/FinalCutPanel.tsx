/**
 * FinalCutPanel.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Professional timeline editor for final film assembly.
 *
 * Features:
 *  • Auto-collects all generated shot images + videos from project
 *  • Per-shot: voice dubbing (ElevenLabs) auto-triggered on dialogue
 *  • Per-scene: background music auto-triggered via MusicGen
 *  • Timeline playhead with scrub
 *  • "Render Final Film" → calls /api/video/finalize (FFmpeg stitch)
 *  • Polling for async render job completion
 *  • Download final film
 *
 * Architecture note: all API calls go to the Express backend (/api/*).
 * No direct ElevenLabs or Replicate keys needed on the frontend.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StoryboardProject, Shot, Scene } from '../types';
import { useAppContext } from '../context/AppContext';
import { supabase } from '../lib/supabaseClient';

// ─── Icon helpers ────────────────────────────────────────────────────────────

const Icon = ({ d, cls = 'w-4 h-4' }: { d: string; cls?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
    strokeWidth={1.5} stroke="currentColor" className={cls}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

const PlayIcon = () => <Icon d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />;
const StopIcon = () => <Icon d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z" />;
const DownloadIcon = () => <Icon d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />;
const MicIcon = () => <Icon d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />;
const MusicIcon = () => <Icon d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" />;
const FilmIcon = () => <Icon d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />;
const ScissorsIcon = () => <Icon d="m7.848 8.25 1.536.887M7.848 8.25a3 3 0 1 1-5.196-3 3 3 0 0 1 5.196 3Zm1.536.887a2.165 2.165 0 0 1 1.083 1.839c.005.351.054.695.14 1.024M9.384 9.137l2.077 1.199M7.848 15.75l1.536-.887m-1.536.887a3 3 0 1 1-5.196 3 3 3 0 0 1 5.196-3Zm1.536-.887a2.165 2.165 0 0 0 1.083-1.838c.005-.352.054-.695.14-1.025m-1.223 2.863 2.077-1.199m0-3.328a4.323 4.323 0 0 1 2.068-1.379l5.325-1.628a4.5 4.5 0 0 1 2.48-.044l.803.215-7.794 4.5m-2.882-1.664A4.33 4.33 0 0 0 10.607 12m3.736 0 7.794 4.5-.802.215a4.5 4.5 0 0 1-2.48-.043l-5.326-1.629a4.324 4.324 0 0 1-2.068-1.379M14.343 12l-2.882 1.664" />;
const CheckIcon = () => <Icon d="m4.5 12.75 6 6 9-13.5" cls="w-4 h-4 text-emerald-400" />;
const SpinnerIcon = () => (
  <svg className="w-4 h-4 animate-spin text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

// ─── Types ───────────────────────────────────────────────────────────────────

interface TrackItem {
  shot_id: string;
  shot_number: number;
  scene_number: number;
  scene_title: string;
  dialogue: string;
  dialogue_speaker: string;
  duration_sec: number;
  image_url: string | null;
  video_url: string | null;
  voice_url: string | null;
  voice_duration_sec: number | null;
  voice_status: 'idle' | 'generating' | 'done' | 'error';
  voice_error?: string;
  music_vibe: string;
}

interface SceneTrack {
  scene_number: number;
  scene_title: string;
  music_url: string | null;
  music_prediction_id: string | null;
  music_status: 'idle' | 'generating' | 'polling' | 'done' | 'error';
  music_error?: string;
  tension_level: number;
}

type RenderStatus = 'idle' | 'rendering' | 'done' | 'error';

interface FinalCutPanelProps {
  project: StoryboardProject;
  lang?: 'en' | 'zh';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getApiBase = () => {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:3001';
  }
  return '';
};

const fmtSec = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

const emotionToVoicePreset = (emotion: string): string => {
  const e = (emotion || '').toLowerCase();
  if (e.includes('angry') || e.includes('rage')) return 'en_male_arnold';
  if (e.includes('sad') || e.includes('grief')) return 'en_female_sarah';
  if (e.includes('excited') || e.includes('joy')) return 'en_male_josh';
  if (e.includes('calm') || e.includes('peaceful')) return 'en_female_emma';
  return 'en_male_james';
};

const tensionToMusicVibe = (tension: number, scene: Scene): string => {
  const title = scene.scene_title || '';
  const emotion = scene.emotional_beat || scene.audio_description || '';
  const base = `${title}. ${emotion}`.trim();
  if (tension >= 80) return `${base} — intense orchestral thriller, pounding timpani, brass stabs, cinematic Hans Zimmer style`;
  if (tension >= 60) return `${base} — dramatic underscore, strings building, rising tension`;
  if (tension >= 40) return `${base} — cinematic ambient, mid-tension, subtle melody`;
  if (tension >= 20) return `${base} — gentle atmospheric score, light piano, emotional warmth`;
  return `${base} — minimal ambient, soft texture, breathing room`;
};

// ─── FinalCutPanel ───────────────────────────────────────────────────────────

const FinalCutPanel: React.FC<FinalCutPanelProps> = ({ project, lang = 'en' }) => {
  const { settings } = useAppContext();
  const authToken = (settings as any)?.authToken || '';

  // ── Build track list from project ────────────────────────────────────────
  const [tracks, setTracks] = useState<TrackItem[]>([]);
  const [sceneTracks, setSceneTracks] = useState<SceneTrack[]>([]);
  const [renderStatus, setRenderStatus] = useState<RenderStatus>('idle');
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderProgress, setRenderProgress] = useState(0);
  const [activePreview, setActivePreview] = useState<string | null>(null);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build tracks from project on mount / project change
  useEffect(() => {
    const allShots: TrackItem[] = [];
    const sceneMap: Map<number, SceneTrack> = new Map();

    (project.scenes || []).forEach((scene: Scene) => {
      const sceneNum = scene.scene_number;
      if (!sceneMap.has(sceneNum)) {
        sceneMap.set(sceneNum, {
          scene_number: sceneNum,
          scene_title: scene.scene_title || `Scene ${sceneNum}`,
          music_url: null,
          music_prediction_id: null,
          music_status: 'idle',
          tension_level: scene.tension_level || 30,
        });
      }

      const shots = (scene as any).shots as Shot[] | undefined;
      if (!shots?.length) {
        // Scene with no explicit shots array — treat as single shot
        const primaryImage = scene.image_url || null;
        const dialogue = scene.dialogue_text || '';
        const dur = scene.duration_sec || 5;
        allShots.push({
          shot_id: (scene as any).shot_id || `scene-${sceneNum}`,
          shot_number: 1,
          scene_number: sceneNum,
          scene_title: scene.scene_title || `Scene ${sceneNum}`,
          dialogue,
          dialogue_speaker: scene.dialogue_speaker || '',
          duration_sec: dur,
          image_url: primaryImage,
          video_url: scene.video_url || null,
          voice_url: scene.audio_url || null,
          voice_duration_sec: null,
          voice_status: scene.audio_url ? 'done' : 'idle',
          music_vibe: tensionToMusicVibe(scene.tension_level || 30, scene),
        });
      } else {
        shots.forEach((shot: Shot) => {
          const primaryImage = shot.images?.find(img => img.id === shot.primary_image_id)?.url
            || shot.images?.[0]?.url
            || shot.image_url
            || null;
          const dialogue = shot.dialogue_text || shot.dialogue || '';
          allShots.push({
            shot_id: shot.shot_id,
            shot_number: shot.shot_number,
            scene_number: sceneNum,
            scene_title: scene.scene_title || `Scene ${sceneNum}`,
            dialogue,
            dialogue_speaker: shot.dialogue_speaker || shot.characters?.[0] || '',
            duration_sec: shot.duration_sec || 4,
            image_url: primaryImage,
            video_url: shot.video_url || null,
            voice_url: null,
            voice_duration_sec: null,
            voice_status: 'idle',
            music_vibe: tensionToMusicVibe(scene.tension_level || 30, scene),
          });
        });
      }
    });

    allShots.sort((a, b) => a.scene_number - b.scene_number || a.shot_number - b.shot_number);
    setTracks(allShots);
    setSceneTracks(Array.from(sceneMap.values()).sort((a, b) => a.scene_number - b.scene_number));
  }, [project]);

  // Total duration
  const totalDuration = tracks.reduce((s, t) => s + t.duration_sec, 0);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const getAuthHeader = useCallback(async (): Promise<Record<string, string>> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        return { Authorization: `Bearer ${session.access_token}` };
      }
    } catch { /* ignore */ }
    if (authToken) return { Authorization: `Bearer ${authToken}` };
    return {};
  }, [authToken]);

  // ── Voice generation ─────────────────────────────────────────────────────

  const generateVoice = useCallback(async (shotId: string) => {
    const track = tracks.find(t => t.shot_id === shotId);
    if (!track || !track.dialogue.trim()) return;

    setTracks(prev => prev.map(t =>
      t.shot_id === shotId ? { ...t, voice_status: 'generating' } : t
    ));

    try {
      const emotion = (project.scenes || [])
        .find((s: Scene) => s.scene_number === track.scene_number)?.emotional_beat || 'neutral';

      const res = await fetch(`${getApiBase()}/api/audio/generate-dialogue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await getAuthHeader() },
        body: JSON.stringify({
          text: track.dialogue,
          voice: emotionToVoicePreset(emotion),
          emotion: emotion.toLowerCase(),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Voice generation failed');
      }

      const data = await res.json();
      setTracks(prev => prev.map(t =>
        t.shot_id === shotId
          ? { ...t, voice_status: 'done', voice_url: data.url || data.audio_url, voice_duration_sec: data.duration_sec }
          : t
      ));
    } catch (err: any) {
      setTracks(prev => prev.map(t =>
        t.shot_id === shotId ? { ...t, voice_status: 'error', voice_error: err.message } : t
      ));
    }
  }, [tracks, project.scenes, getAuthHeader]);

  const generateAllVoices = useCallback(async () => {
    const needsVoice = tracks.filter(t => t.dialogue.trim() && t.voice_status === 'idle');
    for (const t of needsVoice) {
      await generateVoice(t.shot_id);
    }
  }, [tracks, generateVoice]);

  // ── Music generation ─────────────────────────────────────────────────────

  const generateMusic = useCallback(async (sceneNum: number) => {
    const sceneTrack = sceneTracks.find(st => st.scene_number === sceneNum);
    if (!sceneTrack) return;

    const sampleTrack = tracks.find(t => t.scene_number === sceneNum);
    const vibe = sampleTrack?.music_vibe || sceneTrack.scene_title;
    const dur = tracks.filter(t => t.scene_number === sceneNum).reduce((s, t) => s + t.duration_sec, 0);

    setSceneTracks(prev => prev.map(st =>
      st.scene_number === sceneNum ? { ...st, music_status: 'generating' } : st
    ));

    try {
      const res = await fetch(`${getApiBase()}/api/audio/generate-music`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await getAuthHeader() },
        body: JSON.stringify({ vibe, duration: Math.max(10, Math.ceil(dur)) }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Music generation failed');
      }

      const data = await res.json();
      setSceneTracks(prev => prev.map(st =>
        st.scene_number === sceneNum
          ? { ...st, music_status: 'polling', music_prediction_id: data.prediction_id }
          : st
      ));

      // Start polling for music completion
      pollMusicPrediction(sceneNum, data.prediction_id);
    } catch (err: any) {
      setSceneTracks(prev => prev.map(st =>
        st.scene_number === sceneNum ? { ...st, music_status: 'error', music_error: err.message } : st
      ));
    }
  }, [sceneTracks, tracks, getAuthHeader]);

  const pollMusicPrediction = useCallback((sceneNum: number, predId: string) => {
    const poll = async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/replicate/predictions/${predId}`, {
          headers: await getAuthHeader(),
        });
        if (!res.ok) throw new Error('Poll failed');
        const data = await res.json();

        if (data.status === 'succeeded') {
          const musicUrl = Array.isArray(data.output) ? data.output[0] : data.output;
          setSceneTracks(prev => prev.map(st =>
            st.scene_number === sceneNum
              ? { ...st, music_status: 'done', music_url: musicUrl }
              : st
          ));
        } else if (data.status === 'failed' || data.status === 'canceled') {
          setSceneTracks(prev => prev.map(st =>
            st.scene_number === sceneNum
              ? { ...st, music_status: 'error', music_error: data.error || 'Music generation failed' }
              : st
          ));
        } else {
          // Still processing — poll again in 3s
          pollRef.current = setTimeout(poll, 3000);
        }
      } catch (err: any) {
        setSceneTracks(prev => prev.map(st =>
          st.scene_number === sceneNum
            ? { ...st, music_status: 'error', music_error: err.message }
            : st
        ));
      }
    };
    poll();
  }, [getAuthHeader]);

  const generateAllMusic = useCallback(async () => {
    const needsMusic = sceneTracks.filter(st => st.music_status === 'idle');
    for (const st of needsMusic) {
      await generateMusic(st.scene_number);
    }
  }, [sceneTracks, generateMusic]);

  // ── Render Final Film ─────────────────────────────────────────────────────

  const renderFinalFilm = useCallback(async () => {
    setRenderStatus('rendering');
    setRenderError(null);
    setRenderProgress(10);

    // Build segments — include whichever clips exist (video > image)
    const segments = tracks.map((t, idx) => {
      const sceneTrack = sceneTracks.find(st => st.scene_number === t.scene_number);
      return {
        scene_number: idx + 1,
        video_url: t.video_url || t.image_url || null,
        audio_url: t.voice_url || null,
        subtitle_text: t.dialogue || null,
        background_music_url: sceneTrack?.music_url || null,
      };
    }).filter(s => s.video_url);

    if (segments.length === 0) {
      setRenderStatus('error');
      setRenderError('No clips available. Generate images or videos first.');
      return;
    }

    // Find global background music (most common per scene or first available)
    const bgMusic = sceneTracks.find(st => st.music_url)?.music_url || undefined;

    try {
      setRenderProgress(25);
      const res = await fetch(`${getApiBase()}/api/video/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await getAuthHeader() },
        body: JSON.stringify({
          project_id: project.id || `project_${Date.now()}`,
          segments,
          background_music: bgMusic ? { url: bgMusic, volume: 0.3, loop: true } : undefined,
          transitions: { type: 'crossfade', duration: 0.5 },
          output_format: { resolution: '1080p', format: 'mp4', fps: 24 },
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Render failed');
      }

      const data = await res.json();
      setRenderProgress(60);

      if (data.output_url) {
        // Synchronous result
        setRenderUrl(data.output_url);
        setRenderStatus('done');
        setRenderProgress(100);
      } else if (data.job_id) {
        // Async job — poll
        setRenderJobId(data.job_id);
        pollRenderJob(data.job_id);
      } else {
        // Playlist / fallback — use first video
        const fallback = data.video_urls?.[0] || segments[0]?.video_url || null;
        setRenderUrl(fallback);
        setRenderStatus('done');
        setRenderProgress(100);
      }
    } catch (err: any) {
      setRenderStatus('error');
      setRenderError(err.message);
      setRenderProgress(0);
    }
  }, [tracks, sceneTracks, project.id, getAuthHeader]);

  const pollRenderJob = useCallback((jobId: string) => {
    const poll = async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/video/status/${jobId}`, {
          headers: await getAuthHeader(),
        });
        if (!res.ok) throw new Error('Status poll failed');
        const data = await res.json();

        setRenderProgress(data.progress ?? 75);

        if (data.status === 'succeeded' || data.output_url) {
          setRenderUrl(data.output_url);
          setRenderStatus('done');
          setRenderProgress(100);
        } else if (data.status === 'failed') {
          throw new Error(data.error || 'Render job failed');
        } else {
          pollRef.current = setTimeout(poll, 4000);
        }
      } catch (err: any) {
        setRenderStatus('error');
        setRenderError(err.message);
      }
    };
    poll();
  }, [getAuthHeader]);

  // Cleanup polling on unmount
  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  // ── Voice playback ────────────────────────────────────────────────────────

  const playVoice = (url: string, shotId: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    if (playingVoice === shotId) {
      setPlayingVoice(null);
      return;
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => setPlayingVoice(null);
    audio.play().catch(() => { });
    setPlayingVoice(shotId);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const hasAnyClip = tracks.some(t => t.video_url || t.image_url);
  const voiceDone = tracks.filter(t => t.dialogue.trim() && t.voice_status === 'done').length;
  const voiceTotal = tracks.filter(t => t.dialogue.trim()).length;
  const musicDone = sceneTracks.filter(st => st.music_status === 'done').length;

  return (
    <div className="space-y-6 text-slate-200">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-900/50 border border-indigo-700/40">
            <ScissorsIcon />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">
              {lang === 'zh' ? '最终剪辑' : 'Final Cut'}
            </h2>
            <p className="text-xs text-slate-400">
              {tracks.length} {lang === 'zh' ? '个镜头' : 'shots'} ·{' '}
              {fmtSec(totalDuration)} {lang === 'zh' ? '总时长' : 'total'} ·{' '}
              {sceneTracks.length} {lang === 'zh' ? '个场景' : 'scenes'}
            </p>
          </div>
        </div>

        {/* Master render button */}
        <button
          onClick={renderFinalFilm}
          disabled={!hasAnyClip || renderStatus === 'rendering'}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm
            bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500
            disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-900/50"
        >
          {renderStatus === 'rendering' ? <SpinnerIcon /> : <FilmIcon />}
          {renderStatus === 'rendering'
            ? `${lang === 'zh' ? '渲染中' : 'Rendering'} ${renderProgress}%`
            : lang === 'zh' ? '渲染成片' : 'Render Final Film'}
        </button>
      </div>

      {/* ── Auto-generate voice + music bar ─────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={generateAllVoices}
          disabled={voiceTotal === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
            bg-emerald-900/50 border border-emerald-700/50 hover:bg-emerald-800/50
            disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          <MicIcon />
          {lang === 'zh' ? '自动配音全部' : 'Dub All Dialogue'}
          <span className="ml-1 text-xs text-emerald-300">
            {voiceDone}/{voiceTotal}
          </span>
        </button>

        <button
          onClick={generateAllMusic}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
            bg-violet-900/50 border border-violet-700/50 hover:bg-violet-800/50 transition-all"
        >
          <MusicIcon />
          {lang === 'zh' ? '生成全部背景音乐' : 'Generate All Music'}
          <span className="ml-1 text-xs text-violet-300">
            {musicDone}/{sceneTracks.length}
          </span>
        </button>
      </div>

      {/* ── Render result ────────────────────────────────────────── */}
      {renderStatus === 'done' && renderUrl && (
        <div className="rounded-2xl border border-emerald-700/50 bg-emerald-900/20 p-5 space-y-3">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold">
            <CheckIcon />
            {lang === 'zh' ? '成片已生成！' : 'Final film rendered!'}
          </div>
          <video
            src={renderUrl}
            controls
            className="w-full rounded-xl border border-slate-700 max-h-80 object-contain bg-black"
          />
          <a
            href={renderUrl}
            download="final-cut.mp4"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
              bg-emerald-700 hover:bg-emerald-600 transition-colors"
          >
            <DownloadIcon />
            {lang === 'zh' ? '下载成片' : 'Download Film'}
          </a>
        </div>
      )}

      {renderStatus === 'error' && renderError && (
        <div className="rounded-xl border border-red-700/50 bg-red-900/20 p-4 text-sm text-red-300">
          ⚠️ {renderError}
        </div>
      )}

      {/* ── Scene music tracks ───────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-3">
          {lang === 'zh' ? '场景配乐' : 'Scene Music'}
        </h3>
        <div className="grid gap-2">
          {sceneTracks.map(st => (
            <div key={st.scene_number}
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800/50 border border-slate-700/50">
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-slate-200 truncate">{st.scene_title}</span>
                <span className="ml-2 text-xs text-slate-500">Scene {st.scene_number}</span>
                <div className="mt-1">
                  {/* Tension bar */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 w-12">Tension</span>
                    <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${st.tension_level}%`,
                          background: st.tension_level >= 70
                            ? 'linear-gradient(90deg,#ef4444,#f97316)'
                            : st.tension_level >= 40
                              ? 'linear-gradient(90deg,#a855f7,#6366f1)'
                              : 'linear-gradient(90deg,#3b82f6,#06b6d4)',
                        }}
                      />
                    </div>
                    <span className="text-xs text-slate-500 w-7 text-right">{st.tension_level}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {st.music_status === 'idle' && (
                  <button
                    onClick={() => generateMusic(st.scene_number)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                      bg-violet-900/50 border border-violet-700/40 hover:bg-violet-800/50 transition-all"
                  >
                    <MusicIcon />
                    {lang === 'zh' ? '生成音乐' : 'Generate'}
                  </button>
                )}
                {(st.music_status === 'generating' || st.music_status === 'polling') && (
                  <div className="flex items-center gap-1.5 text-xs text-violet-300">
                    <SpinnerIcon />
                    {lang === 'zh' ? '生成中…' : 'Generating…'}
                  </div>
                )}
                {st.music_status === 'done' && st.music_url && (
                  <div className="flex items-center gap-1.5">
                    <audio controls src={st.music_url} className="h-7 w-36" />
                    <span className="text-xs text-emerald-400">✓</span>
                  </div>
                )}
                {st.music_status === 'error' && (
                  <span className="text-xs text-red-400 truncate max-w-[120px]" title={st.music_error}>
                    ⚠️ {st.music_error?.slice(0, 30)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Shot timeline ────────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-3">
          {lang === 'zh' ? '镜头时间线' : 'Shot Timeline'}
        </h3>

        {tracks.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center text-slate-500 text-sm">
            {lang === 'zh'
              ? '没有可用镜头。请先生成图片或视频。'
              : 'No shots available. Generate images or videos first.'}
          </div>
        )}

        <div className="space-y-2">
          {tracks.map((track, idx) => {
            const widthPct = totalDuration > 0 ? (track.duration_sec / totalDuration) * 100 : 100 / tracks.length;
            const hasClip = !!(track.video_url || track.image_url);
            const hasDialogue = track.dialogue.trim().length > 0;

            return (
              <div key={track.shot_id}
                className={`rounded-xl border transition-all ${
                  hasClip
                    ? 'border-slate-700/50 bg-slate-800/40'
                    : 'border-dashed border-slate-700/30 bg-slate-900/20 opacity-60'
                }`}>

                {/* Top row: thumbnail + info */}
                <div className="flex gap-3 p-3">
                  {/* Thumbnail / preview */}
                  <div
                    className="relative shrink-0 w-20 h-14 rounded-lg overflow-hidden bg-slate-900 border border-slate-700
                      cursor-pointer hover:ring-1 hover:ring-indigo-500 transition-all"
                    onClick={() => setActivePreview(track.video_url || track.image_url || null)}
                  >
                    {track.image_url ? (
                      <img src={track.image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-600">
                        <FilmIcon />
                      </div>
                    )}
                    {track.video_url && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <div className="p-1 rounded-full bg-white/20 backdrop-blur">
                          <PlayIcon />
                        </div>
                      </div>
                    )}
                    {/* Shot label */}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-0.5">
                      <span className="text-[10px] font-mono text-white">
                        S{track.scene_number}.{track.shot_number}
                      </span>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-200 truncate">{track.scene_title}</p>
                        {hasDialogue && (
                          <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">
                            <span className="text-indigo-400 font-medium">{track.dialogue_speaker}: </span>
                            {track.dialogue}
                          </p>
                        )}
                        {!hasDialogue && (
                          <p className="text-xs text-slate-600 italic mt-0.5">
                            {lang === 'zh' ? '无对白 — 纯视觉' : 'No dialogue — visual only'}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-slate-500 shrink-0 font-mono">
                        {fmtSec(track.duration_sec)}
                      </span>
                    </div>

                    {/* Voice row */}
                    {hasDialogue && (
                      <div className="flex items-center gap-2 mt-2">
                        {track.voice_status === 'idle' && (
                          <button
                            onClick={() => generateVoice(track.shot_id)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium
                              bg-emerald-900/40 border border-emerald-700/40 hover:bg-emerald-800/50 transition-all"
                          >
                            <MicIcon />
                            {lang === 'zh' ? '配音' : 'Dub'}
                          </button>
                        )}
                        {track.voice_status === 'generating' && (
                          <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                            <SpinnerIcon />
                            {lang === 'zh' ? '配音中…' : 'Dubbing…'}
                          </div>
                        )}
                        {track.voice_status === 'done' && track.voice_url && (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => playVoice(track.voice_url!, track.shot_id)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs
                                bg-slate-700 hover:bg-slate-600 transition-all"
                            >
                              {playingVoice === track.shot_id ? <StopIcon /> : <PlayIcon />}
                              {track.voice_duration_sec != null ? fmtSec(track.voice_duration_sec) : ''}
                            </button>
                            <span className="text-xs text-emerald-400">✓ {lang === 'zh' ? '配音完成' : 'Dubbed'}</span>
                          </div>
                        )}
                        {track.voice_status === 'error' && (
                          <span className="text-xs text-red-400" title={track.voice_error}>
                            ⚠️ {track.voice_error?.slice(0, 40)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Timeline bar */}
                <div className="px-3 pb-3">
                  <div className="h-1.5 rounded-full overflow-hidden bg-slate-700/50">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${widthPct}%`,
                        background: hasClip
                          ? 'linear-gradient(90deg, #6366f1, #8b5cf6)'
                          : '#374151',
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Visual timeline ruler ────────────────────────────────── */}
      {tracks.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-2">
            {lang === 'zh' ? '时间标尺' : 'Timeline'}
          </h3>
          <div className="h-8 rounded-xl overflow-hidden flex border border-slate-700/50">
            {tracks.map(track => {
              const widthPct = totalDuration > 0 ? (track.duration_sec / totalDuration) * 100 : 100 / tracks.length;
              const hasClip = !!(track.video_url || track.image_url);
              const hue = ((track.scene_number * 53 + track.shot_number * 17) % 360);
              return (
                <div
                  key={track.shot_id}
                  title={`S${track.scene_number}.${track.shot_number} (${fmtSec(track.duration_sec)})`}
                  style={{
                    width: `${widthPct}%`,
                    background: hasClip
                      ? `hsl(${hue},50%,30%)`
                      : `hsl(${hue},10%,15%)`,
                    borderRight: '1px solid rgba(255,255,255,0.04)',
                  }}
                  className="flex items-center justify-center text-[9px] font-mono text-white/60
                    cursor-default hover:brightness-125 transition-all overflow-hidden"
                >
                  {widthPct > 4 && `${track.scene_number}.${track.shot_number}`}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-slate-600 mt-1 font-mono">
            <span>0:00</span>
            <span>{fmtSec(totalDuration / 2)}</span>
            <span>{fmtSec(totalDuration)}</span>
          </div>
        </div>
      )}

      {/* ── Preview modal ────────────────────────────────────────── */}
      {activePreview && (
        <div
          className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          onClick={() => setActivePreview(null)}
        >
          <div className="relative max-w-3xl w-full" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setActivePreview(null)}
              className="absolute -top-10 right-0 text-slate-400 hover:text-white text-sm"
            >
              {lang === 'zh' ? '关闭' : 'Close'} ✕
            </button>
            {activePreview.match(/\.(mp4|webm|mov)(\?|$)/i) ? (
              <video src={activePreview} controls autoPlay className="w-full rounded-2xl border border-slate-700 bg-black" />
            ) : (
              <img src={activePreview} alt="" className="w-full rounded-2xl border border-slate-700 object-contain max-h-[80vh]" />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FinalCutPanel;
