type Dict = Record<string, any>;

const asText = (v: any, fallback = ''): string => String(v ?? fallback).trim();
const lower = (v: any): string => asText(v).toLowerCase();
const arr = <T = any>(v: any): T[] => Array.isArray(v) ? v : [];

export interface DirectorBrainLayer {
  story_arc: {
    opening: string;
    development: string;
    climax: string;
    resolution: string;
  };
  emotional_beats: Array<{ beat_id: string; scene_id?: string; intensity: number; emotion: string; intent: string }>;
  visual_beats: Array<{ beat_id: string; scene_id?: string; framing: string; camera_angle: string; lens: string; lighting: string }>;
  pacing_strategy: {
    global_pacing: string;
    fast_sections: string[];
    slow_sections: string[];
    rhythm_notes: string[];
  };
  directorial_rules: string[];
  character_focus_rules: Array<{ character_id: string; focus_style: string; prohibited_drift: string[] }>;
  continuity_rules: string[];
}

export interface StoryboardPanel {
  panel_id: string;
  panel_index: number;
  source_scene_id?: string;
  beat_summary: string;
  location: string;
  characters: string[];
  action: string;
  emotional_intent: string;
  framing: string;
  camera_angle: string;
  continuity_anchor: string;
  audio_intent: string;
}

export interface CharacterIdentityProfile {
  character_id: string;
  canonical_description: string;
  forbidden_drift_rules: string[];
  reference_assets: string[];
  appearance_anchors: string[];
  voice_anchors: string[];
  motion_anchors: string[];
  emotion_range_constraints: string[];
}

export interface CharacterIdentityLaw {
  character_registry: Array<{ character_id: string; name: string }>;
  identity_lock_bundle: {
    lock_version: string;
    stable_anchor_descriptors: string[];
    face_body_consistency_rules: string[];
    outfit_memory: Record<string, string>;
    prop_memory: Record<string, string>;
  };
  profiles: CharacterIdentityProfile[];
}

export interface ShotTemporalGuidance {
  previous_visual_state: string;
  current_target_frame_state: string;
  next_visual_target_state: string;
  start_frame_intent: string;
  middle_motion_intent: string;
  end_frame_intent: string;
}

export interface ShotGraphNode {
  shot_id: string;
  panel_id: string;
  panel_index: number;
  prev_shot_id?: string;
  next_shot_id?: string;
  shot_role: 'setup' | 'handoff' | 'reaction' | 'transition' | 'push' | 'climax';
  entering_state: string;
  exiting_state: string;
  continuity_in: string;
  continuity_out: string;
  motion_bridge: string;
  expression_bridge: string;
  environment_bridge: string;
  object_bridge: string;
  temporal_guidance: ShotTemporalGuidance;
}

