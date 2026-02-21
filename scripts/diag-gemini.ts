import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fetch from 'node-fetch';
import fs from 'fs/promises';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE!;
const API_BASE = 'http://localhost:3002';

async function createTestUser() {
  const email = `diag-${Date.now()}@example.com`;
  const password = 'TestPassword123!';

  const adminRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
    },
    body: JSON.stringify({ email, password, user_metadata: { diag: true } }),
  });

  const adminData: any = await adminRes.json();
  const userId = adminData.id;
  if (!userId) throw new Error(`admin create failed: ${JSON.stringify(adminData)}`);

  // confirm email
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
    },
    body: JSON.stringify({ email_confirm: true }),
  });

  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const tokenData: any = await tokenRes.json();
  const token = tokenData.access_token;
  if (!token) throw new Error(`token failed: ${JSON.stringify(tokenData)}`);

  // ensure profile exists/credits
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ credits: 10, name: 'Diag User' }),
  }).catch(() => {});

  return { email, userId, token };
}

async function runDiag() {
  console.log('Creating diagnostic test user...');
  const { token } = await createTestUser();

  const anchor = 'A brave warrior wearing a red ski suit with golden armor, holding a snowboard, short black spiky hair';

  console.log('Calling /api/gemini/generate with anchor:', anchor.substring(0, 80));

  const res = await fetch(`${API_BASE}/api/gemini/generate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storyIdea: 'Diagnostic: test scene consistency',
      visualStyle: 'Cinematic Realism',
      language: 'en',
      mode: 'storyboard',
      identityAnchor: anchor,
    }),
  });

  const text = await res.text();
  console.log('\n-- HTTP STATUS:', res.status);

  // Try to pretty print JSON if possible
  try {
    const project = JSON.parse(text);
    await fs.mkdir('./tmp', { recursive: true });
    await fs.writeFile('./tmp/diag-project.json', JSON.stringify(project, null, 2), 'utf8');
    console.log('Saved diagnostic JSON to ./tmp/diag-project.json');
    console.log('Top-level keys:', Object.keys(project));
    console.log('\nFirst scene (trimmed):');
    console.log(JSON.stringify(project.scenes?.[0], null, 2).substring(0, 2000));
  } catch (e) {
    console.log('Response (non-JSON):', text.substring(0, 2000));
  }
}

runDiag().catch(err => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
