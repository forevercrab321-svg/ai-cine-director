import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fetch from 'node-fetch';
import { setTimeout as delay } from 'timers/promises';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE!;
const API_BASE = 'http://localhost:3002';

async function createTestUser() {
  const email = `stress-${Date.now()}@example.com`;
  const password = 'StressPass123!';

  const adminRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
    },
    body: JSON.stringify({ email, password, user_metadata: { stress: true } }),
  });
  const adminData: any = await adminRes.json();
  const userId = adminData.id;
  if (!userId) throw new Error(`admin create failed: ${JSON.stringify(adminData)}`);

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

  // Give some credits
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ credits: 20 }),
  }).catch(() => {});

  return { token, userId };
}

async function run() {

async function retryFetch(input: any, init?: any, retries = 3, backoffMs = 200) {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(input, init);
      if (res.ok || (res.status >= 400 && res.status < 500)) return res; // return on success or client error
      // server error -> retry
      throw new Error(`HTTP ${res.status}`);
    } catch (err: any) {
      attempt++;
      const isNetwork = err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.type === 'system';
      if (attempt > retries || !isNetwork) throw err;
      const wait = backoffMs * Math.pow(2, attempt - 1);
      await delay(wait);
    }
  }
}

console.log('Starting lightweight stress test (6 requests total)');
  const { token, userId } = await createTestUser();

  const calls = [] as Promise<any>[];
  // 3 sequential and 3 concurrent
  for (let i = 0; i < 3; i++) {
    calls.push(retryFetch(`${API_BASE}/api/gemini/generate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storyIdea: `Stress test ${i+1}`,
        visualStyle: 'Cinematic Realism',
        language: 'en',
        mode: 'storyboard',
        identityAnchor: 'A short test anchor'
      }),
    }).then(r => ({ status: r.status, text: r.text ? r.text : 'no-text' })).catch(e => ({ error: e.message })));
  }

  // Concurrent batch
  const concurrent = Array.from({ length: 3 }).map((_, i) => retryFetch(`${API_BASE}/api/gemini/generate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storyIdea: `Concurrent stress ${i+1}`,
      visualStyle: 'Cinematic Realism',
      language: 'en',
      mode: 'storyboard',
      identityAnchor: 'A short test anchor'
    }),
  }).then(r => ({ status: r.status })).catch(e => ({ error: e.message })));

  const seqResults = await Promise.all(calls);
  console.log('Sequential call results:', seqResults.map(s => 'status' in s ? s.status : s.error));

  const concResults = await Promise.all(concurrent);
  console.log('Concurrent call results:', concResults.map(s => 'status' in s ? s.status : s.error));

  const balanceRes = await retryFetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}` }
  });
  const data: any = await balanceRes.json();
  console.log('Final balance (profile):', data[0]?.credits);
}

run().catch(e => { console.error('Stress test failed:', e); process.exit(1); });