export function buildDirectorBrainLayer(input: {
  scenes: any[];
  style_bible?: Dict;
  character_bible?: any[];
  director_controls?: Dict;
  logline?: string;
}): DirectorBrainLayer {
  const scenes = arr(input.scenes);
  const opening = asText(scenes[0]?.synopsis || scenes[0]?.visual_description || input.logline || 'Opening setup');
  const climaxCandidate = scenes.find((s: any) => lower(s?.dramatic_function).includes('climax')) || scenes[Math.max(0, Math.floor(scenes.length * 0.75))];
  const resolutionCandidate = scenes.find((s: any) => lower(s?.dramatic_function).includes('resolution')) || scenes[scenes.length - 1];
  const development = scenes.slice(1, Math.max(2, scenes.length - 1)).map((s: any) => asText(s?.synopsis || s?.visual_description)).filter(Boolean).slice(0, 3).join(' | ');

  const emotional_beats = scenes.map((s: any, i: number) => ({
    beat_id: `emo_${i + 1}`,
    scene_id: s?.scene_id,
    intensity: Math.max(1, Math.min(10, Number(s?.tension_level || 5))),
    emotion: asText(s?.emotional_goal || s?.emotional_beat || 'dramatic tension'),
    intent: asText(s?.dramatic_function || 'story progression'),
  }));

  const visual_beats = scenes.map((s: any, i: number) => ({
    beat_id: `vis_${i + 1}`,
    scene_id: s?.scene_id,
    framing: asText(s?.framing || s?.composition || 'balanced cinematic framing'),
    camera_angle: asText(s?.camera_angle || 'medium'),
    lens: asText(input.style_bible?.lens_language || input.director_controls?.preferredLens || '35mm cinematic'),
    lighting: asText(s?.lighting || input.style_bible?.lighting || 'motivated practical lighting'),
  }));

  const fast_sections = scenes
    .filter((s: any) => Number(s?.tension_level || 5) >= 7)
    .map((s: any) => asText(s?.scene_id || s?.scene_number));
  const slow_sections = scenes
    .filter((s: any) => Number(s?.tension_level || 5) <= 3)
    .map((s: any) => asText(s?.scene_id || s?.scene_number));

  return {
    story_arc: {
      opening,
      development: development || 'Escalating conflict and emotional turns',
      climax: asText(climaxCandidate?.synopsis || climaxCandidate?.visual_description || 'Narrative high point'),
      resolution: asText(resolutionCandidate?.synopsis || resolutionCandidate?.visual_description || 'Narrative closure'),
    },
    emotional_beats,
    visual_beats,
    pacing_strategy: {
      global_pacing: asText(input.director_controls?.pacing || 'steady'),
      fast_sections,
      slow_sections,
      rhythm_notes: [
        'Use tighter framing and shorter durations for high tension beats',
        'Use wider staging and ambient holds for emotional reset beats',
      ],
    },
    directorial_rules: [
      'Character identity continuity outranks style novelty',
      'Every shot must carry narrative purpose and temporal handoff',
      'Preserve screen direction across connected action beats',
      'Lighting continuity must follow source motivation changes only',
    ],
    character_focus_rules: arr(input.character_bible).map((c: any) => ({
      character_id: asText(c?.character_id || c?.id),
      focus_style: 'Prioritize readable face and gesture during emotional turns',
      prohibited_drift: [
        'No face morphology drift',
        'No unexplained costume replacement',
        'No prop identity substitution',
      ],
    })),
    continuity_rules: [
      'Preserve face/body silhouette across sequence',
      'Preserve outfit + accessories unless scripted change',
      'Preserve location geometry and light motivation',
      'Preserve object ownership and handedness where visible',
      'Preserve emotional transition plausibility between adjacent shots',
    ],
  };
}

export function build12PanelStoryboard(input: {
  scenes: any[];
  shots?: any[];
  directorBrain: DirectorBrainLayer;
}): StoryboardPanel[] {
  const scenes = arr(input.scenes);
  if (scenes.length === 0) {
    return Array.from({ length: 12 }).map((_, i) => ({
      panel_id: `panel_${String(i + 1).padStart(2, '0')}`,
      panel_index: i + 1,
      beat_summary: 'Pending scene planning',
      location: 'TBD',
      characters: [],
      action: 'TBD',
      emotional_intent: 'TBD',
      framing: 'medium',
      camera_angle: 'eye-level',
      continuity_anchor: 'maintain identity lock',
      audio_intent: 'ambient continuity',
    }));
  }

  const picks: StoryboardPanel[] = [];
  for (let i = 0; i < 12; i += 1) {
    const sceneIdx = Math.min(scenes.length - 1, Math.floor((i / 12) * scenes.length));
    const scene = scenes[sceneIdx] || {};
    picks.push({
      panel_id: `panel_${String(i + 1).padStart(2, '0')}`,
      panel_index: i + 1,
      source_scene_id: asText(scene.scene_id || scene.id || `scene_${sceneIdx + 1}`),
      beat_summary: asText(scene.synopsis || scene.visual_description || `Narrative beat ${i + 1}`),
      location: asText(scene.location || scene.scene_setting || 'Unknown location'),
      characters: arr(scene.characters).map((x: any) => asText(x)).filter(Boolean),
      action: asText(scene.action || scene.synopsis || 'Narrative action progression'),
      emotional_intent: asText(scene.emotional_goal || scene.emotional_beat || 'dramatic continuity'),
      framing: asText(scene.framing || scene.composition || 'medium framing'),
      camera_angle: asText(scene.camera_angle || 'eye-level'),
      continuity_anchor: asText(scene.continuity_anchor || `carry over from panel ${Math.max(1, i)}`),
      audio_intent: asText(scene.audio_hint || scene.audio_description || 'dialogue + ambient bed'),
    });
  }
  return picks;
}

