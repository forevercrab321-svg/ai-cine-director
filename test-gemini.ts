
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

if (!globalThis.fetch) {
    // @ts-ignore
    globalThis.fetch = fetch;
    // @ts-ignore
    globalThis.Headers = fetch.Headers;
    // @ts-ignore
    globalThis.Request = fetch.Request;
    // @ts-ignore
    globalThis.Response = fetch.Response;
}

dotenv.config({ path: '.env.local' });

async function main() {
    console.log('Testing Gemini API...');
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('No API Key found');
        return;
    }
    console.log('API Key present:', apiKey.slice(0, 5) + '...');

    try {
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash', // Try a faster/stable model first
            contents: 'Hello, are you working?',
        });
        console.log('Response:', response.text);
    } catch (e: any) {
        console.error('Error:', e.message);
    }
}

main();
