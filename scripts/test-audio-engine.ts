import dotenv from 'dotenv';
import path from 'path';
import { runAudioEnginePipeline } from '../src/lib/audioEngine';

dotenv.config({ path: '.env.local' });

async function runTest() {
    console.log('--- AUDIO ENGINE TEST ---');

    // Create a dummy video file for testing
    // In a real scenario this is a remote URL or a real local video
    const dummyVideoUrl = 'https://www.w3schools.com/html/mov_bbb.mp4';
    const dummyPrompt = 'A cinematic action scene with intense dialogue and heavy rain.';
    const mode = process.env.AUDIO_ENGINE_MODE || 'basic';
    const dummyId = `test_audio_${Date.now()}`;

    console.log(`Input Video URL: ${dummyVideoUrl}`);
    console.log(`Input Prompt: "${dummyPrompt}"`);
    console.log(`Operating Mode: ${mode}`);

    try {
        const outputFilePath = await runAudioEnginePipeline(
            dummyId,
            dummyVideoUrl,
            dummyPrompt,
            mode
        );

        console.log('\n✅ Test Succeeded!');
        console.log(`Final output with audio saved to: ${outputFilePath}`);
        console.log('You can open this file to verify the audio mix.');

    } catch (err: any) {
        console.error('\n❌ Test Failed!');
        console.error(err);
    }
}

runTest();
