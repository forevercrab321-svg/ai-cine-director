// ─────────────────────────────────────────────────────────────────────────────
// promptTemplates.ts — Hollywood-grade Gemini prompt builders
// Three distinct expert personas: DIRECTOR · SCREENWRITER · DOP
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper: serialise director controls into a strict mandate block
// ─────────────────────────────────────────────────────────────────────────────
function buildDirectorControlsBlock(dc: DirectorControlsInput): string {
    const lines: string[] = [];
    if (dc.tone)               lines.push(`TONE: ${dc.tone}`);
    if (dc.pacing)             lines.push(`PACING: ${dc.pacing}`);
    if (dc.narrativeDistance)  lines.push(`NARRATIVE VOICE: ${dc.narrativeDistance}`);
    if (dc.openingHook)        lines.push(`OPENING HOOK: ${dc.openingHook}`);
    if (dc.endingStyle)        lines.push(`ENDING: ${dc.endingStyle}`);
    if (dc.subplotThreads)     lines.push(`SUBPLOT THREADS: ${dc.subplotThreads}`);
    if (dc.emotionalEscalation !== undefined) lines.push(`EMOTIONAL ESCALATION: ${dc.emotionalEscalation}%`);
    if (dc.reversalAtMidpoint) lines.push(`MIDPOINT REVERSAL: required`);
    if (dc.motifSystem)        lines.push(`MOTIF: ${dc.motifSystem}`);
    if (dc.bannedElements)     lines.push(`BANNED: ${dc.bannedElements}`);
    if (dc.avoidPhrases)       lines.push(`AVOID PHRASES: ${dc.avoidPhrases}`);
    if (dc.visualPhilosophy)   lines.push(`VISUAL PHILOSOPHY: ${dc.visualPhilosophy}`);
    if (dc.realism)            lines.push(`REALISM: ${dc.realism}`);
    if (dc.cameraMotivation)   lines.push(`CAMERA MOTIVATION: ${dc.cameraMotivation}`);
    if (dc.lightingMotivation) lines.push(`LIGHTING MOTIVATION: ${dc.lightingMotivation}`);
    if (dc.soundMotivation)    lines.push(`SOUND MOTIVATION: ${dc.soundMotivation}`);
    if (dc.preferredLens)      lines.push(`PREFERRED LENS: ${dc.preferredLens}`);
    if (dc.preferredBlockingStyle) lines.push(`BLOCKING: ${dc.preferredBlockingStyle}`);
    if (dc.shotDensity !== undefined) lines.push(`SHOT DENSITY: ${dc.shotDensity}/10`);
    if (dc.dialogueDensity !== undefined) lines.push(`DIALOGUE DENSITY: ${dc.dialogueDensity}%`);
    if (dc.subtextLevel !== undefined) lines.push(`SUBTEXT: ${dc.subtextLevel}%`);
    if (dc.continuityRules)    lines.push(`CONTINUITY: ${dc.continuityRules}`);
    if (dc.genreWeights) {
        const active = Object.entries(dc.genreWeights)
            .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a)
            .map(([g, v]) => `${g}(${v}%)`).join(', ');
        if (active) lines.push(`GENRE: ${active}`);
    }
    if (!lines.length) return '';
    return `\n◈ DIRECTOR MANDATES (non-negotiable):\n${lines.map(l => `  → ${l}`).join('\n')}\n`;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. STORY BRAIN — Hollywood Screenwriter + Director combined
