import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fs from 'fs';
import path from 'path';

const API = 'http://localhost:3002';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const ANON = process.env.VITE_SUPABASE_ANON_KEY!;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const OUT_DIR = path.resolve('tmp/director-os-proof');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function j(url: string, opts: any = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data };
}

async function createProofUser() {
  const email = `director-os-proof-${Date.now()}@example.com`;
  const password = 'TestPassword123!';

  const create = await j(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: ANON,
      authorization: `Bearer ${SR}`,
    },
    body: JSON.stringify({ email, password, user_metadata: { director_os_proof: true } }),
  });

  if (create.status >= 300) {
    throw new Error(`createProofUser failed: ${create.status} ${JSON.stringify(create.data)}`);
  }

  const userId = create.data.id;
  await j(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      apikey: ANON,
      authorization: `Bearer ${SR}`,
    },
    body: JSON.stringify({ email_confirm: true }),
  });

  const tok = await j(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: ANON,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!tok.data.access_token) {
    throw new Error(`login failed: ${tok.status} ${JSON.stringify(tok.data)}`);
  }

  await j(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      apikey: ANON,
      authorization: `Bearer ${SR}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ credits: 1000, name: 'Director OS Proof User' }),
  });

  return { email, userId, token: tok.data.access_token };
}

async function generateProject(token: string) {
  const payload = {
    storyIdea: 'Maya Chen, a female detective, chases a suspect through a neon market, stairwell, rooftop, and train platform. Keep her exact face, hair, coat, scarf, and ring consistent in all shots. Maintain visual continuity and sequence handoff across frames.',
    visualStyle: 'Cinematic Realism',
    language: 'en',
    sceneCount: 8,
    identityAnchor: 'Maya Chen, East Asian female, short black bob haircut, sharp jawline, dark green trench coat, red scarf, silver ring on left hand',
  };

  const gen = await j(`${API}/api/gemini/generate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (gen.status !== 200) {
    throw new Error(`generateProject failed: ${gen.status} ${JSON.stringify(gen.data)}`);
  }

  return gen.data;
}

async function generateShotImage(project: any, token: string, shot: any, previousShot?: any, previousPrompt?: string, seed?: number) {
  const scenePayload = {
    scene_id: shot.scene_id,
    synopsis: shot.scene_summary || shot.visual_description || '',
    location: shot.location || shot.scene_setting || '',
    time_of_day: shot.time_of_day || '',
  };

  const res = await j(`${API}/api/shot-images/${shot.shot_id}/generate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      prompt: shot.image_prompt,
      negative_prompt: shot.negative_prompt || '',
      model: 'flux_schnell',
      aspect_ratio: '16:9',
      style: project.visual_style,
      seed: seed ?? shot.seed_hint ?? 142857,
      character_anchor: project.character_anchor,
      reference_policy: shot.reference_policy || 'anchor',
      project_id: project.id,
      continuity: {
        strictness: 'high',
        lockCharacter: true,
        lockStyle: true,
        lockCostume: true,
        lockScene: true,
        usePreviousApprovedAsReference: true,
        scene_memory: {
          scene_id: shot.scene_id,
          scene_number: shot.scene_number,
          environment: shot.location || shot.scene_setting,
          time_of_day: shot.time_of_day,
          lighting: shot.lighting,
        },
        shot_context: {
          scene_id: shot.scene_id,
          shot_number: shot.shot_number,
        },
        style_bible: project.style_bible,
        project_context: {
          project_id: project.id,
          visual_style: project.visual_style,
          character_anchor: project.character_anchor,
          story_entities: project.story_entities,
        },
      },
      shot_payload: shot,
      scene_payload: scenePayload,
      previous_shot: previousShot || null,
      previous_prompt: previousPrompt || null,
    }),
  });

  if (res.status !== 200) {
    throw new Error(`generateShotImage failed for ${shot.shot_id}: ${res.status} ${JSON.stringify(res.data)}`);
  }

  return res.data;
}

async function validateStoryboardShot(projectId: string, token: string, shot: any, imageUrl: string, previousShot?: any) {
  const res = await j(`${API}/api/storyboard/${projectId}/shots/${shot.shot_id}/validate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      image_url: imageUrl,
      shot,
      previous_shot: previousShot || null,
      scene_state: {
        location: shot.location || shot.scene_setting,
        lighting: shot.lighting,
        time_of_day: shot.time_of_day,
      },
      character_state: {
        characters: shot.characters || [],
      },
    }),
  });

  if (res.status !== 200) {
    throw new Error(`validateStoryboardShot failed for ${shot.shot_id}: ${res.status} ${JSON.stringify(res.data)}`);
  }

  return res.data;
}

async function generateVoice(token: string, text: string, voice_id: string) {
  const res = await j(`${API}/api/audio/elevenlabs`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ text, voice_id, speed: 1.0, stability: 0.45, similarity_boost: 0.8 }),
  });
  return { status: res.status, data: res.data };
}

async function main() {
  const user = await createProofUser();
  const project = await generateProject(user.token);

  const first8 = (project.scenes || []).slice(0, 8);
  const generated: any[] = [];
  let prevShot: any = null;
  let prevPrompt = '';

  for (const shot of first8) {
    const imageRes = await generateShotImage(project, user.token, shot, prevShot, prevPrompt);
    const validateRes = await validateStoryboardShot(project.id, user.token, shot, imageRes.image.url, prevShot || undefined);
    generated.push({
      shot_id: shot.shot_id,
      scene_id: shot.scene_id,
      image_url: imageRes.image.url,
      continuity_score: imageRes.generation?.continuity_score,
      continuity_failures: imageRes.generation?.continuity_failures || [],
      storyboard_validation: validateRes.continuity_report,
      temporal_guidance: shot.temporal_guidance,
      character_anchor: project.character_anchor,
    });
    prevShot = shot;
    prevPrompt = imageRes.generation?.prompt || shot.image_prompt || '';
  }

  // Regenerate shot 1 with a different seed, then revalidate.
  const targetShot = first8[0];
  const regen = await generateShotImage(project, user.token, targetShot, null, '', 989898);
  const regenValidate = await validateStoryboardShot(project.id, user.token, targetShot, regen.image.url);

  // Voice proof attempt with 2 voices.
  const voiceA = await generateVoice(user.token, 'Freeze! Put your hands where I can see them.', 'en_female_rachel');
  const voiceB = await generateVoice(user.token, 'You will never catch me, detective.', 'en_male_adam');

  const result = {
    user,
    project_summary: {
      id: project.id,
      title: project.project_title,
      scene_count: project.scenes?.length || 0,
      director_os_layers: project.director_os_layers,
      director_os_degraded: project.director_os_degraded,
      director_os_critical_failures: project.director_os_critical_failures,
      shot_graph_count: project.shot_graph?.length || 0,
      storyboard_12panel_count: project.storyboard_12panel?.length || 0,
      edit_plan: project.edit_timeline_plan,
      verifier_report: project.verifier_report,
      character_identity_law: project.character_identity_law,
    },
    first_8_shots: generated,
    regeneration_test: {
      shot_id: targetShot.shot_id,
      original_image_url: generated[0]?.image_url,
      regenerated_image_url: regen.image.url,
      original_validation: generated[0]?.storyboard_validation,
      regenerated_validation: regenValidate.continuity_report,
    },
    voice_test: {
      voice_a: voiceA,
      voice_b: voiceB,
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, 'proof-result.json'), JSON.stringify(result, null, 2));
  console.log(`Saved proof result to ${path.join(OUT_DIR, 'proof-result.json')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
