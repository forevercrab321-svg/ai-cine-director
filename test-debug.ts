import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3002';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function test() {
  const email = `test-${Date.now()}@example.com`;
  const password = 'Test123456!';

  console.log('1. Creating user with 0 credits...');
  const adminRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE}`
    },
    body: JSON.stringify({
      email,
      password,
      email_confirmed: true
    })
  });

  const userData: any = await adminRes.json();
  const userId = userData.id;
  if (!userId) {
    console.error('Failed to create user:', userData);
    return;
  }
  console.log('✓ User created:', userId.substring(0, 8) + '...');

  console.log('2. Getting auth token...');
  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY
    },
    body: JSON.stringify({ email, password })
  });

  const tokenData: any = await tokenRes.json();
  const token = tokenData.access_token;
  if (!token) {
    console.error('Failed to get token:', tokenData);
    return;
  }
  console.log('✓ Token obtained');

  console.log('3. Setting profile credits to 0...');
  const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ credits: 0 })
  });
  console.log('✓ Profile updated (status:', patchRes.status + ')');

  console.log('4. Attempting to generate with 0 credits (should get 402)...');
  const genRes = await fetch(`${API_BASE}/api/gemini/generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      storyIdea: 'Test',
      visualStyle: 'Cinema',
      language: 'en',
      mode: 'storyboard'
    })
  });

  console.log('Result status:', genRes.status);
  const respData: any = await genRes.json();
  console.log('Result:', JSON.stringify(respData, null, 2));
}

test().catch(console.error);
