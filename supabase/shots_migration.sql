-- ═══════════════════════════════════════════════════════════════
-- Shot System Migration
-- Enhanced shot-level data with versioning and revision history
-- ═══════════════════════════════════════════════════════════════

-- 1. Enhanced scenes table
CREATE TABLE IF NOT EXISTS enhanced_scenes (
    scene_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     UUID REFERENCES storyboards(id) ON DELETE CASCADE,
    user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    scene_number   INTEGER NOT NULL,
    scene_title    TEXT NOT NULL DEFAULT '',
    location       TEXT NOT NULL DEFAULT '',
    time_of_day    TEXT NOT NULL DEFAULT 'day',
    synopsis       TEXT NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ DEFAULT now(),
    updated_at     TIMESTAMPTZ DEFAULT now(),
    UNIQUE(project_id, scene_number)
);

-- 2. Shots table — one row per shot, fully detailed
CREATE TABLE IF NOT EXISTS shots (
    shot_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scene_id           UUID NOT NULL REFERENCES enhanced_scenes(scene_id) ON DELETE CASCADE,
    user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    scene_title        TEXT NOT NULL DEFAULT '',
    shot_number        INTEGER NOT NULL DEFAULT 1,
    duration_sec       REAL NOT NULL DEFAULT 3.0,

    -- Location & Time
    location_type      TEXT NOT NULL DEFAULT 'INT',
    location           TEXT NOT NULL DEFAULT '',
    time_of_day        TEXT NOT NULL DEFAULT 'day',

    -- Characters & Action
    characters         JSONB NOT NULL DEFAULT '[]'::jsonb,
    action             TEXT NOT NULL DEFAULT '',
    dialogue           TEXT NOT NULL DEFAULT '',

    -- Camera
    camera             TEXT NOT NULL DEFAULT 'medium',
    lens               TEXT NOT NULL DEFAULT '50mm',
    movement           TEXT NOT NULL DEFAULT 'static',
    composition        TEXT NOT NULL DEFAULT '',

    -- Visual
    lighting           TEXT NOT NULL DEFAULT '',
    art_direction      TEXT NOT NULL DEFAULT '',
    mood               TEXT NOT NULL DEFAULT '',
    sfx_vfx            TEXT NOT NULL DEFAULT '',
    audio_notes        TEXT NOT NULL DEFAULT '',
    continuity_notes   TEXT NOT NULL DEFAULT '',

    -- Image Generation
    image_prompt       TEXT NOT NULL DEFAULT '',
    negative_prompt    TEXT NOT NULL DEFAULT '',
    seed_hint          INTEGER,
    reference_policy   TEXT NOT NULL DEFAULT 'anchor',

    -- State
    status             TEXT NOT NULL DEFAULT 'draft',
    locked_fields      JSONB NOT NULL DEFAULT '[]'::jsonb,
    version            INTEGER NOT NULL DEFAULT 1,

    -- Generated assets
    image_url          TEXT,
    video_url          TEXT,

    created_at         TIMESTAMPTZ DEFAULT now(),
    updated_at         TIMESTAMPTZ DEFAULT now(),

    UNIQUE(scene_id, shot_number)
);

-- 3. Shot revisions — immutable history log
CREATE TABLE IF NOT EXISTS shot_revisions (
    revision_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shot_id            UUID NOT NULL REFERENCES shots(shot_id) ON DELETE CASCADE,
    user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    version            INTEGER NOT NULL,
    snapshot           JSONB NOT NULL,              -- Full shot state at this point
    change_source      TEXT NOT NULL DEFAULT 'user', -- 'user' | 'ai-rewrite'
    change_description TEXT NOT NULL DEFAULT '',
    changed_fields     JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at         TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_shots_scene_id ON shots(scene_id);
CREATE INDEX IF NOT EXISTS idx_shots_user_id ON shots(user_id);
CREATE INDEX IF NOT EXISTS idx_shot_revisions_shot_id ON shot_revisions(shot_id);
CREATE INDEX IF NOT EXISTS idx_shot_revisions_created_at ON shot_revisions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enhanced_scenes_project ON enhanced_scenes(project_id);

-- RLS Policies
ALTER TABLE enhanced_scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE shots ENABLE ROW LEVEL SECURITY;
ALTER TABLE shot_revisions ENABLE ROW LEVEL SECURITY;

-- Users can only access their own data
CREATE POLICY "Users manage own scenes" ON enhanced_scenes
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own shots" ON shots
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users read own revisions" ON shot_revisions
    FOR ALL USING (auth.uid() = user_id);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_shot_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shots_updated_at
    BEFORE UPDATE ON shots
    FOR EACH ROW EXECUTE FUNCTION update_shot_timestamp();

CREATE TRIGGER enhanced_scenes_updated_at
    BEFORE UPDATE ON enhanced_scenes
    FOR EACH ROW EXECUTE FUNCTION update_shot_timestamp();
