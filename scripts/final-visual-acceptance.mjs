import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API = 'http://localhost:3002';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE) {
  console.error('Missing required env vars for acceptance test.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createTestUser() {
  const email = `visual-${Date.now()}@example.com`;
  const password = 'TestPassword123!';

  const adminRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
    },
    body: JSON.stringify({ email, password, user_metadata: { visual_acceptance: true } }),
  });
  const adminData = await adminRes.json();
  if (!adminData?.id) throw new Error(`create user failed: ${JSON.stringify(adminData)}`);

  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${adminData.id}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
    },
    body: JSON.stringify({ email_confirm: true }),
  });

  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData?.access_token) throw new Error(`token failed: ${JSON.stringify(tokenData)}`);

  return { email, token: tokenData.access_token };
}

function parseSSEBuffer(buffer) {
  const events = [];
  const chunks = buffer.split('\n\n');
  for (let i = 0; i < chunks.length - 1; i += 1) {
    const block = chunks[i];
    const e = block.split('\n').find((l) => l.startsWith('event: '));
    const d = block.split('\n').find((l) => l.startsWith('data: '));
    if (!e || !d) continue;
    const event = e.slice(7).trim();
    let data = {};
    try {
      data = JSON.parse(d.slice(6));
    } catch {
      data = {};
    }
    events.push({ event, data });
  }
  return { events, rest: chunks[chunks.length - 1] || '' };
}

async function readSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let donePayload = null;
  let compiledPayload = null;
  const progress = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSSEBuffer(buffer);
    buffer = parsed.rest;
    for (const ev of parsed.events) {
      if (ev.event === 'compiled') compiledPayload = ev.data;
      if (ev.event === 'progress') progress.push(ev.data);
      if (ev.event === 'done') donePayload = ev.data;
      if (ev.event === 'error') throw new Error(ev.data?.error || 'SSE error');
    }
  }

  return { compiledPayload, donePayload, progress };
}

function toBatchShot(s, idx) {
  return {
    shot_id: s.shot_id,
    shot_number: s.shot_number || s.scene_number || idx + 1,
    scene_number: s.scene_number || idx + 1,
    image_prompt: s.image_prompt,
    scene_id: s.scene_id,
    scene_summary: s.visual_description,
    shot_description: s.visual_description,
    characters_in_shot: s.characters || [],
    location: s.scene_setting || s.location || '',
    time_of_day: s.time_of_day || 'night',
    action: s.narrative_purpose || s.visual_description,
    emotion: s.emotional_beat || s.mood || '',
    camera_framing: s.framing || s.composition || '',
    camera_angle: s.camera_angle || '',
    lens_style: s.lens_hint || s.lens || '',
    lighting: s.lighting || 'cinematic motivated lighting',
    continuity_constraints: s.continuity_from_previous || '',
    negative_constraints: s.negative_constraints || 'duplicate frame, template composition, identity drift',
    scene_setting: s.scene_setting || '',
    visual_description: s.visual_description || '',
    composition: s.framing || '',
    seed_hint: s.seed_hint ?? null,
    reference_policy: s.reference_policy || 'anchor',
  };
}

function scoreVisualDifference(a, b) {
  const fields = [
    ['location', a.location, b.location],
    ['action', a.action, b.action],
    ['emotion', a.emotion, b.emotion],
    ['camera', `${a.camera_angle}|${a.camera_framing}`, `${b.camera_angle}|${b.camera_framing}`],
    ['lighting', a.lighting, b.lighting],
  ];
  const changed = fields.filter(([, x, y]) => String(x || '').trim().toLowerCase() !== String(y || '').trim().toLowerCase()).map(([k]) => k);
  return changed;
}

async function imageToDataUrl(url) {
  const r = await fetch(url);
  const ctype = r.headers.get('content-type') || 'image/jpeg';
  const ab = await r.arrayBuffer();
  const b64 = Buffer.from(ab).toString('base64');
  return `data:${ctype};base64,${b64}`;
}

async function analyzeImage(token, imageUrl) {
  const dataUrl = await imageToDataUrl(imageUrl);
  const r = await fetch(`${API}/api/gemini/analyze`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ base64Data: dataUrl }),
  });
  const j = await r.json();
  return j?.anchor || '';
}

