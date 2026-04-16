// ─────────────────────────────────────────────────────────────────────────────
// promptTemplates.ts — Gemini prompt builders for AI Cine Director
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DirectorControlsInput mirrors the DirectorControls type from types.ts.
 * All fields optional so it can be partially provided from req.body.
 */
export interface DirectorControlsInput {
    // Narrative
    tone?: string;
    pacing?: string;
    narrativeDistance?: string;
    openingHook?: string;
    endingStyle?: string;
    emotionalEscalation?: number;     // 0-100
    reversalAtMidpoint?: boolean;
    subplotThreads?: number;          // 0-3
    // Visual
    visualPhilosophy?: string;
    cameraMotivation?: string;
    lightingMotivation?: string;
    soundMotivation?: string;
    shotDensity?: number;             // 1-10
    realism?: string;
    // Genre weights (each 0-100)
    genreWeights?: Record<string, number>;
    // Continuity rules
    continuityRules?: string;
    bannedElements?: string;
    motifSystem?: string;
    avoidPhrases?: string;
    // Dialogue system
    subtextLevel?: number;            // 0-100
    dialogueDensity?: number;         // 0-100
    preferredLens?: string;
    preferredBlockingStyle?: string;
    // AI settings
    generationTemperature?: number;   // 0.1-1.0
}

function buildDirectorControlsBlock(dc: DirectorControlsInput): string {
    const lines: string[] = [];

    // ── Narrative Architecture ────────────────────────────────────────────────
    if (dc.tone)               lines.push(`TONE: ${dc.tone}`);
    if (dc.pacing)             lines.push(`PACING STYLE: ${dc.pacing}`);
    if (dc.narrativeDistance)  lines.push(`NARRATIVE VOICE: ${dc.narrativeDistance}`);
    if (dc.openingHook)        lines.push(`OPENING HOOK: ${dc.openingHook}`);
    if (dc.endingStyle)        lines.push(`ENDING APPROACH: ${dc.endingStyle}`);
    if (dc.subplotThreads !== undefined && dc.subplotThreads > 0)
        lines.push(`SUBPLOT THREADS: ${dc.subplotThreads} simultaneous thread(s)`);
    if (dc.emotionalEscalation !== undefined)
        lines.push(`EMOTIONAL ESCALATION: ${dc.emotionalEscalation}% (how aggressively intensity builds)`);
    if (dc.reversalAtMidpoint)
        lines.push(`MIDPOINT REVERSAL: Insert a significant reversal/turn at the story midpoint`);

    // ── Motif / Continuity ────────────────────────────────────────────────────
    if (dc.motifSystem)    lines.push(`RECURRING MOTIF/SYMBOL: ${dc.motifSystem}`);
    if (dc.bannedElements) lines.push(`FORBIDDEN ELEMENTS (never include): ${dc.bannedElements}`);
    if (dc.avoidPhrases)   lines.push(`AVOID THESE PHRASES/WORDS: ${dc.avoidPhrases}`);

    // ── Visual System ─────────────────────────────────────────────────────────
    if (dc.visualPhilosophy)     lines.push(`VISUAL PHILOSOPHY: ${dc.visualPhilosophy}`);
    if (dc.realism)              lines.push(`REALISM LEVEL: ${dc.realism}`);
    if (dc.cameraMotivation)     lines.push(`CAMERA MOTIVATION: ${dc.cameraMotivation}`);
    if (dc.lightingMotivation)   lines.push(`LIGHTING MOTIVATION: ${dc.lightingMotivation}`);
    if (dc.soundMotivation)      lines.push(`SOUND MOTIVATION: ${dc.soundMotivation}`);
    if (dc.preferredLens)        lines.push(`PREFERRED LENS: ${dc.preferredLens}`);
    if (dc.preferredBlockingStyle) lines.push(`BLOCKING STYLE: ${dc.preferredBlockingStyle}`);
    if (dc.shotDensity !== undefined)
        lines.push(`SHOT DENSITY: ${dc.shotDensity}/10 (${dc.shotDensity <= 3 ? 'sparse/wide' : dc.shotDensity >= 8 ? 'rapid cutting' : 'moderate'})`);

    // ── Genre Blend ───────────────────────────────────────────────────────────
    if (dc.genreWeights) {
        const active = Object.entries(dc.genreWeights)
            .filter(([, v]) => v > 0)
            .sort(([, a], [, b]) => b - a)
            .map(([g, v]) => `${g}(${v}%)`)
            .join(', ');
        if (active) lines.push(`GENRE BLEND: ${active}`);
    }

    // ── Dialogue System ───────────────────────────────────────────────────────
    if (dc.dialogueDensity !== undefined)
        lines.push(`DIALOGUE DENSITY: ${dc.dialogueDensity}% (${dc.dialogueDensity < 30 ? 'mostly visual' : dc.dialogueDensity > 70 ? 'dialogue-heavy' : 'balanced'})`);
    if (dc.subtextLevel !== undefined)
        lines.push(`SUBTEXT LEVEL: ${dc.subtextLevel}% (${dc.subtextLevel > 70 ? 'heavy subtext, characters rarely say what they mean' : dc.subtextLevel < 30 ? 'direct/explicit dialogue' : 'moderate subtext'})`);

    // ── Continuity Rules ──────────────────────────────────────────────────────
    if (dc.continuityRules) lines.push(`CONTINUITY RULES: ${dc.continuityRules}`);

    if (!lines.length) return '';

    return `
🎛️ **DIRECTOR CONTROLS** (MANDATORY — these override any defaults):
${lines.map(l => `  • ${l}`).join('\n')}
ENFORCE all of the above director controls throughout every scene. They are non-negotiable creative parameters.`;
}