export function buildCharacterIdentityLaw(input: {
  character_bible?: any[];
  character_anchor?: string;
  story_entities?: any[];
}): CharacterIdentityLaw {
  const bible = arr(input.character_bible);
  const entities = arr(input.story_entities).filter((e) => e?.type === 'character');

  const profiles: CharacterIdentityProfile[] = bible.map((c: any) => ({
    character_id: asText(c.character_id || c.id || c.name),
    canonical_description: [
      asText(c.name),
      asText(c.face_traits),
      asText(c.hair),
      asText(c.body_type),
      asText(c.age),
      asText(c.outfit),
      asText(c.props),
    ].filter(Boolean).join(' | '),
    forbidden_drift_rules: [
      'No face shape drift',
      'No eye/nose/mouth topology drift',
      'No body proportion drift',
      'No unplanned age shift',
      'No outfit replacement without scripted reason',
    ],
    reference_assets: arr(c.reference_assets).map((x: any) => asText(x)).filter(Boolean),
    appearance_anchors: [asText(c.face_traits), asText(c.hair), asText(c.outfit)].filter(Boolean),
    voice_anchors: [asText(c.voice || c.voice_id || 'default_character_voice')],
    motion_anchors: [asText(c.motion || 'signature gesture continuity')],
    emotion_range_constraints: [asText(c.emotion_range || 'coherent emotional transition only')],
  }));

  const outfit_memory: Record<string, string> = {};
  const prop_memory: Record<string, string> = {};
  profiles.forEach((p) => {
    outfit_memory[p.character_id] = p.appearance_anchors.find((a) => lower(a).includes('outfit')) || p.canonical_description;
    prop_memory[p.character_id] = p.canonical_description;
  });

  return {
    character_registry: entities.map((e: any) => ({
      character_id: asText(e.id || e.character_id || e.name),
      name: asText(e.name || 'Unknown Character'),
    })),
    identity_lock_bundle: {
      lock_version: `identity-lock-${new Date().toISOString().slice(0, 10)}`,
      stable_anchor_descriptors: [asText(input.character_anchor)].filter(Boolean),
      face_body_consistency_rules: [
        'Face, body, hair, age signature must remain stable',
        'Wardrobe continuity is mandatory unless explicitly switched',
      ],
      outfit_memory,
      prop_memory,
    },
    profiles,
  };
}

export function buildSequenceContext(nodes: ShotGraphNode[], idx: number) {
  return {
    previous: idx > 0 ? nodes[idx - 1] : null,
    current: nodes[idx],
    next: idx < nodes.length - 1 ? nodes[idx + 1] : null,
  };
}

export function buildFrameTransitionPlan(input: {
  previous?: ShotGraphNode | null;
  current: ShotGraphNode;
  next?: ShotGraphNode | null;
}) {
  return {
    start_frame_intent: input.previous?.exiting_state || input.current.entering_state,
    middle_motion_intent: input.current.motion_bridge,
    end_frame_intent: input.next?.entering_state || input.current.exiting_state,
  };
}

