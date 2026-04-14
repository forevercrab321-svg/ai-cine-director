-- Migration: Add director controls, logline, world_setting, story_entities, updated_at to storyboards
-- Add scene-level director fields to scenes

-- Storyboards table additions
ALTER TABLE public.storyboards
  ADD COLUMN IF NOT EXISTS logline         text          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS world_setting   text          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS story_entities  jsonb         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS director_controls jsonb       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz   DEFAULT now();

-- Auto-update updated_at on storyboards
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS storyboards_updated_at ON public.storyboards;
CREATE TRIGGER storyboards_updated_at
  BEFORE UPDATE ON public.storyboards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Scenes table additions
ALTER TABLE public.scenes
  ADD COLUMN IF NOT EXISTS scene_title       text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dramatic_function text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tension_level     integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS emotional_beat    text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dialogue_text     text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dialogue_speaker  text    DEFAULT NULL;

COMMENT ON COLUMN public.storyboards.director_controls IS
  'JSON-serialized DirectorControls — tone, pacing, visual philosophy, genre weights, etc.';
COMMENT ON COLUMN public.storyboards.story_entities IS
  'JSON-serialized StoryEntity[] — locked characters, props, locations for continuity';