export function generateStoryBrainPrompt(inputs: {
    storyIdea: string;
    visualStyle: string;
    identityAnchor: string;
    sceneCount: number;
    directorControls?: DirectorControlsInput;
}): string {
    const directorBlock = inputs.directorControls
        ? buildDirectorControlsBlock(inputs.directorControls)
        : '';

    return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎬 AI CINE DIRECTOR: STORY BRAIN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your task is to act as an elite Hollywood Showrunner and Cinematographer.
Given a short idea, you will build a robust, structurally sound story foundation and continuity bibles.

📖 **PREMISE**: "${inputs.storyIdea}"
🎨 **VISUAL STYLE**: "${inputs.visualStyle}"
👤 **CHARACTER ANCHOR**: "${inputs.identityAnchor}"
🎞️ **TARGET SCENES**: ${inputs.sceneCount}
${directorBlock}

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
   - dramatic_function (one of: setup|confrontation|revelation|climax|resolution|transition)
   - tension_level (integer 1-10)

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
       "emotional_goal": "string",
       "dramatic_function": "setup|confrontation|revelation|climax|resolution|transition",
       "tension_level": 5
    }
  ]
}`;
}

export function generateShotListPrompt(inputs: {
    scene: any;
    characterBible: any[];
    styleBible: any;
    directorControls?: DirectorControlsInput;
}): string {
    const visualInstructions: string[] = [];
    if (inputs.directorControls?.visualPhilosophy)
        visualInstructions.push(`Visual Philosophy: ${inputs.directorControls.visualPhilosophy}`);
    if (inputs.directorControls?.cameraMotivation)
        visualInstructions.push(`Camera Motivation: ${inputs.directorControls.cameraMotivation}`);
    if (inputs.directorControls?.lightingMotivation)
        visualInstructions.push(`Lighting Motivation: ${inputs.directorControls.lightingMotivation}`);
    if (inputs.directorControls?.pacing)
        visualInstructions.push(`Pacing: ${inputs.directorControls.pacing}`);
    if (inputs.directorControls?.shotDensity !== undefined)
        visualInstructions.push(`Shot Density: ${inputs.directorControls.shotDensity}/10`);
    if (inputs.directorControls?.subtextLevel !== undefined)
        visualInstructions.push(`Subtext Level: ${inputs.directorControls.subtextLevel}% (${inputs.directorControls.subtextLevel > 70 ? 'characters rarely say what they mean' : inputs.directorControls.subtextLevel < 30 ? 'direct dialogue' : 'moderate subtext'})`);
    if (inputs.directorControls?.dialogueDensity !== undefined)
        visualInstructions.push(`Dialogue Density: ${inputs.directorControls.dialogueDensity}% (${inputs.directorControls.dialogueDensity < 30 ? 'mostly visual/silent' : inputs.directorControls.dialogueDensity > 70 ? 'dialogue-heavy' : 'balanced'})`);

    const directorBlock = visualInstructions.length
        ? `\n🎛️ **DIRECTOR CONTROLS**:\n${visualInstructions.map(l => `  • ${l}`).join('\n')}\n`
        : '';

    // Build character reference block so AI uses correct IDs
    const charRef = inputs.characterBible.length > 0
        ? `\n📋 **CHARACTER REFERENCE** (use exact character_id values):\n${inputs.characterBible.map(c => `  - ${c.name} → "${c.character_id}"`).join('\n')}\n`
        : '';

    // Style bible quick-ref
    const styleRef = inputs.styleBible
        ? `\n🎨 **STYLE BIBLE**: Lens: ${inputs.styleBible.lens_language || 'N/A'} | Lighting: ${inputs.styleBible.lighting || 'N/A'} | Palette: ${inputs.styleBible.color_palette || 'N/A'}\n`
        : '';

    const dialogueDensity = inputs.directorControls?.dialogueDensity ?? 40;
    const dialogueInstruction = dialogueDensity < 20
        ? 'Most shots should have NO dialogue. Only add lines when absolutely essential.'
        : dialogueDensity > 70
        ? 'Include spoken dialogue in most shots. Characters should verbalize their goals and conflicts.'
        : 'Add dialogue selectively — only when the scene\'s emotional beat demands it. Many shots should be silent action.';

    return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎬 AI CINE DIRECTOR: SCRIPT-TO-SHOT PLANNER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are a master storyboard artist, director of photography, AND screenwriter.
Your job is to break down a single Scene into a precise Shot List with dialogue and emotional beats.

📍 **SCENE**: ${inputs.scene.scene_number} - ${inputs.scene.synopsis}
📍 **LOCATION**: ${inputs.scene.location}
📍 **TIME**: ${inputs.scene.time_of_day}
📍 **EMOTIONAL GOAL**: ${inputs.scene.emotional_goal || 'N/A'}
📍 **DRAMATIC FUNCTION**: ${inputs.scene.dramatic_function || 'scene'}
📍 **TENSION LEVEL**: ${inputs.scene.tension_level || 5}/10
${charRef}${styleRef}${directorBlock}
RULES:
- A shot is a single continuous camera take.
- Break the scene's synopsis into 2 to 6 shots. Each shot is distinct — different angle, action, or reveal.
- Each shot must have a specific camera angle, movement, and composition.
- Continuity is KING: specify exact character_id values from the CHARACTER REFERENCE above.
- Match the tension level: high tension → tighter shots, shorter duration; low tension → wider, longer.
- DIALOGUE: ${dialogueInstruction}
- EMOTIONAL BEAT: State the internal psychological state of the POV character in that specific shot.
- TRANSITION: Specify the edit transition OUT of this shot.

JSON SCHEMA:
{
  "shots": [
    {
      "shot_id": "uuid format",
      "shot_number": 1,
      "characters": ["character_id array — use exact IDs from CHARACTER REFERENCE"],
      "action": "What happens in the shot (ONE core physical action, present tense, vivid verb)",
      "camera_angle": "wide|medium|close|ecu|over-shoulder|pov",
      "camera_movement": "static|push-in|pull-out|pan-left|pan-right|tilt-up|tilt-down|dolly|tracking|handheld",
      "composition": "string (e.g., rule of thirds with subject at left — negative space right)",
      "lighting": "string (e.g., harsh key light from left window casting long shadows)",
      "duration_sec": 4,
      "emotional_beat": "Internal state of the main character in this exact moment (e.g., 'controlled panic beneath a steady face')",
      "dialogue": {
        "speaker": "Character name, or null if no dialogue",
        "line": "Exact spoken words, or null if silent",
        "subtext": "What the speaker really means or fears (always fill this even if line is null)"
      },
      "transition": "cut|dissolve|fade|match_cut|smash_cut|wipe"
    }
  ]
}`;
}

