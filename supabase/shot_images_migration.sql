-- ═══════════════════════════════════════════════════════════════
-- Shot Images Migration
-- Images linked 1:N to shots, with full generation audit trail
-- ═══════════════════════════════════════════════════════════════

-- 1. shot_images — one row per generated image
CREATE TABLE IF NOT EXISTS shot_images (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shot_id            UUID NOT NULL,       -- References shots(shot_id)
    project_id         UUID,                -- References storyboards(id) for fast queries
    user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    url                TEXT NOT NULL DEFAULT '',
    thumbnail_url      TEXT,
    is_primary         BOOLEAN NOT NULL DEFAULT false,
    status             TEXT NOT NULL DEFAULT 'pending',   -- pending | generating | succeeded | failed
    label              TEXT,                              -- User label e.g. "Take 3"
    created_at         TIMESTAMPTZ DEFAULT now(),
    updated_at         TIMESTAMPTZ DEFAULT now()
);

-- 2. image_generations — audit log of every generation/edit attempt
CREATE TABLE IF NOT EXISTS image_generations (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_id                UUID REFERENCES shot_images(id) ON DELETE SET NULL,
    shot_id                 UUID NOT NULL,
    project_id              UUID,
    user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Prompt
    prompt                  TEXT NOT NULL DEFAULT '',
    negative_prompt         TEXT NOT NULL DEFAULT '',
    delta_instruction       TEXT,            -- User's edit instruction

    -- Model config
    model                   TEXT NOT NULL DEFAULT 'flux',
    aspect_ratio            TEXT NOT NULL DEFAULT '16:9',
    style                   TEXT NOT NULL DEFAULT 'none',
    seed                    INTEGER,

    -- Consistency
    anchor_refs             JSONB NOT NULL DEFAULT '[]'::jsonb,
    reference_image_url     TEXT,
    reference_policy        TEXT NOT NULL DEFAULT 'anchor',
    edit_mode               TEXT,            -- null | reroll | reference_edit | attribute_edit

    -- Result
    status                  TEXT NOT NULL DEFAULT 'pending',
    output_url              TEXT,
    error                   TEXT,
    replicate_prediction_id TEXT,

    -- Timing
    created_at              TIMESTAMPTZ DEFAULT now(),
    completed_at            TIMESTAMPTZ,
    duration_ms             INTEGER
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_shot_images_shot_id ON shot_images(shot_id);
CREATE INDEX IF NOT EXISTS idx_shot_images_project_id ON shot_images(project_id);
CREATE INDEX IF NOT EXISTS idx_shot_images_user_id ON shot_images(user_id);
CREATE INDEX IF NOT EXISTS idx_shot_images_primary ON shot_images(shot_id, is_primary) WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS idx_image_generations_shot_id ON image_generations(shot_id);
CREATE INDEX IF NOT EXISTS idx_image_generations_image_id ON image_generations(image_id);
CREATE INDEX IF NOT EXISTS idx_image_generations_user_id ON image_generations(user_id);

-- RLS
ALTER TABLE shot_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own images" ON shot_images
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own generations" ON image_generations
    FOR ALL USING (auth.uid() = user_id);

-- Trigger: auto-update updated_at on shot_images
CREATE TRIGGER shot_images_updated_at
    BEFORE UPDATE ON shot_images
    FOR EACH ROW EXECUTE FUNCTION update_shot_timestamp();

-- Function: ensure at most one primary image per shot
CREATE OR REPLACE FUNCTION enforce_single_primary_image()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_primary = true THEN
        UPDATE shot_images
        SET is_primary = false
        WHERE shot_id = NEW.shot_id
          AND id != NEW.id
          AND is_primary = true;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_primary_image
    BEFORE INSERT OR UPDATE OF is_primary ON shot_images
    FOR EACH ROW
    WHEN (NEW.is_primary = true)
    EXECUTE FUNCTION enforce_single_primary_image();
