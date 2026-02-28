// src/lib/audioEngine/mixer.ts
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';

const execAsync = promisify(exec);

export interface TimelineTrack {
    id: string;
    type: 'dialogue' | 'music' | 'sfx' | 'ambience';
    filePath: string;
    startTime: number; // In seconds
    duration: number;
}

export interface MixPlan {
    timeline: TimelineTrack[];
    mode: 'basic' | 'pro';
    targetLoudness?: number; // LUFS
}

/**
 * Ensures file exists or downloads from URL if needed.
 * For simplicity in this demo, we assume the filePaths are local temporal paths
 * or we just rely on ffmpeg's ability to read remote URLs directly.
 */
function prepareFfmpegInputs(videoPath: string, timeline: TimelineTrack[]): string {
    let inputs = `-i "${videoPath}" `;
    timeline.forEach(track => {
        inputs += `-i "${track.filePath}" `;
    });
    return inputs;
}

/**
 * Builds the complex filtergraph for ffmpeg based on the timeline
 */
function buildFilterGraph(timeline: TimelineTrack[], mode: 'basic' | 'pro'): string {
    if (timeline.length === 0) return '';

    let filter = '';
    const audioStreamLabels: string[] = [];

    // Delay each track to its proper start time
    timeline.forEach((track, idx) => {
        // Input 0 is video. Input idx + 1 is the audio track.
        const inputIdx = idx + 1;
        const delayMs = Math.floor(track.startTime * 1000);
        // adelay uses ms. Format: adelay=delays:all=1
        filter += `[${inputIdx}:a]adelay=${delayMs}|${delayMs}[a${inputIdx}]; `;
        audioStreamLabels.push(`[a${inputIdx}]`);
    });

    // Mix them together
    const mixCount = audioStreamLabels.length;
    filter += `${audioStreamLabels.join('')}amix=inputs=${mixCount}:duration=first:dropout_transition=2`;

    if (mode === 'pro') {
        // Add lightweight mastering (e.g. compand/loudnorm)
        filter += `,loudnorm=I=-14:LRA=11:TP=-1.5`;
    }

    filter += `[aout];`;

    return filter;
}

/**
 * mixAndMaster
 * Takes a source video and an audio mixing plan, producing a final muxed video.
 */
export async function mixAndMaster(
    sourceVideoUrl: string,
    plan: MixPlan
): Promise<string> {
    if (!plan.timeline || plan.timeline.length === 0) {
        console.log('[AudioEngine:Mixer] Empty timeline, returning original video.');
        return sourceVideoUrl;
    }

    console.log(`[AudioEngine:Mixer] Starting mixAndMaster [Mode: ${plan.mode}]...`);

    const tmpDir = os.tmpdir();
    const outputFilePath = path.join(tmpDir, `mixed_output_${Date.now()}.mp4`);

    const inputs = prepareFfmpegInputs(sourceVideoUrl, plan.timeline);
    const filterGraph = buildFilterGraph(plan.timeline, plan.mode);

    // Assemble the ffmpeg command.
    // -y : overwrite
    // -c:v copy : Keep original video encoding (fast and lossless for video)
    // -c:a aac : Encode final mix to AAC
    // -map 0:v : take video from 1st input
    // -map "[aout]" : take audio from filtergraph
    const command = `ffmpeg -y ${inputs} -filter_complex "${filterGraph}" -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k "${outputFilePath}"`;

    try {
        console.log(`[AudioEngine:Mixer] Executing FFmpeg: ${command}`);
        // Will throw if ffmpeg fails (e.g. command not found, bad URL)
        await execAsync(command);
        console.log(`[AudioEngine:Mixer] Success! Mixed file saved to ${outputFilePath}`);
        return outputFilePath;
    } catch (error: any) {
        console.error('[AudioEngine:Mixer] FFmpeg Error:', error.message);
        if (error.message.includes('command not found')) {
            throw new Error(`FFmpeg is not installed or not in PATH! Please install FFmpeg to use the Audio Engine. Original error: ${error.message}`);
        }
        throw new Error(`Mix and master failed: ${error.message}`);
    }
}