//    Produces: logline, three-act skeleton, character bibles, style bible, scenes
// ═════════════════════════════════════════════════════════════════════════════
export function generateStoryBrainPrompt(inputs: {
    storyIdea: string;
    visualStyle: string;
    identityAnchor: string;
    sceneCount: number;
    directorControls?: DirectorControlsInput;
}): string {
    const dc = inputs.directorControls || {};
    const directorBlock = inputs.directorControls ? buildDirectorControlsBlock(inputs.directorControls) : '';

    const paceDesc = dc.pacing || 'measured, deliberate';
    const toneDesc = dc.tone || 'dramatic realism';
    const dialogueDensity = dc.dialogueDensity ?? 45;
    const subtextLevel = dc.subtextLevel ?? 65;

    return `╔══════════════════════════════════════════════════════════════════════════╗
║   AI CINE DIRECTOR — STORY BRAIN v3.0                                  ║
║   Persona: ACADEMY AWARD-WINNING SCREENWRITER + MASTER DIRECTOR         ║
╚══════════════════════════════════════════════════════════════════════════╝

You are simultaneously:
  ① A WGA-level SCREENWRITER who has crafted Oscar-winning scripts (Parasite,
    No Country for Old Men, Everything Everywhere All at Once level craft)
  ② A visionary FILM DIRECTOR with command of every cinematic language
    (Kubrick's geometry, Villeneuve's patience, Wong Kar-wai's texture)

PREMISE: "${inputs.storyIdea}"
VISUAL STYLE: "${inputs.visualStyle}"
CHARACTER ANCHOR: "${inputs.identityAnchor}"
TARGET SCENES: ${inputs.sceneCount}
${directorBlock}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCREENWRITER LAWS (enforce without exception):

① THREE-ACT SKELETON
   Act 1 (≤25% of scenes): Establish world, protagonist desire, inciting incident
   Act 2A (25-50%): Pursuit of desire, complications escalate, midpoint reversal
   Act 2B (50-75%): Protagonist at lowest point, all seems lost, dark night
   Act 3 (≥75%): Climax — protagonist changes or fails to change, resolution

② CHARACTER ARCHITECTURE (every named character must have):
   • DESIRE: What they consciously want (external goal)
   • NEED: What they unconsciously need (internal wound)
   • GHOST: The past wound driving all behaviour
   • WOUND: The specific traumatic event that created the ghost
   • UNIQUE VOICE: Speech patterns, verbal tics, vocabulary level, what they
     NEVER say (their blindspot)
   • PHYSICAL SIGNATURE: One completely unique gesture or physical habit
   • MORAL FLAW: The character defect that creates conflict

③ THEMATIC PREMISE
   The story must argue one clear thesis about the human condition.
   Every scene must advance the argument for or against this thesis.

④ SCENE FUNCTION
   Every scene must: (a) advance plot OR (b) reveal character — preferably both.
   If a scene does neither, it does not exist.

⑤ DIALOGUE CRAFT (density: ${dialogueDensity}%, subtext: ${subtextLevel}%)
   • Characters speak in conflict — every line either wants, deflects, or attacks
   • ${subtextLevel > 60 ? 'Characters NEVER say what they mean — all meaning lives in subtext' : 'Characters speak directly but with emotional undercurrent'}
   • Every character has a completely different speech pattern
   • ${dialogueDensity < 30 ? 'Prioritise visual storytelling — dialogue only when absolutely required' : dialogueDensity > 70 ? 'Dialogue-heavy — characters verbalize their internal conflict' : 'Balance visual and verbal — silence is punctuation'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DIRECTOR LAWS (visual storytelling):

① VISUAL METAPHOR SYSTEM
   Define one recurring visual motif that evolves across all ${inputs.sceneCount} scenes.
   The motif should mirror the protagonist's internal arc.

② SPACE & GEOGRAPHY
   Each location must be cinematically distinct — different ceiling height,
   light quality, colour temperature, and proximity to nature/architecture.
   No two consecutive scenes can share the same spatial type.

③ PACING ARCHITECTURE (${paceDesc})
   Emotional escalation must be geometric, not linear.
   Tension_level progression across scenes must follow a clear dramatic curve.

④ COLOUR SCRIPT
   The style_bible colour palette must evolve across the three acts:
   Act 1: [cooler/warmer/more saturated/less saturated] →
   Act 2: [shift] → Act 3: [resolution colour state]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CHARACTER BIBLE — BIOMETRIC PRECISION STANDARD

Each character's face_traits must be so specific that a casting director
could cast from it without seeing a photo. Include:
  face_traits: "[face shape], [eye colour + shape], [nose bridge width],
    [lip fullness], [jaw structure], [cheekbone prominence],
    [skin tone with undertone], [distinguishing marks if any]"
  hair: "[colour], [texture], [length], [style], [how it moves]"
  body_type: "[height estimate], [build], [posture tendency], [gait]"
  outfit: "[fabric], [colour], [fit], [condition/wear], [specific items]"
  props: "[objects they carry or interact with signature items]"
  voice_pattern: "[pace], [pitch], [accent], [verbal tics], [what they avoid saying]"
  physical_signature: "[one unique gesture or habit that appears in every scene]"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT — strict JSON, no markdown, no code fences:

{
  "logline": "One sentence: [protagonist] wants [desire] but [obstacle] forces them to [choice] or [consequence]",
  "thematic_premise": "This story argues that [thesis about human condition]",
  "world_setting": "String: time period, geography, social rules, atmosphere, what makes this world unique",
  "visual_motif": "The recurring visual element and what it represents at each act",
  "colour_script": { "act1": "string", "act2": "string", "act3": "string" },
  "character_bible": [
    {
      "character_id": "char_[name_slug]",
      "name": "Full name",
      "role": "protagonist|antagonist|supporting|catalyst",
      "desire": "What they consciously want",
      "need": "What they unconsciously need",
      "ghost": "The past wound driving behaviour",
      "flaw": "The moral defect that creates conflict",
      "face_traits": "Ultra-specific biometric description",
      "hair": "Detailed hair description",
      "outfit": "Detailed wardrobe with fabric and condition",
      "age": "Specific age range",
      "body_type": "Height, build, posture, gait",
      "props": "Signature objects",
      "voice_pattern": "Speech rhythm, tics, vocabulary level",
      "physical_signature": "One unique repeated gesture",
      "arc_summary": "Where they START emotionally vs where they END"
    }
  ],
  "style_bible": {
    "color_palette": "Specific hex-level colour description with film references",
    "lens_language": "Focal lengths used per scene type, depth of field strategy",
    "lighting": "Key light source motivation, fill ratio, practical sources",
    "art_direction": "Texture, material, production design language",
    "sound_design": "Ambient sound philosophy, music genre/mood if applicable",
    "reference_films": "3-5 films this should visually echo"
  },
  "scenes": [
    {
      "scene_id": "scene_[number]",
      "scene_number": 1,
      "act": 1,
      "dramatic_function": "setup|confrontation|revelation|climax|resolution|transition",
      "location": "Specific location with architectural/natural details",
      "time_of_day": "string",
      "weather_atmosphere": "string",
      "synopsis": "What happens — action + consequence (2-3 sentences)",
      "emotional_goal": "The emotional state we want the audience to FEEL leaving this scene",
      "character_goal": "What the protagonist is trying to achieve IN this scene",
      "scene_obstacle": "What specifically blocks them",
      "tension_level": 5,
      "visual_motif_presence": "How the recurring motif appears in this scene",
      "audio_hint": "Diegetic sound design note + music mood if applicable",
      "transition_to_next": "How this scene's ending LEADS into the next (spatial/emotional/thematic bridge)"
    }
  ]
}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. SHOT PLANNER — Director of Photography + 1st AD + Script Supervisor
//    Breaks one scene into a professional shot list with coverage strategy
// ═════════════════════════════════════════════════════════════════════════════
export function generateShotListPrompt(inputs: {
    scene: any;
    characterBible: any[];
    styleBible: any;
    directorControls?: DirectorControlsInput;
}): string {
    const dc = inputs.directorControls || {};

    const charRef = inputs.characterBible.length > 0
        ? `\n◈ LOCKED CAST (use exact IDs — do NOT invent new characters):\n${inputs.characterBible.map(c =>
            `  ${c.name} [ID: "${c.character_id}"] — ${c.face_traits || ''}, ${c.outfit || ''}`
          ).join('\n')}\n`
        : '';

    const styleRef = inputs.styleBible ? `
◈ STYLE BIBLE (every shot must honour these):
  Lens: ${inputs.styleBible.lens_language || 'cinematic 35mm-85mm range'}
  Lighting: ${inputs.styleBible.lighting || 'motivated naturalistic'}
  Palette: ${inputs.styleBible.color_palette || 'cinematic realism'}
  Art Direction: ${inputs.styleBible.art_direction || 'grounded production design'}
` : '';

    const shotDensity = dc.shotDensity ?? 5;
    const shotCount = shotDensity <= 3 ? '2-3' : shotDensity >= 8 ? '5-7' : '3-5';
    const dialogueDensity = dc.dialogueDensity ?? 40;
    const subtextLevel = dc.subtextLevel ?? 60;
    const tension = Number(inputs.scene.tension_level || 5);

    const dialogueRule = dialogueDensity < 25
        ? 'MOSTLY SILENT — let the image carry meaning. Dialogue only at a single critical beat.'
        : dialogueDensity > 70
        ? 'DIALOGUE-HEAVY — characters must articulate their wants and conflicts verbally.'
        : 'BALANCED — dialogue appears at emotional peaks, silence elsewhere.';

    const subtextRule = subtextLevel > 65
        ? 'Characters speak about one thing but mean another entirely. Subtext IS the text.'
        : subtextLevel < 30
        ? 'Direct, explicit dialogue — characters say exactly what they mean.'
        : 'Moderate subtext — what is NOT said is as important as what is said.';

    const cameraRule = tension >= 8
        ? 'HIGH TENSION: tight focal lengths (85-135mm), minimal movement, claustrophobic framing'
        : tension <= 3
        ? 'LOW TENSION: wide angles (24-35mm), stable platforms, breathing room in frame'
        : 'MODERATE TENSION: mix of coverage sizes, motivated movement';

    return `╔══════════════════════════════════════════════════════════════════════════╗
║   AI CINE DIRECTOR — SHOT PLANNER v3.0                                 ║
║   Persona: OSCAR-WINNING DOP + 1ST AD + WGA SCRIPT SUPERVISOR          ║
╚══════════════════════════════════════════════════════════════════════════╝

You are simultaneously:
  ① A master DIRECTOR OF PHOTOGRAPHY who has shot major studio films
    (Roger Deakins' precision, Emmanuel Lubezki's movement, Hoyte van Hoytema's intimacy)
  ② A professional 1ST ASSISTANT DIRECTOR who understands coverage and continuity
  ③ A WGA SCRIPT SUPERVISOR who ensures every word serves a purpose

━━━ SCENE BRIEF ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Scene ${inputs.scene.scene_number} | Act ${inputs.scene.act || '?'}
Dramatic function: ${inputs.scene.dramatic_function || 'scene'}
Location: ${inputs.scene.location}
Time: ${inputs.scene.time_of_day} | Weather: ${inputs.scene.weather_atmosphere || 'clear'}
Tension: ${tension}/10
Synopsis: ${inputs.scene.synopsis}
Character goal: ${inputs.scene.character_goal || 'pursue desire'}
Scene obstacle: ${inputs.scene.scene_obstacle || 'opposition'}
Emotional goal (audience): ${inputs.scene.emotional_goal}
${charRef}${styleRef}
━━━ CINEMATOGRAPHY LAWS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

① COVERAGE STRATEGY
   Shoot ${shotCount} shots. Sequence must provide logical editorial coverage:
   • Establish → Cover → React → Insert (not all required, but use as toolkit)
   • 180-DEGREE RULE: maintain consistent screen direction throughout scene
   • EYELINE MATCHING: if character A looks right, character B must look left
   • ${cameraRule}

② FOCAL LENGTH PRECISION (not just "close-up" — specify the LENS)
   • Wide shot: 24mm or 35mm (specify which and why — more distortion = more tension)
   • Medium shot: 50mm (the most "human" neutral lens)
   • Close-up: 85mm (flattering compression, emotional intimacy)
   • Extreme close-up: 135mm+ (maximum compression, micro-expression isolation)
   • Use zoom only if it carries narrative meaning (rarely)

③ BLOCKING & CHARACTER POSITIONING
   For each shot, state where characters are in the frame:
   • Foreground / midground / background positioning
   • Power dynamics expressed through height and proximity
   • Physical distance between characters = emotional distance

④ CAMERA MOVEMENT MOTIVATION
   Every camera move must be motivated:
   • STATIC: character has control of the scene / tension is internalised
   • PUSH-IN: realisation, mounting dread, intimate revelation
   • PULL-OUT: isolation, loss, gaining distance from a decision
   • TRACKING/DOLLY: character in motion, parallel to their journey
   • HANDHELD: instability, urgency, subjective anxiety
   • CRANE/DUTCH: god's-eye view, disorientation, power shift

⑤ LIGHTING SETUP (per shot — do NOT just repeat style bible globally)
   Specify the PRACTICAL LIGHT SOURCE that motivates the shot:
   e.g. "Window at screen-left at 3/4 angle, harsh Rembrandt shadow on face"
   e.g. "Overhead practical bulb, underlit — threat implied"
   e.g. "Candle at foreground-right, everything beyond falls to darkness"

⑥ PHYSICAL ACTION — BODY MECHANICS PRECISION
   action field must be specific enough to direct an actor:
   ✗ WRONG: "She walks to the window"
   ✓ CORRECT: "She crosses frame left to right in three deliberate steps, pauses
     at the window with her back to camera, one hand rising to touch the glass"

⑦ DIALOGUE STANDARD: ${dialogueRule}
   SUBTEXT STANDARD: ${subtextRule}
   Every dialogue line must pass this test: could it be cut without losing
   plot? If yes — cut it. Only keep lines that are irreplaceable.

⑧ IMAGE PROMPT — MINIMUM 80 WORDS
   The image_prompt must be a professional Flux/Midjourney-level prompt:
   • Lead with subject + specific action + micro-expression
   • State focal length and depth of field explicitly
   • Name the specific light source and its direction
   • Describe foreground/midground/background depth staging
   • Include colour grading note (e.g. "desaturated teal shadow, warm amber highlight")
   • Include film stock or rendering feel (e.g. "35mm grain, Kodak Vision3 250D")

⑨ VIDEO PROMPT — PHYSICAL CHOREOGRAPHY PRECISION
   The video_prompt must describe motion that a video diffusion model can execute:
   • Lead with camera movement verb + direction + speed
   • Describe the exact body mechanics of every moving element
   • Include environmental physics (fabric movement, hair, light shift)
   • State what the FINAL FRAME should look like before the cut
   • Duration hint: how many seconds should this motion take
   ✗ WRONG: "camera moves as she talks"
   ✓ CORRECT: "Slow push-in from medium to close-up over 4 seconds as she
     turns her head left, jaw tightening, eyes dropping to the table surface,
     right hand clenching into a fist at her side off-frame"

━━━ OUTPUT FORMAT — strict JSON, no markdown, no code fences ━━━━━━━━━━━━
{
  "shots": [
    {
      "shot_id": "shot_[scene_number]_[shot_number]",
      "shot_number": 1,
      "shot_type": "establishing|master|single|two-shot|over-shoulder|insert|cutaway|pov|reaction",
      "characters": ["exact character_id array from LOCKED CAST above"],
      "blocking": "Where characters are positioned in frame relative to each other and the camera",
      "action": "Precise body-mechanics description of what happens (minimum 2 sentences)",
      "camera_angle": "wide|medium|close|ecu|over-shoulder|pov|dutch|high-angle|low-angle",
      "focal_length": "24mm|35mm|50mm|85mm|135mm|zoom",
      "camera_movement": "static|push-in|pull-out|pan-left|pan-right|tilt-up|tilt-down|dolly|tracking|handheld|crane",
      "movement_motivation": "Why this camera move is the only correct choice here",
      "composition": "Specific rule-of-thirds/symmetry/lead-room description with depth staging",
      "lighting_setup": "Named light source + direction + shadow quality + fill ratio",
      "duration_sec": 4,
      "emotional_beat": "The micro-psychological state of the POV character in this exact frame",
      "dialogue": {
        "speaker_id": "character_id or null",
        "speaker_name": "Character name or null",
        "line": "Exact spoken words — every word earns its place, or null",
        "delivery_note": "How the line is said — pace, tone, physicality during delivery",
        "subtext": "What the character actually means / fears / wants but cannot say"
      },
      "image_prompt": "Professional 80+ word image generation prompt: subject + action + micro-expression + focal length + depth of field + specific light source + depth staging + colour grade + film stock feel",
      "video_prompt": "Professional motion description: camera movement + direction + speed + body mechanics of all moving elements + environmental physics + final frame state",
      "audio_notes": "Diegetic sound design for this shot (footsteps on surface type, ambient room tone, practical sounds, music swell if applicable)",
      "transition": "cut|dissolve|fade|match_cut|smash_cut|wipe",
      "transition_rationale": "Why this transition is the right edit choice here",
      "continuity_notes": "What must be preserved from the previous shot into this one"
    }
  ]
}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. IMAGE PROMPT — Flux/SDXL-optimised still frame directive
//    Merges character bible + shot + style into a photorealistic prompt
// ═════════════════════════════════════════════════════════════════════════════
export function buildImagePrompt(inputs: {
    shot: any;
    scene: any;
    characterBible: any[];
    styleBible: any;
    directorControls?: DirectorControlsInput;
}): string {
    const charsInShot: any[] = (inputs.shot.characters || [])
        .map((id: string) => inputs.characterBible.find((c: any) => c.character_id === id))
        .filter(Boolean);

    // Build ultra-precise character description with every biometric field
    const charBlock = charsInShot.map((c: any) => {
        const parts = [
            c.name,
            c.age ? `(${c.age})` : '',
            c.face_traits || '',
            c.hair ? `hair: ${c.hair}` : '',
            c.body_type || '',
            c.outfit ? `wearing ${c.outfit}` : '',
            c.props ? `holding ${c.props}` : '',
            c.physical_signature ? `[${c.physical_signature}]` : '',
        ].filter(Boolean).join(', ');
        return parts;
    }).join(' | ');

    const dc = inputs.directorControls || {};
    const focalLength = inputs.shot.focal_length || '85mm';
    const lightingSetup = inputs.shot.lighting_setup || inputs.styleBible?.lighting || 'motivated cinematic lighting';
    const composition = inputs.shot.composition || 'rule of thirds, subject at golden ratio point';
    const palette = inputs.styleBible?.color_palette || 'cinematic colour grading';
    const lensLang = inputs.styleBible?.lens_language || 'anamorphic lens';
    const artDir = inputs.styleBible?.art_direction || 'high production value';
    const emotion = inputs.shot.emotional_beat || 'cinematic tension';
    const action = inputs.shot.action || '';
    const location = `${inputs.scene.location || ''}, ${inputs.scene.time_of_day || ''}, ${inputs.scene.weather_atmosphere || ''}`;

    // If the shot already has a pre-generated image_prompt, use it as the foundation
    const basePrompt = inputs.shot.image_prompt || '';

    if (basePrompt && basePrompt.split(' ').length >= 40) {
        // Enrich an existing prompt with style-bible anchors
        return [
            `FILM CONSISTENCY LOCK [${palette} | ${lensLang}].`,
            basePrompt,
            charBlock ? `Characters: ${charBlock}.` : '',
            `Shot: ${focalLength}, ${composition}.`,
            `Light: ${lightingSetup}.`,
            `${artDir}. Cinematic photorealism, 8K, single coherent film frame.`,
        ].filter(Boolean).join(' ');
    }

    // Build from scratch with full precision
    return [
        charBlock ? `SUBJECT: ${charBlock}.` : 'Environmental shot — no character required.',
        `ACTION & EXPRESSION: ${action}. Emotional state: ${emotion}.`,
        `SETTING: ${location}. ${artDir}.`,
        `CAMERA: ${focalLength} lens, ${composition}, ${lensLang}. Depth of field: ${inputs.shot.camera_angle === 'ecu' || inputs.shot.camera_angle === 'close' ? 'extremely shallow, subject sharp, background smooth bokeh' : 'moderate depth, environmental context visible'}.`,
        `LIGHTING: ${lightingSetup}. ${palette} colour script.`,
        dc.visualPhilosophy ? `VISUAL PHILOSOPHY: ${dc.visualPhilosophy}.` : '',
        `QUALITY: Cinematic photorealism, film grain texture, single coherent frame — not a collage. Kodak Vision3 emulsion feel. 4K resolution, physically plausible lighting.`,
    ].filter(Boolean).join(' ');
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. VIDEO PROMPT — Temporal choreography for diffusion video models
//    Specifies body mechanics, camera operation, and environmental physics
// ═════════════════════════════════════════════════════════════════════════════
export function buildVideoPrompt(inputs: {
    shot: any;
    scene?: any;
    styleBible?: any;
    directorControls?: DirectorControlsInput;
    /** Director OS temporal guidance */
    temporalGuidance?: {
        previous_visual_state?: string;
        start_frame_intent?: string;
        mid_frame_intent?: string;
        end_frame_intent?: string;
        next_visual_target_state?: string;
    };
}): string {
    const parts: string[] = [];
    const dc = inputs.directorControls || {};
    const tg = inputs.temporalGuidance;
    const tension = Number(inputs.scene?.tension_level || 5);

    // ── 1. Camera operation (MUST be first — model weights it highest) ─────────
    const cameraMove = inputs.shot.camera_movement || 'static';
    const movementMotivation = inputs.shot.movement_motivation || '';
    const speedDesc = tension >= 8 ? 'quickly' : tension <= 3 ? 'imperceptibly slowly' : 'steadily';

    const cameraDesc: Record<string, string> = {
        'static': 'Locked-off camera — no movement, absolute stillness',
        'push-in': `Slow push-in toward subject at ${speedDesc} pace, closing distance`,
        'pull-out': `Steady pull-back, ${speedDesc}, revealing negative space around subject`,
        'pan-left': `Horizontal pan left at ${speedDesc} controlled speed`,
        'pan-right': `Horizontal pan right at ${speedDesc} controlled speed`,
        'tilt-up': `Vertical tilt upward, ${speedDesc}, revealing height`,
        'tilt-down': `Vertical tilt down, ${speedDesc}`,
        'dolly': `Dolly movement along tracking axis, ${speedDesc}, maintaining framing`,
        'tracking': `Tracking alongside subject at matching pace, camera parallel to motion`,
        'handheld': `Handheld — subtle organic sway, breathing camera, nervous energy`,
        'crane': `Crane or drone rise, ${speedDesc}, expanding spatial context`,
    };
    parts.push(cameraDesc[cameraMove] || `Camera: ${cameraMove}`);
    if (movementMotivation) parts.push(`(${movementMotivation})`);

    // ── 2. Subject body mechanics ─────────────────────────────────────────────
    const action = inputs.shot.video_prompt || inputs.shot.action || '';
    if (action) {
        parts.push(`SUBJECT ACTION: ${action}`);
    }

    // ── 3. Facial expression + micro-expression ───────────────────────────────
    const emotion = inputs.shot.emotional_beat || '';
    if (emotion) {
        parts.push(`EXPRESSION: ${emotion} — facial muscles show ${
            emotion.toLowerCase().includes('fear') ? 'micro-tension at jaw and eye corners, pupils dilating' :
            emotion.toLowerCase().includes('grief') ? 'subtle lip tremor, eyes glistening, brow slightly furrowed' :
            emotion.toLowerCase().includes('anger') ? 'jaw clenching, nostril flaring, eyes narrowing with intensity' :
            emotion.toLowerCase().includes('joy') ? 'genuine Duchenne smile, crows feet engagement, relaxed brow' :
            emotion.toLowerCase().includes('resolve') ? 'steady gaze, controlled breathing, stillness as strength' :
            'complex mixed emotion readable through subtle facial micro-movements'
        }`);
    }

    // ── 4. Environmental physics ──────────────────────────────────────────────
    const timeOfDay = inputs.scene?.time_of_day || '';
    const weather = inputs.scene?.weather_atmosphere || '';
    if (weather && weather !== 'clear' && weather !== '') {
        parts.push(`ENVIRONMENT: ${weather} conditions — ${
            weather.toLowerCase().includes('wind') ? 'fabric and hair respond to air currents' :
            weather.toLowerCase().includes('rain') ? 'surface reflections, droplets on glass, wet textures' :
            weather.toLowerCase().includes('fog') ? 'diffused light, reduced depth visibility, atmospheric perspective' :
            'natural environmental physics active'
        }`);
    }

    // ── 5. Lighting behaviour during motion ───────────────────────────────────
    const lighting = inputs.shot.lighting_setup || inputs.styleBible?.lighting || '';
    if (lighting) {
        parts.push(`LIGHT BEHAVIOUR: ${lighting} — light quality stable unless subject moves through it`);
    }

    // ── 6. Director OS temporal guidance ─────────────────────────────────────
    if (tg?.previous_visual_state) {
        parts.push(`CONTINUITY FROM PREVIOUS SHOT: ${tg.previous_visual_state}`);
    }
    if (tg?.start_frame_intent) {
        parts.push(`OPENING FRAME: ${tg.start_frame_intent}`);
    }
    if (tg?.mid_frame_intent) {
        parts.push(`MID FRAME: ${tg.mid_frame_intent}`);
    }
    if (tg?.end_frame_intent) {
        parts.push(`CLOSING FRAME: ${tg.end_frame_intent}`);
    }
    if (tg?.next_visual_target_state) {
        parts.push(`MUST TRANSITION INTO: ${tg.next_visual_target_state}`);
    }

    // ── 7. Pacing from director controls ─────────────────────────────────────
    if (dc.pacing) {
        parts.push(`Pacing: ${dc.pacing}`);
    } else {
        parts.push(tension >= 8 ? 'Pacing: rapid and urgent, every frame counts' :
            tension <= 3 ? 'Pacing: unhurried, contemplative, let moments breathe' :
            'Pacing: measured, dramatic, neither rushed nor lingering');
    }

    // ── 8. Consistency lock (always last — model must not drift) ─────────────
    parts.push('CHARACTER LOCK: Maintain exact subject appearance — face, hair, outfit, props unchanged from first frame. No identity drift. No wardrobe changes. No background geometry changes.');

    return parts.join('. ') + '.';
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. VOICE DIRECTION — Character-specific ElevenLabs casting guide
//    Produces per-character vocal performance notes
// ═════════════════════════════════════════════════════════════════════════════
export function buildVoiceDirectionPrompt(character: any, line: string, subtext: string, deliveryNote: string): string {
    const voicePattern = character.voice_pattern || '';
    const emotion = deliveryNote || '';

    return `CHARACTER: ${character.name}
VOICE PATTERN: ${voicePattern}
LINE: "${line}"
SUBTEXT (what they really mean): ${subtext}
DELIVERY: ${emotion}

PERFORMANCE NOTE: Speak this line as if ${character.name} is ${
        voicePattern.includes('fast') ? 'rushing to get the words out before they lose courage' :
        voicePattern.includes('slow') ? 'choosing every word carefully, each one costing something' :
        voicePattern.includes('soft') ? 'keeping their voice low to prevent cracking' :
        'in complete control of their voice but not their feelings'
    }. The subtext must bleed through the delivery without being stated.`;
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. BACKGROUND MUSIC DIRECTION — Scene-level music brief
// ═════════════════════════════════════════════════════════════════════════════
export function buildMusicDirectionPrompt(scene: any, styleBible: any): string {
    const tension = Number(scene.tension_level || 5);
    const emotionalGoal = scene.emotional_goal || 'tension';
    const timeOfDay = scene.time_of_day || '';
    const location = scene.location || '';
    const soundDesign = styleBible?.sound_design || '';

    const musicMood = tension >= 8 ? 'urgent, driving, dissonant undercurrent' :
        tension >= 6 ? 'mounting, tense, rhythmic pulse' :
        tension >= 4 ? 'atmospheric, emotive, melodic tension' :
        tension >= 2 ? 'gentle, melancholic, introspective' :
        'sparse, barely-there, acoustic intimacy';

    return `Scene music brief for: ${scene.synopsis || 'scene'}
Location feel: ${location}, ${timeOfDay}
Emotional target: ${emotionalGoal}
Tension: ${tension}/10
Style: ${soundDesign || 'cinematic orchestral with contemporary elements'}
Required mood: ${musicMood}
Instrumentation: ${
        tension >= 7 ? 'low strings, brass stabs, electronic pulse' :
        tension >= 4 ? 'piano, strings, subtle electronic texture' :
        'solo instrument (piano or strings), room ambience, minimal arrangement'
    }
Duration: Match scene video duration
Notes: Music must serve the emotion — not decorate it. Silence is valid.`;
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. FINAL CUT ASSEMBLY BRIEF — For the video stitcher
// ═════════════════════════════════════════════════════════════════════════════
export function buildFinalCutBrief(project: any): string {
    return `FINAL CUT ASSEMBLY for: ${project.logline || project.title || 'Untitled'}
Total scenes: ${project.scenes?.length || 0}
Total shots: ${project.shots?.length || 0}

EDITING PHILOSOPHY:
• Every cut must have a PURPOSE — rhythm, revelation, or contrast
• Match cuts on action where possible for invisible editing
• Use insert cuts to break long takes and maintain audience engagement
• Sound bridge cuts: let audio from next scene start before the image cuts
• Music must breathe — don't let it compete with dialogue

TRANSITION GUIDE:
• CUT: default — instant, clean, present tense
• DISSOLVE: time passing, dream/memory, gentle transition
• MATCH CUT: visual/spatial rhyme between shots — elegant reveal
• SMASH CUT: violent contrast — comedy or horror punctuation
• FADE TO BLACK: end of chapter, death, passage of significant time

AUDIO MIX PHILOSOPHY:
• Dialogue: -12 to -6 dBFS (intelligibility first)
• Music: -18 to -12 dBFS (atmospheric, not dominating)
• SFX/Ambient: -24 to -18 dBFS (grounding, not decorating)
• Music always ducks -6dB under dialogue`;
}

export function generateContinuityValidationPrompt(): string {
    return `Analyse the provided frame from a newly generated shot against the continuity bibles.
Return a continuity score (0-100) and strict boolean flags:
- face_match: does the face match the character bible biometric description?
- outfit_match: is the wardrobe identical to the bible entry for this scene?
- environment_match: does the background match the established scene geography?
- lighting_match: does the light quality and direction match the preceding shot?

Flag any drift with specific descriptions of what changed.`;
}
