import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const ANON = process.env.VITE_SUPABASE_ANON_KEY!;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const API = 'http://localhost:3002';
const OUT = path.resolve('./tmp/proof/H_voice_result_forced.json');

async function j(url: string, opts: RequestInit = {}) {
  const r = await fetch(url, opts);
  const t = await r.text();
  let d: any;
  try { d = JSON.parse(t); } catch { d = { raw: t }; }
  return { status: r.status, data: d };
}

async function main() {
  const email = `proof-voice-${Date.now()}@example.com`;
  const password = 'TestPassword123!';

  const create = await j(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON, authorization: `Bearer ${SR}` },
    body: JSON.stringify({ email, password }),
  });
  if (create.status >= 300) throw new Error(JSON.stringify(create.data));
  const userId = create.data.id;

  await j(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', apikey: ANON, authorization: `Bearer ${SR}` },
    body: JSON.stringify({ email_confirm: true }),
  });

  const tok = await j(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email, password }),
  });
  const token = tok.data.access_token;

  const text = 'Maya, move now. The train is leaving in ten seconds. Keep your eyes on the red signal and do not look back.';
  const voiceRes = await j(`${API}/api/audio/generate-dialogue`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      voice: 'en_female_rachel',
      emotion: 'tense',
      language: 'en',
    }),
  });

  const out = { email, status: voiceRes.status, request_text: text, response: voiceRes.data };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
