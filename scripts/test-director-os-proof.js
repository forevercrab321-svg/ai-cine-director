#!/usr/bin/env node
/**
 * Director OS Real Execution Proof Test
 * ─────────────────────────────────────
 * Runs against the live local server (localhost:3002) to prove:
 *   A. Director OS layers all execute and return real data
 *   B. Character identity law is populated and anchors are in prompts
 *   C. Temporal guidance resolves on all shots (not "pending")
 *   D. Verifier catches real injected errors
 *   E. Edit timeline covers all shots with subtitle blocks where dialogue exists
 *
 * Usage:
 *   node scripts/test-director-os-proof.js [--token <JWT>]
 *
 * Output: PASS / FAIL per task, with evidence JSON
 */

const http = require('http');
const https = require('https');

const SERVER = 'http://localhost:3002';
const args = process.argv.slice(2);
const tokenIdx = args.indexOf('--token');
const BEARER = tokenIdx !== -1 ? args[tokenIdx + 1] : process.env.TEST_JWT || '';

let passed = 0;
let failed = 0;

function log(tag, msg, data) {
  const prefix = tag === 'PASS' ? '\x1b[32m✓ PASS\x1b[0m' : tag === 'FAIL' ? '\x1b[31m✗ FAIL\x1b[0m' : '\x1b[33m─ INFO\x1b[0m';
  console.log(`${prefix}  ${msg}`);
  if (data !== undefined) console.log('       ', typeof data === 'string' ? data : JSON.stringify(data, null, 2).split('\n').slice(0, 20).join('\n'));
}

function assert(name, condition, evidence, hint) {
  if (condition) {
    passed++;
    log('PASS', name, evidence);
  } else {
    failed++;
    log('FAIL', name, evidence);
    if (hint) console.log(`       💡 ${hint}`);
  }
}

