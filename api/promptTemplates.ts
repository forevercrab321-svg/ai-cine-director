export function generateStoryBrainPrompt(inputs: {
    storyIdea: string;
    visualStyle: string;
    identityAnchor: string;
    sceneCount: number;
}): string {
    return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎬 AI CINE DIRECTOR: STORY BRAIN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your task is to act as an elite Hollywood Showrunner and Cinematographer.
Given a short idea, you will build a robust, structurally sound story foundation and continuity bibles.

📖 **PREMISE**: "${inputs.storyIdea}"
🎨 **VISUAL STYLE**: "${inputs.visualStyle}"
👤 **CHARACTER ANCHOR**: "${inputs.identityAnchor}"
🎞️ **TARGET SCENES**: ${inputs.sceneCount}

YOUR DELIVERABLES (in JSON format):
1. **logline**: A captivating one-sentence summary.
2. **world_setting**: Describe the rules, time period, and atmospheric mood of the world.
3. **character_bible**: Array of core characters. Each needs extremely specific physical traits (face, hair, body, outfit) so they never change.
4. **style_bible**: The strict visual rules (color palette, lens language, lighting logic).
5. **scenes**: Exactly ${inputs.sceneCount} scenes. Each scene needs:
   - scene_id
   - location (very specific)
   - time_of_day
   - synopsis (what happens in this scene, advancing the plot)
   - emotional_goal

DO NOT generate individual camera shots yet. Just the scene-level narrative step.

JSON SCHEMA:
{
  "logline": "string",
  "world_setting": "string",
  "character_bible": [
    {
       "character_id": "uuid format",
       "name": "string",
       "face_traits": "string",
       "hair": "string",
       "outfit": "string",
       "age": "string",
       "body_type": "string",
       "props": "string"
    }
  ],
  "style_bible": {
     "color_palette": "string",
     "lens_language": "string",
     "lighting": "string"
  },
  "scenes": [
    {
       "scene_id": "uuid format",
       "scene_number": 1,
       "location": "string",
       "time_of_day": "string",
       "synopsis": "string",
       "emotional_goal": "string"
    }
  ]
}`;
}

export function generateShotListPrompt(inputs: {
    scene: any;
    characterBible: any[];
    styleBible: any;
}): string {
    return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎬 AI CINE DIRECTOR: SCRIPT-TO-SHOT PLANNER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are a master storyboard artist and director of photography.
Your job is to break down a single Scene into a precise Shot List.

📍 **SCENE**: ${inputs.scene.scene_number} - ${inputs.scene.synopsis}
📍 **LOCATION**: ${inputs.scene.location}
📍 **TIME**: ${inputs.scene.time_of_day}

RULES:
- A shot is a single continuous camera take.
- Define exactly what happens in each shot. Break the scene's synopsis into 2 to 6 shots.
- Each shot must have a specific camera angle, movement, and composition.
- Continuity is KING: specify exact characters in the shot.

JSON SCHEMA:
{
  "shots": [
    {
      "shot_id": "uuid format",
      "shot_number": 1,
      "characters": ["character_id array"],
      "action": "What happens in the shot (Focus on ONE core physical action)",
      "camera_angle": "wide|medium|close|ecu|over-shoulder|pov",
      "camera_movement": "static|push-in|pull-out|pan-left|pan-right|tilt-up|tilt-down|dolly|tracking",
      "composition": "string (e.g., rule of thirds, leading lines)",
      "lighting": "string (e.g., key light from window, silhouette)",
      "duration_sec": 4
    }
  ]
}`;
}

export function buildImagePrompt(inputs: {
    shot: any;
    scene: any;
    characterBible: any[];
    styleBible: any;
}): string {
    // Merge constraints into a highly stable image generation prompt
    const charsInShot = inputs.shot.characters
        .map((id: string) => inputs.characterBible.find(c => c.character_id === id))
        .filter(Boolean);

    const charDescriptions = charsInShot.map((c: any) =>
        `${c.name} (${c.age}, ${c.body_type}, ${c.face_traits}, wearing ${c.outfit}, holding ${c.props})`
    ).join(' and ');

    return [
        charDescriptions ? `SUBJECT(S): ${charDescriptions}.` : '',
        `ACTION: ${inputs.shot.action}`,
        `SETTING: ${inputs.scene.location}, ${inputs.scene.time_of_day}, ${inputs.styleBible.lighting}, ${inputs.shot.lighting}`,
        `CAMERA: ${inputs.shot.camera_angle} shot, ${inputs.shot.composition}, ${inputs.styleBible.lens_language}, ${inputs.styleBible.color_palette} color palette`,
        `STYLE: Cinematic photography, highly detailed, photorealistic sequence`
    ].filter(Boolean).join(' | ');
}

export function buildVideoPrompt(inputs: {
    shot: any;
}): string {
    // Video prompt must be EXTREMELY restricted to avoid the AI hallucinating extra events.
    // Rule: one action, one camera movement.
    return `Camera ${inputs.shot.camera_movement}. ${inputs.shot.action}. Maintain exact visual consistency with the first frame. Do not change the subject's identity, clothing, or the environment.`;
}

export function generateContinuityValidationPrompt(): string {
    return `Analyze the provided frame from a newly generated shot against the continuity bibles.
Return a continuity score and strict boolean flags for whether face, outfit, and scene match the required traits.`;
}