export function buildShotTemporalGuidance(input: {
  previous?: ShotGraphNode | null;
  current: ShotGraphNode;
  next?: ShotGraphNode | null;
}): ShotTemporalGuidance {
  const transition = buildFrameTransitionPlan(input);
  return {
    previous_visual_state: input.previous?.exiting_state || 'sequence opening state',
    current_target_frame_state: input.current.exiting_state,
    next_visual_target_state: input.next?.entering_state || 'sequence closing state',
    start_frame_intent: transition.start_frame_intent,
    middle_motion_intent: transition.middle_motion_intent,
    end_frame_intent: transition.end_frame_intent,
  };
}

export function buildShotGraph(input: {
  shots: any[];
  panels: StoryboardPanel[];
}): ShotGraphNode[] {
  const sorted = [...arr(input.shots)].sort((a: any, b: any) => (Number(a.sequence_order || a.shot_number || 0) - Number(b.sequence_order || b.shot_number || 0)));
  const panels = arr(input.panels);

  const nodes: ShotGraphNode[] = sorted.map((shot: any, idx: number) => {
    const panel = panels[Math.min(panels.length - 1, Math.floor((idx / Math.max(1, sorted.length)) * panels.length))] || panels[0];
    const prev = idx > 0 ? sorted[idx - 1] : null;
    const next = idx < sorted.length - 1 ? sorted[idx + 1] : null;

    const role: ShotGraphNode['shot_role'] = idx === 0
      ? 'setup'
      : idx === sorted.length - 1
      ? 'climax'
      : idx % 5 === 0
      ? 'transition'
      : idx % 3 === 0
      ? 'reaction'
      : 'push';

    const entering = asText(shot.continuity_from_previous || shot.action || 'enter with previous state continuity');
    const exiting = asText(shot.continuity_to_next || shot.action || 'exit with narrative handoff');

    const node: ShotGraphNode = {
      shot_id: asText(shot.shot_id || shot.id || `shot_${idx + 1}`),
      panel_id: asText(panel?.panel_id || `panel_${String((idx % 12) + 1).padStart(2, '0')}`),
      panel_index: Number(panel?.panel_index || ((idx % 12) + 1)),
      prev_shot_id: prev ? asText(prev.shot_id || prev.id) : undefined,
      next_shot_id: next ? asText(next.shot_id || next.id) : undefined,
      shot_role: role,
      entering_state: entering,
      exiting_state: exiting,
      continuity_in: asText(shot.continuity_from_previous || 'inherit identity + position + light axis'),
      continuity_out: asText(shot.continuity_to_next || 'handoff with motion and expression continuity'),
      motion_bridge: `${asText(prev?.camera_motion || 'hold')} -> ${asText(shot.camera_motion || 'motivated motion')}`,
      expression_bridge: `${asText(prev?.emotional_beat || 'neutral tension')} -> ${asText(shot.emotional_beat || 'current emotional beat')}`,
      environment_bridge: `${asText(prev?.scene_setting || prev?.location || 'same environment')} -> ${asText(shot.scene_setting || shot.location || 'current environment')}`,
      object_bridge: `${asText(prev?.props || 'prop continuity')} -> ${asText(shot.props || 'prop continuity')}`,
      temporal_guidance: {
        previous_visual_state: 'pending',
        current_target_frame_state: 'pending',
        next_visual_target_state: 'pending',
        start_frame_intent: 'pending',
        middle_motion_intent: 'pending',
        end_frame_intent: 'pending',
      },
    };

    return node;
  });

  nodes.forEach((node, idx) => {
    const seq = buildSequenceContext(nodes, idx);
    node.temporal_guidance = buildShotTemporalGuidance({
      previous: seq.previous,
      current: seq.current,
      next: seq.next,
    });
  });

  return nodes;
}