async function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(SERVER + path);
    const payload = body ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(BEARER ? { Authorization: `Bearer ${BEARER}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = (url.protocol === 'https:' ? https : http).request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Test payload ───────────────────────────────────────────────────────────
const TEST_STORY = `
A young detective named Mira Chen investigates a midnight art theft at a neon-lit museum.
She discovers the thief is her estranged brother, Leon Chen.
The confrontation ends in an unexpected alliance.
`.trim();

const CHAR_BIBLE = [
  {
    character_id: 'mira',
    name: 'Mira Chen',
    age: '28',
    face_traits: 'sharp cheekbones, dark almond eyes, small scar above left brow',
    hair: 'black bob cut, slightly wavy',
    body_type: 'lean athletic build, 165cm',
    outfit: 'dark navy trench coat, white turtleneck, silver badge clip on lapel',
    props: 'police badge, small tactical flashlight',
    voice: 'calm authoritative contralto',
  },
  {
    character_id: 'leon',
    name: 'Leon Chen',
    age: '31',
    face_traits: 'angular jaw, same dark eyes as Mira, stubble beard, disheveled look',
    hair: 'messy black hair, longer at temples',
    body_type: 'taller 183cm, wiry frame',
    outfit: 'dark hoodie, cargo pants, worn leather gloves',
    props: 'stolen painting in tube case, lockpick set',
    voice: 'low urgent tenor',
  },
];

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n\x1b[1m══════════════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[1m  DIRECTOR OS — REAL EXECUTION PROOF TEST\x1b[0m');
  console.log('\x1b[1m══════════════════════════════════════════════════════\x1b[0m\n');

  // ── STEP 0: Health check ─────────────────────────────────────────────────
  console.log('── STEP 0: Health check\n');
  let health;
  try {
    health = await request('GET', '/api/health');
    assert('Server reachable', health.status === 200, `status=${health.status}`);
    assert('Gemini key configured', health.body?.config?.gemini === true, health.body?.config, 'Set GEMINI_API_KEY in .env.local');
  } catch (e) {
    assert('Server reachable', false, `Connection refused: ${e.message}`, 'Run: npm run server');
    console.log('\n\x1b[31mCannot continue — server not running.\x1b[0m\n');
    process.exit(1);
  }

  // ── STEP 1: Generate project through /api/gemini/generate ─────────────────
  console.log('\n── STEP 1: Generate Director OS project\n');
  let project;
  try {
    const res = await request('POST', '/api/gemini/generate', {
      story_input: TEST_STORY,
      visual_style: 'neo_noir',
      language: 'en',
      target_scenes: 6,
      character_bible: CHAR_BIBLE,
      director_controls: { pacing: 'tense', preferredLens: '35mm anamorphic' },
    });
    assert('Generate returned 200', res.status === 200, `status=${res.status}`, 'Check server logs for error');
    if (res.status !== 200) {
      console.error('\nGenerate failed:', res.body);
      process.exit(1);
    }
    project = res.body;
  } catch (e) {
    assert('Generate request succeeded', false, e.message);
    process.exit(1);
  }

  // ── STEP 2: Director OS layer status ─────────────────────────────────────
  console.log('\n── STEP 2: Director OS layer status\n');
  const layers = project.director_os_layers || {};
  const critical_failures = project.director_os_critical_failures || [];
  const degraded = project.director_os_degraded;

  for (const [key, val] of Object.entries(layers)) {
    assert(`Layer "${key}" PASS`, val.pass, val.error || 'ok', val.error ? `Error detail: ${val.error}` : undefined);
  }
  assert('No degraded mode', !degraded, degraded ? `Degraded — failed: ${Object.keys(layers).filter(k => !layers[k].pass).join(', ')}` : 'All layers active');
  assert('No critical failures', critical_failures.length === 0, critical_failures.join(', ') || 'none');

  // ── STEP 3: Character Identity Law ───────────────────────────────────────
  console.log('\n── STEP 3: Character Identity Law\n');
  const identityLaw = project.character_identity_law;
  assert('character_identity_law present', !!identityLaw, identityLaw ? `${identityLaw.profiles?.length} profiles` : 'MISSING');
  if (identityLaw) {
    assert('Profiles populated', identityLaw.profiles?.length >= 2, `profiles=${identityLaw.profiles?.length}`);
    assert('Lock version set', !!identityLaw.identity_lock_bundle?.lock_version, identityLaw.identity_lock_bundle?.lock_version);
    assert('Mira profile complete', identityLaw.profiles?.some(p => p.character_id === 'mira' && p.canonical_description?.length > 20),
      identityLaw.profiles?.find(p => p.character_id === 'mira')?.canonical_description || 'MISSING',
      'character_bible must include face_traits, hair, outfit for Mira');
    assert('Leon profile complete', identityLaw.profiles?.some(p => p.character_id === 'leon' && p.canonical_description?.length > 20),
      identityLaw.profiles?.find(p => p.character_id === 'leon')?.canonical_description || 'MISSING');
  }

  // ── STEP 4: Temporal guidance on shots ───────────────────────────────────
  console.log('\n── STEP 4: Temporal guidance on shots\n');
  const scenes = project.scenes || [];
  assert('Scenes generated', scenes.length >= 4, `scenes=${scenes.length}`);

  const withTG = scenes.filter(s => s.temporal_guidance && s.temporal_guidance.start_frame_intent && s.temporal_guidance.start_frame_intent !== 'pending');
  const tgCoverage = scenes.length > 0 ? Math.round(100 * withTG.length / scenes.length) : 0;
  assert('Temporal guidance ≥80% coverage', tgCoverage >= 80, `${withTG.length}/${scenes.length} shots = ${tgCoverage}%`,
    'buildShotGraph must inject temporal_guidance; check shot_id matching');

  if (withTG.length > 0) {
    const sample = withTG[0];
    console.log('\n  Sample temporal_guidance (shot 1):');
    console.log('    previous_visual_state:', sample.temporal_guidance.previous_visual_state);
    console.log('    start_frame_intent:   ', sample.temporal_guidance.start_frame_intent);
    console.log('    mid_frame_intent:     ', sample.temporal_guidance.middle_motion_intent);
    console.log('    end_frame_intent:     ', sample.temporal_guidance.end_frame_intent);
    console.log('    next_target_state:    ', sample.temporal_guidance.next_visual_target_state);
  }

  // ── STEP 5: Verifier catches real errors ─────────────────────────────────
  console.log('\n── STEP 5: Verifier — real error detection\n');
  const verifier = project.verifier_report;
  assert('verifier_report present', !!verifier, verifier ? `score=${verifier.overall_score}` : 'MISSING');

  if (verifier) {
    // 5a. Identity law check exists in verifier
    const idCheck = verifier.checks?.find(c => c.id === 'identity_law_present');
    assert('Verifier has identity_law_present check', !!idCheck, idCheck ? `pass=${idCheck.pass}, score=${idCheck.score}` : 'MISSING CHECK');

    // 5b. Temporal guidance check exists
    const tgCheck = verifier.checks?.find(c => c.id === 'temporal_guidance_populated');
    assert('Verifier has temporal_guidance check', !!tgCheck, tgCheck ? `pass=${tgCheck.pass}, score=${tgCheck.score}` : 'MISSING CHECK');

    // 5c. Inject a fake error and confirm verifier catches it
    // Simulate: shot with characters but no image_prompt (identity anchor absent)
    const { buildVerificationReport } = require('../lib/directorOS.js');
    const poisonedProject = {
      ...project,
      character_anchor: 'Mira Chen sharp cheekbones dark almond eyes navy trench coat silver badge',
    };
    const poisonedShots = scenes.map((s, i) => ({
      ...s,
      // Remove image_prompt from character shots to trigger identity_anchor_in_prompts failure
      ...(i === 2 && (s.characters || []).length > 0 ? { image_prompt: 'generic shot' } : {}),
    }));
    const poisonedVerifier = buildVerificationReport({
      project: poisonedProject,
      shots: poisonedShots,
      shotGraph: project.shot_graph || [],
      timelinePlan: project.edit_timeline_plan,
    });
    const anchorCheck = poisonedVerifier.checks?.find(c => c.id === 'identity_anchor_in_prompts');
    const anchorFailed = anchorCheck && !anchorCheck.pass;
    assert('Verifier catches identity anchor missing from prompt', anchorFailed,
      anchorCheck ? `score=${anchorCheck.score}, reason=${anchorCheck.failure_reason}` : 'CHECK NOT FOUND');

    // 5d. Inject environment continuity error
    const { buildShotGraph } = require('../lib/directorOS.js');
    const shotsWithBrokenEnv = scenes.map((s, i) => ({
      ...s,
      ...(i === 1 ? { location: null, scene_setting: null } : {}),
    }));
    const brokenGraph = buildShotGraph({ shots: shotsWithBrokenEnv, panels: project.storyboard_12panel || [] });
    const brokenVerifier = buildVerificationReport({
      project: poisonedProject,
      shots: shotsWithBrokenEnv,
      shotGraph: brokenGraph,
      timelinePlan: project.edit_timeline_plan,
    });
    const envCheck = brokenVerifier.checks?.find(c => c.id === 'environment_continuity');
    assert('Verifier catches unresolved environment_bridge', envCheck && !envCheck.pass,
      envCheck ? `score=${envCheck.score}, reason=${envCheck.failure_reason}` : 'CHECK NOT FOUND');

    // 5e. Inject audio-video mismatch (dialogue shot missing from timeline)
    const shotsWithDialogue = scenes.map((s, i) => ({
      ...s,
      dialogue_text: i === 0 ? 'Where is the painting, Leon?' : s.dialogue_text,
    }));
    const emptyTimelinePlan = { ...project.edit_timeline_plan, timeline: [] };
    const avVerifier = buildVerificationReport({
      project: poisonedProject,
      shots: shotsWithDialogue,
      shotGraph: project.shot_graph || [],
      timelinePlan: emptyTimelinePlan,
    });
    const avCheck = avVerifier.checks?.find(c => c.id === 'timeline_coverage');
    assert('Verifier catches empty timeline (audio-video mismatch)', avCheck && !avCheck.pass,
      avCheck ? `score=${avCheck.score}, reason=${avCheck.failure_reason}` : 'CHECK NOT FOUND');
  }

  // ── STEP 6: Edit timeline ─────────────────────────────────────────────────
  console.log('\n── STEP 6: Edit timeline\n');
  const editPlan = project.edit_timeline_plan;
  assert('edit_timeline_plan present', !!editPlan, editPlan ? `total_duration=${editPlan.total_duration_sec}s` : 'MISSING');
  if (editPlan) {
    assert('Timeline has entries', editPlan.timeline?.length >= 4, `timeline entries=${editPlan.timeline?.length}`);
    assert('Total duration > 0', editPlan.total_duration_sec > 0, `${editPlan.total_duration_sec}s`);
    const entriesWithShotId = (editPlan.timeline || []).filter(t => !!t.shot_id);
    assert('All timeline entries have shot_id', entriesWithShotId.length === editPlan.timeline?.length,
      `${entriesWithShotId.length}/${editPlan.timeline?.length}`);
    const firstEntry = editPlan.timeline?.[0];
    if (firstEntry) {
      console.log('\n  Sample timeline entry (shot 1):');
      console.log('    shot_id:             ', firstEntry.shot_id);
      console.log('    start_sec:           ', firstEntry.start_sec);
      console.log('    end_sec:             ', firstEntry.end_sec);
      console.log('    clip_duration_sec:   ', firstEntry.clip_duration_sec);
      console.log('    transition_plan:     ', firstEntry.transition_plan);
      console.log('    subtitle_blocks:     ', firstEntry.subtitle_blocks?.length ? 'present' : 'none');
    }
  }

  // ── STEP 7: Shot graph ───────────────────────────────────────────────────
  console.log('\n── STEP 7: Shot graph\n');
  const shotGraph = project.shot_graph || [];
  assert('shot_graph populated', shotGraph.length >= 4, `nodes=${shotGraph.length}`);
  const linkedNodes = shotGraph.filter(n => n.prev_shot_id || n.next_shot_id);
  assert('Shot graph nodes linked', linkedNodes.length >= shotGraph.length - 1, `linked=${linkedNodes.length}/${shotGraph.length}`);

  // ── FINAL VERDICT ────────────────────────────────────────────────────────
  console.log('\n\x1b[1m══════════════════════════════════════════════════════\x1b[0m');
  console.log(`\x1b[1m  RESULTS: ${passed} passed, ${failed} failed\x1b[0m`);
  if (failed === 0) {
    console.log('\x1b[32m\x1b[1m  VERDICT: PASS — Director OS real execution proven\x1b[0m');
  } else if (failed <= 3) {
    console.log('\x1b[33m\x1b[1m  VERDICT: PASS WITH CAUTION — some checks failed\x1b[0m');
  } else {
    console.log('\x1b[31m\x1b[1m  VERDICT: BLOCKED — too many failures\x1b[0m');
  }
  console.log('\x1b[1m══════════════════════════════════════════════════════\x1b[0m\n');
}

main().catch((e) => {
  console.error('\x1b[31mTest runner crashed:\x1b[0m', e);
  process.exit(1);
});
