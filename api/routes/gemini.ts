/**
 * Gemini API 代理路由
 * 安全地在服务器端调用 Gemini API
 */
import { Router } from 'express';
import { GoogleGenAI, Type } from '@google/genai';

export const geminiRouter = Router();

const getAI = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured on server');
    return new GoogleGenAI({ apiKey });
};

const responseSchema = {
    type: Type.OBJECT,
    properties: {
        project_title: { type: Type.STRING },
        visual_style: { type: Type.STRING },
        character_anchor: { type: Type.STRING },
        scenes: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    scene_number: { type: Type.INTEGER },
                    visual_description: { type: Type.STRING },
                    audio_description: { type: Type.STRING },
                    shot_type: { type: Type.STRING },
                },
                required: ['scene_number', 'visual_description', 'audio_description', 'shot_type'],
            },
        },
    },
    required: ['project_title', 'visual_style', 'character_anchor', 'scenes'],
};

// POST /api/gemini/generate - 生成故事板
geminiRouter.post('/generate', async (req, res) => {
    try {
        const { storyIdea, visualStyle, language, mode, identityAnchor } = req.body;

        if (!storyIdea) {
            return res.status(400).json({ error: 'Missing storyIdea' });
        }

        const ai = getAI();

        const systemInstruction = `
**Role:** Professional Hollywood Screenwriter & Director of Photography.
**Task:** Break down the User's Story Concept into a production-ready script with 5 distinct scenes.

**CORE PHILOSOPHY: THE ANCHOR METHOD**
You are writing instructions for an AI production pipeline. 
1. **Character Continuity:** ${identityAnchor
                ? `The character is LOCKED to: "${identityAnchor}". Keep all visual descriptions consistent with this anchor.`
                : `First, define a unique, memorable visual identity (the "Anchor") for the protagonist.`}
2. **Technical Precision:** Describe camera movements, lighting, and action keywords.

**Language Rule:**
* **visual_description** & **shot_type**: ALWAYS in English.
* **audio_description** & **project_title**: ${language === 'zh' ? "Chinese (Simplified)" : "English"}.

**Output Format:** JSON strictly following the provided schema.
`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: `Draft a 5-scene storyboard for: ${storyIdea}. Style: ${visualStyle}`,
            config: {
                systemInstruction,
                responseMimeType: 'application/json',
                responseSchema,
                temperature: 0.7,
            },
        });

        const text = response.text;
        if (!text) throw new Error('No response from AI Director.');

        const project = JSON.parse(text);
        project.scenes = project.scenes.map((s: any) => ({
            ...s,
            image_prompt: `${project.character_anchor}, ${s.visual_description}, ${s.shot_type}`,
            video_motion_prompt: s.shot_type,
        }));

        res.json(project);
    } catch (error: any) {
        console.error('[Gemini] Error:', error);
        // Return full error details for debugging Vercel
        res.status(500).json({
            error: error.message || 'Gemini generation failed',
            details: error.toString(),
            stack: error.stack
        });
    }
});

// POST /api/gemini/analyze - 分析角色锚点
geminiRouter.post('/analyze', async (req, res) => {
    try {
        const { base64Data } = req.body;
        if (!base64Data) {
            return res.status(400).json({ error: 'Missing base64Data' });
        }

        const ai = getAI();
        const cleanBase64 = base64Data.split(',')[1] || base64Data;
        const mimeType = base64Data.match(/:(.*?);/)?.[1] || 'image/png';

        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: {
                parts: [
                    { inlineData: { mimeType, data: cleanBase64 } },
                    { text: 'Analyze this character and extract a dense Identity Anchor description: face, hair, and key outfit elements.' },
                ],
            },
        });

        const result = (response.text || 'A cinematic character').trim();
        res.json({ anchor: result });
    } catch (error: any) {
        console.error('[Gemini Analyze] Error:', error.message);
        res.json({ anchor: 'A cinematic character' });
    }
});
