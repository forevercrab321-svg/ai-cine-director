export type PipelineStage =
  | 'script_ready'
  | 'bible_ready'
  | 'shots_ready'
  | 'storyboard_generating'
  | 'storyboard_review'
  | 'storyboard_partial_failed'
  | 'storyboard_approved'
  | 'video_generating'
  | 'video_partial_failed'
  | 'assembly_ready'
  | 'final_ready';

export type RegenerationMode =
  | 'regenerate_same_shot_keep_bible'
  | 'regenerate_same_shot_change_framing'
  | 'regenerate_same_shot_fix_face'
  | 'regenerate_same_shot_fix_costume'
  | 'regenerate_same_shot_fix_scene'
  | 'regenerate_from_shot_forward'
  | 'freeze_approved_shots';

export interface RuntimeShotState {
  shotId: string;
  sceneId?: string;
  sequenceOrder: number;
  version: number;
  status: 'pending' | 'generating' | 'review' | 'approved' | 'failed';
  lastImageUrl?: string;
  approvedImageUrl?: string;
  bestCandidateId?: string;
  continuityScore?: number;
  narrativeScore?: number;
  visualMatchScore?: number;
  violationTags: string[];
  regenerateReason?: string;
  history: Array<{
    candidateId: string;
    imageUrl?: string;
    continuityScore: number;
    narrativeScore: number;
    visualMatchScore: number;
    createdAt: number;
    violations: string[];
  }>;
}

export interface ProjectRuntimeState {
  projectId: string;
  stage: PipelineStage;
  paused: boolean;
  skippedShotIds: Set<string>;
  shots: Map<string, RuntimeShotState>;
  createdAt: number;
  updatedAt: number;
}

const projectStateMap = new Map<string, ProjectRuntimeState>();

export function initProjectRuntime(params: {
  projectId: string;
  shots: Array<{ shot_id: string; scene_id?: string; sequence_order?: number; shot_number?: number }>;
  stage?: PipelineStage;
}): ProjectRuntimeState {
  const existing = projectStateMap.get(params.projectId);
  if (existing) return existing;

  const shots = new Map<string, RuntimeShotState>();
  params.shots.forEach((shot, idx) => {
    const order = Number(shot.sequence_order ?? shot.shot_number ?? idx + 1) || idx + 1;
    shots.set(shot.shot_id, {
      shotId: shot.shot_id,
      sceneId: shot.scene_id,
      sequenceOrder: order,
      version: 1,
      status: 'pending',
      violationTags: [],
      history: [],
    });
  });

  const now = Date.now();
  const created: ProjectRuntimeState = {
    projectId: params.projectId,
    stage: params.stage || 'shots_ready',
    paused: false,
    skippedShotIds: new Set<string>(),
    shots,
    createdAt: now,
    updatedAt: now,
  };

  projectStateMap.set(params.projectId, created);
  return created;
}

export function getProjectRuntime(projectId: string): ProjectRuntimeState | null {
  return projectStateMap.get(projectId) || null;
}

export function setProjectStage(projectId: string, stage: PipelineStage): ProjectRuntimeState | null {
  const state = projectStateMap.get(projectId);
  if (!state) return null;
  state.stage = stage;
  state.updatedAt = Date.now();
  return state;
}

export function controlStoryboardQueue(projectId: string, action: 'pause' | 'resume' | 'skip', shotId?: string): ProjectRuntimeState | null {
  const state = projectStateMap.get(projectId);
  if (!state) return null;

  if (action === 'pause') state.paused = true;
  if (action === 'resume') state.paused = false;
  if (action === 'skip' && shotId) state.skippedShotIds.add(shotId);

  state.updatedAt = Date.now();
  return state;
}

