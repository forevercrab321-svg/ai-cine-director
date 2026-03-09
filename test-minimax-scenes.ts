import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testMinimaxScenes() {
    const MINIMAX_TEXT_API = 'https://api.minimax.io/v1/text/chatcompletion_v2';
    const apiKey = process.env.VITE_MINIMAX_API_KEY || process.env.MINIMAX_API_KEY;

    const targetScenes = 5;
    const storyIdea = "A lone astronaut discovers an abandoned space station.";
    const visualStyle = "Cinematic, dark, highly realistic 8k";

    const systemInstruction = `You are an elite Hollywood Screenwriter and AI Cinematographer.
Your job is to write highly logical, emotionally engaging, and beautifully structured visual scripts.

**REQUIRED JSON SCHEMA:**
You MUST respond with a JSON object strictly matching this structure with EXACTLY ${targetScenes} items in the "scenes" array:
{
  "project_title": "string",
  "visual_style": "string",
  "characterAnchor": "string",
  "scenes": [
    {
      "scene_id": 1,
      "location": "string",
      "shots": [
        {
          "shot_index": 1,
          "image_prompt": "string",
          "video_prompt": "string",
          "audio_description": "string"
        }
      ]
    }
  ]
}`;

    const promptContent = `Write a premium, award-winning SHORT DRAMA broken down into exactly ${targetScenes} SCENES based on this premise: "${storyIdea}". 
Visual Style: ${visualStyle}.
Target scenes: EXACTLY ${targetScenes}. Each scene should have 1-3 shots. 

Ensure the cinematic pacing is excellent. Scene 1 must hook the audience immediately.

**CRITICAL RULES FOR SCENES:**
1. EXACT YIELD: You MUST return EXACTLY ${targetScenes} scenes in your JSON array. No more, no less.
2. NO REPETITION: Every single scene MUST be entirely unique in location, action, and dialogue. Do NOT repeat the same events or descriptions across different scenes.
3. PROGRESSION: The story must move forward chronologically. Scene 2 must show what happens AFTER Scene 1. Scene 3 must show what happens AFTER Scene 2.
4. UNIQUE CONTEXT: The \`location\` and \`image_prompt\` in each scene must reflect the changing story, not the same establishing shot over and over.`;

    const payload = {
        model: 'MiniMax-Text-01',
        messages: [
            { role: "system", name: "System", content: systemInstruction },
            { role: "user", name: "User", content: promptContent }
        ],
        temperature: 0.7,
        response_format: { type: "json_object" }
    };

    try {
        const response = await fetch(MINIMAX_TEXT_API, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log("-- Raw Minimax Response --");
        console.log(JSON.stringify(data, null, 2));

        if (data.choices && data.choices[0]) {
            const rawJson = data.choices[0].message.content;
            const parsed = JSON.parse(rawJson);
            console.log(`Successfully parsed JSON. Title: ${parsed.project_title}`);
            console.log(`Generated exactly ${parsed.scenes.length} scenes.`);
            parsed.scenes.forEach((s: any, i: number) => {
                console.log(`Scene ${i + 1} Location: ${s.location.substring(0, 50)}...`);
            });
        }
    } catch (err) {
        console.error("Error:", err);
    }
}

testMinimaxScenes();