export function buildImagePrompt(inputs: {
    shot: any;
    scene: any;
    characterBible: any[];
    styleBible: any;
    directorControls?: DirectorControlsInput;
}): string {
    // Merge constraints into a highly stable image generation prompt
    const charsInShot = inputs.shot.characters
        .map((id: string) => inputs.characterBible.find(c => c.character_id === id))
        .filter(Boolean);

    const charDescriptions = charsInShot.map((c: any) =>
        `${c.name} (${c.age}, ${c.body_type}, ${c.face_traits}, wearing ${c.outfit}, holding ${c.props})`
    ).join(' and ');

    // Director visual overrides
    const visualPhil = inputs.directorControls?.visualPhilosophy;
    const styleExtra = visualPhil ? `, ${visualPhil}` : '';

    return [
        charDescriptions ? `SUBJECT(S): ${charDescriptions}.` : '',
        `ACTION: ${inputs.shot.action}`,
        `SETTING: ${inputs.scene.location}, ${inputs.scene.time_of_day}, ${inputs.styleBible.lighting}, ${inputs.shot.lighting}`,
        `CAMERA: ${inputs.shot.camera_angle} shot, ${inputs.shot.composition}, ${inputs.styleBible.lens_language}, ${inputs.styleBible.color_palette} color palette`,
        `STYLE: Cinematic photography, highly detailed, photorealistic sequence${styleExtra}`
    ].filter(Boolean).join(' | ');
}