export function buildShotContextPack(params: {
  projectId: string;
  shotId: string;
  currentShot: any;
  previousShot?: any;
  sceneState?: any;
  characterState?: any;
}): any {
  const runtime = projectStateMap.get(params.projectId);
  const previousApproved = runtime
    ? [...runtime.shots.values()]
        .filter((s) => s.sequenceOrder < (runtime.shots.get(params.shotId)?.sequenceOrder || 0) && s.approvedImageUrl)
        .sort((a, b) => b.sequenceOrder - a.sequenceOrder)[0]
    : undefined;

  return {
    shot_id: params.currentShot?.shot_id || params.shotId,
    scene_id: params.currentShot?.scene_id,
    sequence_order: params.currentShot?.sequence_order || params.currentShot?.shot_number,
    narrative_purpose: params.currentShot?.narrative_purpose || params.currentShot?.action || '',
    involved_characters: params.currentShot?.characters || [],
    emotional_beat: params.currentShot?.mood || '',
    action: params.currentShot?.action || '',
    environment_state: {
      location: params.currentShot?.location,
      time_of_day: params.currentShot?.time_of_day,
      lighting: params.currentShot?.lighting,
      scene_state: params.sceneState || {},
    },
    framing: params.currentShot?.composition || '',
    shot_size: params.currentShot?.camera || '',
    camera_angle: params.currentShot?.camera || '',
    camera_motion: params.currentShot?.movement || '',
    lens_hint: params.currentShot?.lens || '',
    subject_focus: params.currentShot?.characters?.[0] || 'primary subject',
    continuity_from_previous: params.previousShot?.continuity_notes || '',
    continuity_to_next: params.currentShot?.continuity_notes || '',
    previous_shot_summary: params.previousShot
      ? {
          shot_id: params.previousShot.shot_id,
          action: params.previousShot.action,
          framing: params.previousShot.composition,
          approved_frame: previousApproved?.approvedImageUrl,
        }
      : null,
    character_state: params.characterState || {},
  };
}

export function scoreStoryboardCandidate(params: {
  imagePrompt?: string;
  action?: string;
  framing?: string;
  lighting?: string;
  imageUrl?: string;
}): {
  continuity_score: number;
  narrative_score: number;
  visual_match_score: number;
  violation_tags: string[];
  regen_recommendation: string;
} {
  const prompt = String(params.imagePrompt || '').toLowerCase();
  const violations: string[] = [];

  const hasAction = String(params.action || '').trim().length >= 12;
  const hasFraming = String(params.framing || '').trim().length >= 8;
  const hasLighting = String(params.lighting || '').trim().length >= 8;
  const hasUrl = !!params.imageUrl;

  if (!hasAction) violations.push('weak_action_binding');
  if (!hasFraming) violations.push('framing_underspecified');
  if (!hasLighting) violations.push('lighting_underspecified');
  if (!hasUrl) violations.push('missing_image_output');
  if (prompt.includes('random') || prompt.includes('abstract metaphor')) violations.push('prompt_ambiguity');

  const continuity = Math.max(0, 100 - violations.length * 18);
  const narrative = hasAction ? 85 : 55;
  const visual = hasFraming && hasLighting ? 88 : 60;

  const recommend = continuity < 75
    ? 'regenerate_same_shot_keep_bible'
    : continuity < 85
      ? 'regenerate_same_shot_fix_face'
      : 'none';

  return {
    continuity_score: continuity,
    narrative_score: narrative,
    visual_match_score: visual,
    violation_tags: violations,
    regen_recommendation: recommend,
  };
}

export function registerStoryboardCandidate(params: {
  projectId: string;
  shotId: string;
  candidateId: string;
  imageUrl?: string;
  continuityScore: number;
  narrativeScore: number;
  visualMatchScore: number;
  violations?: string[];
}): RuntimeShotState | null {
  const state = projectStateMap.get(params.projectId);
  if (!state) return null;
  const shot = state.shots.get(params.shotId);
  if (!shot) return null;

  shot.status = 'review';
  shot.lastImageUrl = params.imageUrl;
  shot.bestCandidateId = params.candidateId;
  shot.continuityScore = params.continuityScore;
  shot.narrativeScore = params.narrativeScore;
  shot.visualMatchScore = params.visualMatchScore;
  shot.violationTags = params.violations || [];
  shot.history.push({
    candidateId: params.candidateId,
    imageUrl: params.imageUrl,
    continuityScore: params.continuityScore,
    narrativeScore: params.narrativeScore,
    visualMatchScore: params.visualMatchScore,
    createdAt: Date.now(),
    violations: params.violations || [],
  });

  state.stage = computeStage(state);
  state.updatedAt = Date.now();
  return shot;
}

export function approveStoryboardShot(projectId: string, shotId: string, imageUrl?: string): RuntimeShotState | null {
  const state = projectStateMap.get(projectId);
  if (!state) return null;
  const shot = state.shots.get(shotId);
  if (!shot) return null;

  shot.status = 'approved';
  shot.approvedImageUrl = imageUrl || shot.lastImageUrl;
  shot.version += 1;

  state.stage = computeStage(state);
  state.updatedAt = Date.now();
  return shot;
}