export function validateContinuityAgainstPrevNext(input: {
  previous?: ShotGraphNode | null;
  current: ShotGraphNode;
  next?: ShotGraphNode | null;
}) {
  const failures: string[] = [];
  if (input.previous && lower(input.current.environment_bridge).includes('unknown')) {
    failures.push('environment continuity unresolved');
  }
  if (input.previous && lower(input.current.expression_bridge).includes('neutral') && lower(input.previous.expression_bridge).includes('climax')) {
    failures.push('emotion continuity drop too abrupt');
  }
  if (input.next && !input.current.next_shot_id) {
    failures.push('missing next shot link');
  }

  return {
    pass: failures.length === 0,
    score: Math.max(0, 100 - failures.length * 25),
    failures,
  };
}

export function buildEditPlan(input: {
  project_id: string;
  shots: any[];
  audioSegments?: any[];
}) {
  const shots = [...arr(input.shots)].sort((a: any, b: any) => Number(a.sequence_order || a.shot_number || 0) - Number(b.sequence_order || b.shot_number || 0));
  let cursor = 0;

  const timeline = shots.map((s: any, idx: number) => {
    const dur = Math.max(2, Number(s.duration_sec || 4));
    const start = cursor;
    cursor += dur;
    const dialogueSync = arr(input.audioSegments).find((a: any) => Number(a.sequence_order || a.shot_number || -1) === Number(s.sequence_order || s.shot_number));

    return {
      shot_id: s.shot_id,
      sequence_order: s.sequence_order || s.shot_number || idx + 1,
      start_sec: Number(start.toFixed(2)),
      end_sec: Number(cursor.toFixed(2)),
      clip_duration_sec: dur,
      image_hold_duration_sec: Math.max(1.2, Math.min(3.5, dur * 0.6)),
      motion_segment_duration_sec: Math.max(0.8, dur * 0.4),
      dialogue_sync_points: dialogueSync ? [dialogueSync.start_sec || start, dialogueSync.end_sec || cursor] : [],
      subtitle_blocks: s.dialogue_text ? [{ text: s.dialogue_text, start_sec: start, end_sec: Math.min(cursor, start + Math.max(1.5, dur * 0.8)) }] : [],
      transition_plan: idx === 0 ? 'fade_in' : (idx % 4 === 0 ? 'l_cut_candidate' : 'cut'),
      music_bed_hint: idx < 2 ? 'intro low' : idx > shots.length - 3 ? 'resolve soft' : 'adaptive underscore',
      j_cut_opportunity: idx > 0,
      l_cut_opportunity: idx < shots.length - 1,
    };
  });

  return {
    project_id: input.project_id,
    total_duration_sec: Number(cursor.toFixed(2)),
    shot_order: timeline.map((t) => t.shot_id),
    timeline,
    rough_cut_assembly: {
      mode: 'rough_cut',
      strategy: 'narrative continuity first',
    },
    preview_export: {
      format: 'mp4_preview',
      resolution: '720p',
    },
    final_assembly_plan: {
      requires_verification: true,
      pass_threshold: 80,
    },
  };
}