export function buildVideoPrompt(inputs: {
    shot: any;
    scene?: any;
    styleBible?: any;
    directorControls?: DirectorControlsInput;
    /** Director OS temporal guidance — injected from shot graph node */
    temporalGuidance?: {
        previous_visual_state?: string;
        start_frame_intent?: string;
        mid_frame_intent?: string;
        end_frame_intent?: string;
        next_visual_target_state?: string;
    };
}): string {
    // Video prompts: ONE action, ONE camera movement, locked continuity.
    // Keep them tightly scoped — the AI hallucinates heavily with long video prompts.
    const parts: string[] = [];

    // 1. Camera movement — primary instruction
    const cameraMove = inputs.shot.camera_movement || 'static';
    parts.push(`Camera ${cameraMove}`);

    // 2. The core physical action in the shot
    if (inputs.shot.action) {
        parts.push(inputs.shot.action);
    }

    // 3. Lighting note from style bible (helps model match the look)
    const lighting = inputs.shot.lighting || inputs.styleBible?.lighting;
    if (lighting) {
        parts.push(`Lighting: ${lighting}`);
    }

    // 4. Emotional register from shot's emotional_beat (if available)
    if (inputs.shot.emotional_beat) {
        parts.push(`Mood: ${inputs.shot.emotional_beat}`);
    }

    // 5. Pacing hint from director controls
    if (inputs.directorControls?.pacing) {
        parts.push(`Pacing: ${inputs.directorControls.pacing}`);
    } else if (inputs.scene?.tension_level) {
        const tension = Number(inputs.scene.tension_level);
        if (tension >= 8) parts.push('Pacing: rapid, urgent');
        else if (tension <= 3) parts.push('Pacing: slow, deliberate');
    }

    // 5b. Director OS — temporal guidance (sequence thinking)
    const tg = inputs.temporalGuidance;
    if (tg?.start_frame_intent) {
        parts.push(`Opening frame: ${tg.start_frame_intent}`);
    }
    if (tg?.mid_frame_intent) {
        parts.push(`Mid frame: ${tg.mid_frame_intent}`);
    }
    if (tg?.end_frame_intent) {
        parts.push(`Closing frame: ${tg.end_frame_intent}`);
    }
    if (tg?.previous_visual_state) {
        parts.push(`Picks up from: ${tg.previous_visual_state}`);
    }
    if (tg?.next_visual_target_state) {
        parts.push(`Must transition into: ${tg.next_visual_target_state}`);
    }

    parts.push('Maintain exact visual consistency with the first frame. Do not change subject identity, clothing, hair, or environment geometry.');

    return parts.join('. ') + '.';
}

export function generateContinuityValidationPrompt(): string {
    return `Analyze the provided frame from a newly generated shot against the continuity bibles.
Return a continuity score and strict boolean flags for whether face, outfit, and scene match the required traits.`;
}