export function markShotRegenerated(params: {
  projectId: string;
  shotId: string;
  mode: RegenerationMode;
  reason?: string;
}): RuntimeShotState | null {
  const state = projectStateMap.get(params.projectId);
  if (!state) return null;

  const shot = state.shots.get(params.shotId);
  if (!shot) return null;

  shot.version += 1;
  shot.status = 'pending';
  shot.regenerateReason = `${params.mode}${params.reason ? `: ${params.reason}` : ''}`;
  shot.violationTags = [];

  if (params.mode === 'regenerate_from_shot_forward') {
    for (const next of state.shots.values()) {
      if (next.sequenceOrder > shot.sequenceOrder) {
        next.status = 'pending';
        next.version += 1;
      }
    }
  }

  if (params.mode === 'freeze_approved_shots') {
    for (const s of state.shots.values()) {
      if (s.status === 'approved') {
        s.status = 'approved';
      }
    }
  }

  state.stage = computeStage(state);
  state.updatedAt = Date.now();
  return shot;
}

export function hasApprovedStoryboard(projectId: string, shotId?: string): boolean {
  const state = projectStateMap.get(projectId);
  if (!state) return false;
  if (shotId) return state.shots.get(shotId)?.status === 'approved';
  return [...state.shots.values()].every((s) => s.status === 'approved');
}

export function getApprovedStoryboardFrame(projectId: string, shotId: string): string | undefined {
  const state = projectStateMap.get(projectId);
  if (!state) return undefined;
  return state.shots.get(shotId)?.approvedImageUrl;
}

// ────────────────────────────────────────────────────────────────────────────
// Serialization helpers for Supabase persistence
// Map / Set objects cannot be JSON.stringify'd directly.
// ────────────────────────────────────────────────────────────────────────────

export interface SerializedPipelineState {
  projectId: string;
  stage: PipelineStage;
  paused: boolean;
  skippedShotIds: string[];
  shots: Array<{
    shotId: string;
    sceneId?: string;
    sequenceOrder: number;
    version: number;
    status: RuntimeShotState['status'];
    lastImageUrl?: string;
    approvedImageUrl?: string;
    bestCandidateId?: string;
    continuityScore?: number;
    narrativeScore?: number;
    visualMatchScore?: number;
    violationTags: string[];
    regenerateReason?: string;
    history: RuntimeShotState['history'];
  }>;
  createdAt: number;
  updatedAt: number;
}

export function serializePipelineState(state: ProjectRuntimeState): SerializedPipelineState {
  return {
    projectId: state.projectId,
    stage: state.stage,
    paused: state.paused,
    skippedShotIds: [...state.skippedShotIds.values()],
    shots: [...state.shots.values()].map((s) => ({
      shotId: s.shotId,
      sceneId: s.sceneId,
      sequenceOrder: s.sequenceOrder,
      version: s.version,
      status: s.status,
      lastImageUrl: s.lastImageUrl,
      approvedImageUrl: s.approvedImageUrl,
      bestCandidateId: s.bestCandidateId,
      continuityScore: s.continuityScore,
      narrativeScore: s.narrativeScore,
      visualMatchScore: s.visualMatchScore,
      violationTags: s.violationTags,
      regenerateReason: s.regenerateReason,
      history: s.history,
    })),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

export function deserializePipelineState(raw: SerializedPipelineState): ProjectRuntimeState {
  const shots = new Map<string, RuntimeShotState>();
  for (const s of raw.shots) {
    shots.set(s.shotId, {
      shotId: s.shotId,
      sceneId: s.sceneId,
      sequenceOrder: s.sequenceOrder,
      version: s.version,
      status: s.status,
      lastImageUrl: s.lastImageUrl,
      approvedImageUrl: s.approvedImageUrl,
      bestCandidateId: s.bestCandidateId,
      continuityScore: s.continuityScore,
      narrativeScore: s.narrativeScore,
      visualMatchScore: s.visualMatchScore,
      violationTags: s.violationTags,
      regenerateReason: s.regenerateReason,
      history: s.history || [],
    });
  }

  return {
    projectId: raw.projectId,
    stage: raw.stage,
    paused: raw.paused,
    skippedShotIds: new Set<string>(raw.skippedShotIds),
    shots,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/** Restores an already-deserialized state into the in-memory map (idempotent). */
export function restorePipelineState(state: ProjectRuntimeState): ProjectRuntimeState {
  projectStateMap.set(state.projectId, state);
  return state;
}

function computeStage(state: ProjectRuntimeState): PipelineStage {
  const shots = [...state.shots.values()];
  if (shots.length === 0) return 'shots_ready';

  const approved = shots.filter((s) => s.status === 'approved').length;
  const failed = shots.filter((s) => s.status === 'failed').length;
  const review = shots.filter((s) => s.status === 'review').length;
  const generating = shots.filter((s) => s.status === 'generating').length;

  if (approved === shots.length) return 'storyboard_approved';
  if (failed > 0 && approved < shots.length) return 'storyboard_partial_failed';
  if (review > 0 || approved > 0) return 'storyboard_review';
  if (generating > 0) return 'storyboard_generating';
  return 'shots_ready';
}