export function buildVerificationReport(input: {
  project: any;
  shots: any[];
  shotGraph?: ShotGraphNode[];
  timelinePlan?: any;
}) {
  const shots = arr(input.shots);
  const shotGraph = arr<ShotGraphNode>(input.shotGraph);
  const timeline = arr(input.timelinePlan?.timeline);

  const checks: Array<{ id: string; pass: boolean; score: number; reason: string }> = [];
  const failures: string[] = [];
  const retry_hints: Array<{ target: string; action: string }> = [];
  const repair_entries: Array<{ shot_id: string; issue: string; suggested_fix: string }> = [];

  // 1) Identity stability check (Character Identity Law)
  let identityFailCount = 0;
  shots.forEach((s: any) => {
    const ci = s.character_consistency || {};
    const score = Number(ci.identity_score ?? ci.score ?? 1);
    if (!Number.isFinite(score) || score < 0.72) {
      identityFailCount += 1;
      const shotId = asText(s.shot_id || s.id || 'unknown_shot');
      failures.push(`identity drift @ ${shotId}`);
      retry_hints.push({
        target: shotId,
        action: 'Regenerate with anchor/previous-frame reference and stronger character lock',
      });
      repair_entries.push({
        shot_id: shotId,
        issue: 'identity_drift',
        suggested_fix: 'Increase identity_strength, lock face/outfit anchors, enforce anchor reference policy',
      });
    }
  });

  const identityPass = identityFailCount === 0;
  checks.push({
    id: 'identity_consistency',
    pass: identityPass,
    score: Number(Math.max(0, 1 - identityFailCount / Math.max(1, shots.length)).toFixed(3)),
    reason: identityPass ? 'Character identity stable across checked shots' : `${identityFailCount} shot(s) with identity drift`,
  });

  // 2) Temporal continuity check (Prev/Next frame consistency)
  let continuityFailCount = 0;
  shotGraph.forEach((node, idx) => {
    const seq = buildSequenceContext(shotGraph, idx);
    const continuity = validateContinuityAgainstPrevNext({
      previous: seq.previous,
      current: seq.current,
      next: seq.next,
    });
    if (!continuity.pass) {
      continuityFailCount += 1;
      const shotId = asText(node.shot_id || `shot_${idx + 1}`);
      failures.push(`continuity break @ ${shotId}: ${continuity.failures.join('; ')}`);
      retry_hints.push({
        target: shotId,
        action: 'Regenerate with temporal guidance + previous-frame handoff constraints',
      });
      repair_entries.push({
        shot_id: shotId,
        issue: 'continuity_break',
        suggested_fix: 'Align entering/exiting state, preserve motion bridge and expression bridge',
      });
    }
  });

  const continuityPass = continuityFailCount === 0;
  checks.push({
    id: 'temporal_continuity',
    pass: continuityPass,
    score: Number(Math.max(0, 1 - continuityFailCount / Math.max(1, shotGraph.length || shots.length)).toFixed(3)),
    reason: continuityPass ? 'Prev/next frame continuity checks passed' : `${continuityFailCount} continuity failure(s) detected`,
  });

  // 3) Audio-video timing alignment check
  let avMismatchCount = 0;
  timeline.forEach((t: any) => {
    const dialogue = arr(t.subtitle_blocks);
    const shotDur = Number(t.clip_duration_sec || 0);
    const spokenDur = dialogue.reduce((acc: number, d: any) => {
      const segDur = Math.max(0, Number(d?.end_sec || 0) - Number(d?.start_sec || 0));
      return acc + segDur;
    }, 0);
    if (spokenDur > 0 && shotDur > 0 && spokenDur > shotDur * 1.15) {
      avMismatchCount += 1;
      const shotId = asText(t.shot_id || 'unknown_shot');
      failures.push(`audio/video mismatch @ ${shotId}`);
      retry_hints.push({
        target: shotId,
        action: 'Trim dialogue or extend shot duration in edit plan to match timing',
      });
      repair_entries.push({
        shot_id: shotId,
        issue: 'audio_video_mismatch',
        suggested_fix: 'Shift subtitle blocks and adjust clip duration/J-cut/L-cut windows',
      });
    }
  });

  const avPass = avMismatchCount === 0;
  checks.push({
    id: 'audio_video_alignment',
    pass: avPass,
    score: Number(Math.max(0, 1 - avMismatchCount / Math.max(1, timeline.length)).toFixed(3)),
    reason: avPass ? 'Audio/subtitle timing aligns with clip durations' : `${avMismatchCount} timeline mismatch(es) detected`,
  });

  // Aggregate score
  const overall = checks.length > 0
    ? checks.reduce((acc, c) => acc + c.score, 0) / checks.length
    : 0;
  const pass = checks.every((c) => c.pass);

  return {
    overall_score: Number(overall.toFixed(3)),
    pass,
    checks,
    failed_reasons: failures,
    retry_hints,

    // Extended fields used by new UI/debug flow
    failures,
    repair_entries,
  };
}

