-- Add pipeline_state JSONB column to storyboards table
-- This stores the serialized ProjectRuntimeState for recovery after server restarts.
ALTER TABLE public.storyboards
  ADD COLUMN IF NOT EXISTS pipeline_state jsonb DEFAULT NULL;

COMMENT ON COLUMN public.storyboards.pipeline_state IS
  'Serialized shot-level pipeline runtime state (stage, shot approvals, continuity scores). Used to recover in-memory pipeline state after server restart.';
