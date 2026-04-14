/**
 * apply-migration.ts
 * Checks if the director-fields migration has been applied to the live DB,
 * and applies it if not.
 *
 * Run with:   npx tsx scripts/apply-migration.ts
 * Requires:   .env.local with VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || '').trim();
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌  VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from .env.local');
  process.exit(1);
}

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
};

// ─── Step 1: check which columns already exist ────────────────────────────────
async function checkColumns() {
  const storyboardCols = ['logline', 'world_setting', 'story_entities', 'director_controls', 'updated_at'];
  const sceneCols = ['scene_title', 'dramatic_function', 'tension_level', 'emotional_beat', 'dialogue_text', 'dialogue_speaker'];

  const missing: { table: string; column: string }[] = [];

  for (const col of storyboardCols) {
    const url = `${SUPABASE_URL}/rest/v1/storyboards?select=${col}&limit=0`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg: string = (body as any)?.message || '';
      if (msg.includes(col) || res.status === 400) {
        missing.push({ table: 'storyboards', column: col });
      }
    }
  }

  for (const col of sceneCols) {
    const url = `${SUPABASE_URL}/rest/v1/scenes?select=${col}&limit=0`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg: string = (body as any)?.message || '';
      if (msg.includes(col) || res.status === 400) {
        missing.push({ table: 'scenes', column: col });
      }
    }
  }

  return missing;
}

// ─── Step 2: try to apply via Supabase Management API ─────────────────────────
// This requires a personal access token (different from service role key).
// If SUPABASE_ACCESS_TOKEN is set, we use it. Otherwise fall back to manual.
async function applyViaMgmtApi(sql: string): Promise<boolean> {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (!accessToken) return false;

  // Extract project ref from URL: https://<ref>.supabase.co
  const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0];
  const mgmtUrl = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

  const res = await fetch(mgmtUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  if (res.ok) return true;
  const err = await res.json().catch(() => ({}));
  console.warn('  Management API error:', JSON.stringify(err));
  return false;
}

// ─── Migration SQL ─────────────────────────────────────────────────────────────
const MIGRATION_SQL = `
-- Migration: 20260413000000_add_director_fields
-- Add director controls, logline, world_setting, story_entities, updated_at to storyboards

ALTER TABLE public.storyboards
  ADD COLUMN IF NOT EXISTS logline          text          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS world_setting    text          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS story_entities   jsonb         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS director_controls jsonb        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz   DEFAULT now();

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

ALTER TABLE public.scenes
  ADD COLUMN IF NOT EXISTS scene_title       text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dramatic_function text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tension_level     integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS emotional_beat    text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dialogue_text     text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dialogue_speaker  text    DEFAULT NULL;
`.trim();

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🔍  Checking migration status...');
  console.log(`    DB: ${SUPABASE_URL}\n`);

  const missing = await checkColumns();

  if (missing.length === 0) {
    console.log('✅  Migration already applied — all columns exist.\n');
    console.log('    storyboards: logline, world_setting, story_entities, director_controls, updated_at ✓');
    console.log('    scenes: scene_title, dramatic_function, tension_level, emotional_beat, dialogue_text, dialogue_speaker ✓');
    console.log('\n✅  DB is ready. Proceed to build + deploy.\n');
    process.exit(0);
  }

  console.log('⚠️   Missing columns detected:');
  missing.forEach(({ table, column }) => console.log(`    ${table}.${column}`));
  console.log('');

  // Try Management API if token is available
  console.log('🔧  Attempting auto-apply via Supabase Management API...');
  const applied = await applyViaMgmtApi(MIGRATION_SQL);

  if (applied) {
    console.log('✅  Migration applied successfully via Management API!\n');

    // Verify
    const stillMissing = await checkColumns();
    if (stillMissing.length === 0) {
      console.log('✅  Verification passed — all columns confirmed.\n');
    } else {
      console.log('⚠️   Some columns still missing after apply — verify manually.');
    }
    process.exit(0);
  }

  // Manual fallback
  console.log('ℹ️   Auto-apply skipped (SUPABASE_ACCESS_TOKEN not set).\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('MANUAL STEP: Apply the following SQL in Supabase SQL Editor');
  console.log('URL: https://supabase.com/dashboard/project/gtxgkdsayswonlewqfzj/editor');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(MIGRATION_SQL);
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('After running the SQL above, re-run this script to verify:');
  console.log('  npx tsx scripts/apply-migration.ts');
  console.log('═══════════════════════════════════════════════════════════\n');
  process.exit(1);
}

main().catch(e => {
  console.error('❌  Unexpected error:', e.message);
  process.exit(1);
});
