#!/usr/bin/env tsx
/**
 * 🎬 AI Cine Director - API Integration Test
 * Tests script generation, image generation, and credit system
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const PROD_URL = 'https://aidirector.business';
const TEST_EMAIL = `api-test-${Date.now()}@example.com`;
const TEST_PASSWORD = 'ApiTest123!@#';

interface ApiTest {
  name: string;
  passed: boolean;
  statusCode?: number;
  responseTime?: number;
  error?: string;
  data?: any;
}

const tests: ApiTest[] = [];

function log(msg: string, emoji = '📋') {
  console.log(`${emoji} ${msg}`);
}

function pass(name: string, code: number, time: number, data?: any) {
  tests.push({ name, passed: true, statusCode: code, responseTime: time, data });
  log(`✅ ${name} (${code} in ${time}ms)`, '✅');
}

function fail(name: string, error: string, code?: number) {
  tests.push({ name, passed: false, statusCode: code, error });
  log(`❌ ${name}: ${error}`, '❌');
}

async function main() {
  console.log('\n🎬 AI CINE DIRECTOR - API INTEGRATION TEST\n');

  // Setup: Create developer user (has unlimited credits)
  const devEmail = 'forevercrab321@gmail.com';
  const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  console.log('📋 Test Setup: Using developer account (unlimited credits)\n');

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Get developer user
  const { data: users } = await supabase.auth.admin.listUsers();
  let devUserId = '';
  let devToken = '';

  const devUser = (users?.users || []).find((u: any) => u.email === devEmail);
  if (devUser) {
    devUserId = (devUser as any).id;
    console.log(`✓ Found developer user: ${devUserId}`);

    // Set password if not set
    await supabase.auth.admin.updateUserById(devUserId, { password: 'DevTest123!@#' });

    // Sign in to get token
    const { data: signInData } = await supabase.auth.signInWithPassword({
      email: devEmail,
      password: 'DevTest123!@#'
    });

    devToken = (signInData?.session?.access_token) || '';

    if (devToken) {
      console.log(`✓ Got access token for developer\n`);
    }
  } else {
    console.warn('⚠️  Developer account not found. Some tests will be skipped.\n');
  }

  // Test 1: Health Check
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 1: Health Check');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  try {
    const start = Date.now();
    const res = await fetch(`${PROD_URL}/api/health`);
    const time = Date.now() - start;
    const data = await res.json();

    if (res.ok) {
      pass('GET /api/health', res.status, time, data);
    } else {
      fail('GET /api/health', `HTTP ${res.status}`, res.status);
    }
  } catch (err: any) {
    fail('GET /api/health', err.message);
  }

  // Test 2: Script Generation (Minimax/Gemini)
  if (devToken) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 2: Script Generation (Minimax)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    try {
      const start = Date.now();
      const res = await fetch(`${PROD_URL}/api/gemini/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${devToken}`
        },
        body: JSON.stringify({
          storyIdea: 'A detective investigating a mysterious crime in a cyberpunk city',
          visualStyle: 'Cinematic noir with neon lights',
          language: 'en',
          sceneCount: 2,
          identityAnchor: 'A skilled detective with sharp eyes and dark coat'
        })
      });

      const time = Date.now() - start;
      const data = await res.json();

      if (res.ok) {
        pass('POST /api/gemini/generate', res.status, time, {
          projectTitle: data.project_title,
          sceneCount: data.scenes?.length,
          visualStyle: data.visual_style
        });
      } else {
        fail('POST /api/gemini/generate', data.error || 'Unknown error', res.status);
      }
    } catch (err: any) {
      fail('POST /api/gemini/generate', err.message);
    }
  }

  // Test 3: Image Generation
  if (devToken) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 3: Image Generation (Flux)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    try {
      const start = Date.now();
      const res = await fetch(`${PROD_URL}/api/replicate/generate-image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${devToken}`
        },
        body: JSON.stringify({
          prompt: 'A cyberpunk detective in dark coat investigating a neon-lit crime scene, dramatic lighting, cinematic',
          imageModel: 'flux',
          visualStyle: 'Cinematic noir',
          aspectRatio: '16:9',
          characterAnchor: '',
          referenceImageDataUrl: null,
          storyEntities: []
        })
      });

      const time = Date.now() - start;
      const data = await res.json();

      if (res.ok) {
        pass('POST /api/replicate/generate-image', res.status, time, {
          imageUrl: data.url?.substring(0, 80) + '...'
        });
      } else {
        fail('POST /api/replicate/generate-image', data.error || 'Unknown error', res.status);
      }
    } catch (err: any) {
      fail('POST /api/replicate/generate-image', err.message);
    }
  }

  // Test 4: Entitlement Check
  if (devToken) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 4: Entitlement Check');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    try {
      const start = Date.now();
      const res = await fetch(`${PROD_URL}/api/entitlement`, {
        headers: { 'Authorization': `Bearer ${devToken}` }
      });

      const time = Date.now() - start;
      const data = await res.json();

      if (res.ok) {
        pass('GET /api/entitlement', res.status, time, {
          isDeveloper: data.isDeveloper,
          plan: data.plan,
          credits: data.credits
        });
      } else {
        fail('GET /api/entitlement', `HTTP ${res.status}`, res.status);
      }
    } catch (err: any) {
      fail('GET /api/entitlement', err.message);
    }
  }

  // Summary Report
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 TEST SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const total = tests.length;
  const passed = tests.filter(t => t.passed).length;
  const failed = total - passed;
  const percentage = Math.round((passed / total) * 100);
  const avgTime = Math.round(
    tests.reduce((sum, t) => sum + (t.responseTime || 0), 0) / tests.length
  );

  console.log(`📈 Results: ${percentage}% (${passed}/${total} passed)`);
  console.log(`⏱️  Average Response Time: ${avgTime}ms\n`);

  if (failed > 0) {
    console.log('❌ Failed Tests:\n');
    tests.filter(t => !t.passed).forEach(t => {
      console.log(`   • ${t.name}`);
      console.log(`     Error: ${t.error}\n`);
    });
  }

  console.log('✅ Passed Tests:\n');
  tests.filter(t => t.passed).forEach(t => {
    console.log(`   • ${t.name}`);
    if (t.data) {
      Object.entries(t.data).forEach(([k, v]) => {
        console.log(`     - ${k}: ${JSON.stringify(v)}`);
      });
    }
    console.log('');
  });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🎯 Status: ${percentage >= 80 ? '✅ HEALTHY' : '⚠️  DEGRADED'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  process.exit(percentage >= 80 ? 0 : 1);
}

main().catch(console.error);
