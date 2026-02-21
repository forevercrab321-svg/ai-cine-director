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

  console.log('1. Creating user...');
  // 方法：用管理员API创建后，用updateUser来标记邮件已确认
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
      user_metadata: { test: true }
    })
  });

  const userData: any = await adminRes.json();
  const userId = userData.id;
  console.log('✓ User ID:', userId.substring(0, 8) + '...');

  console.log('2. Confirming email...');
  // 用updateUser将邮件标记为已确认
  const confirmRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE}`
    },
    body: JSON.stringify({
      email_confirm: true  // 标记邮件已确认
    })
  });
  console.log('✓ Email confirmed (status:', confirmRes.status + ')');

  console.log('3. Getting token...');
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
    console.error('❌ Failed to get token:', tokenData);
    return;
  }
  console.log('✓ Token obtained');

  console.log('4. Setting profile to 0 credits...');
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ credits: 0 })
  });
  console.log('✓ Profile updated');

  console.log('5. Testing generation with 0 credits (should be 402)...');
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

  console.log('✓ Response status:', genRes.status);
  const respData: any = await genRes.json();
  if (genRes.status === 402) {
    console.log('✅ SUCCESS: Got 402 as expected!');
  } else {
    console.log('❌ FAIL: Expected 402, got', genRes.status);
  }
  console.log('Response:', JSON.stringify(respData, null, 2).substring(0, 200));
}

test().catch(console.error);