function extractIdentityFingerprint(desc) {
  const d = String(desc || '').toLowerCase();
  const keys = ['fur', 'vest', 'bag', 'eyes', 'orange', 'white', 'corgi', 'dog', 'messenger'];
  return keys.filter((k) => d.includes(k));
}

async function run() {
  const { token, email } = await createTestUser();

  const genRes = await fetch(`${API}/api/gemini/generate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      storyIdea: 'A small courier dog delivers urgent packages across a toy-style neon city. The route includes apartment interior, crowded alleys, elevated tram station, market square, rooftop bridge, and dawn harbor finish.',
      visualStyle: 'Pop Mart 3D',
      language: 'en',
      mode: 'storyboard',
      identityAnchor: 'A small corgi courier with orange-white fur, blue messenger vest, tiny shoulder bag, expressive dark eyes',
      sceneCount: 8,
    }),
  });
  const project = await genRes.json();
  if (!project?.id || !Array.isArray(project?.scenes) || project.scenes.length < 8) {
    throw new Error('generate did not return enough scenes/shots for acceptance');
  }

  const shots = project.scenes.map(toBatchShot);

  const compileRes = await fetch(`${API}/api/batch/compile-prompts`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      project_id: project.id,
      shots,
      style: 'pop_mart',
      character_anchor: project.character_anchor,
      style_bible: project.style_bible || {},
    }),
  });
  const compiled = await compileRes.json();

  const batchRes = await fetch(`${API}/api/batch/gen-images`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      project_id: project.id,
      shots,
      count: shots.length,
      model: 'flux_schnell',
      aspect_ratio: '16:9',
      style: 'pop_mart',
      character_anchor: project.character_anchor,
      concurrency: 1,
      reference_image_url: '',
      story_entities: project.story_entities || [],
      style_bible: project.style_bible || {},
    }),
  });

  const { donePayload } = await readSSE(batchRes);
  const allItems = donePayload?.items || [];
  const succeeded = allItems.filter((i) => i.status === 'succeeded');

  if (succeeded.length < 8) {
    throw new Error(`not enough generated images for acceptance: ${succeeded.length}`);
  }

  const compiledShots = (compiled?.compiled_shots || []).slice(0, 8);
  const visualRows = [];

  for (let i = 0; i < 8; i += 1) {
    const c = compiledShots[i];
    const shot = shots.find((s) => s.shot_id === c.shot_id);
    const item = succeeded.find((s) => s.shot_id === c.shot_id);
    const visionDesc = item?.image_url ? await analyzeImage(token, item.image_url) : '';

    const prevShot = i > 0 ? shots.find((s) => s.shot_id === compiledShots[i - 1].shot_id) : null;
    const changed = i > 0 ? scoreVisualDifference(shot, prevShot) : ['initial'];

    visualRows.push({
      index: i + 1,
      shot_id: c.shot_id,
      shot_text: c.shot_summary,
      prompt_summary: String(c.model_prompt || '').slice(0, 200),
      diff_report: c.variance_report,
      expected_changed_axes: changed,
      image_url: item?.image_url || null,
      vision_description: visionDesc,
      identity_fingerprint: extractIdentityFingerprint(visionDesc),
    });

    await sleep(120);
  }

  const uniqueUrls = new Set(visualRows.map((r) => r.image_url).filter(Boolean));
  const repeatedUrlCount = visualRows.length - uniqueUrls.size;

  const identityBase = visualRows[0]?.identity_fingerprint || [];
  const consistencyScores = visualRows.map((r) => {
    const overlap = r.identity_fingerprint.filter((t) => identityBase.includes(t)).length;
    return { shot_id: r.shot_id, overlap, fingerprint: r.identity_fingerprint };
  });

  const payload = {
    test_user: email,
    project_id: project.id,
    total_shots_generated: succeeded.length,
    compiled_shots_count: (compiled?.compiled_shots || []).length,
    duplicate_warnings: compiled?.duplicate_warnings || [],
    repeated_url_count: repeatedUrlCount,
    visual_rows: visualRows,
    identity_consistency: consistencyScores,
  };

  console.log(JSON.stringify(payload, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
