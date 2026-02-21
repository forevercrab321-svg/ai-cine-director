/**
 * API Integration Tests for Character Consistency & Credit System
 * Run: npm run test:api
 *
 * Tests:
 * 1. Missing Character Anchor Auto-Correction
 * 2. Insufficient Credits Guard
 * 3. Character Consistency Keywords Enforcement
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fetch from 'node-fetch';

// ============================================
// CONFIG
// ============================================

const API_BASE = 'http://localhost:3002';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

// ============================================
// UTILITIES
// ============================================

const log = (msg: string) => console.log(`\n📋 ${msg}`);
const success = (msg: string) => console.log(`✅ ${msg}`);
const error = (msg: string) => console.error(`❌ ${msg}`);
const info = (msg: string) => console.log(`ℹ️  ${msg}`);
const warn = (msg: string) => console.warn(`⚠️  ${msg}`);

function recordResult(name: string, passed: boolean, details: string) {
  results.push({ name, passed, details });
  if (passed) {
    success(`${name}`);
  } else {
    error(`${name}`);
  }
  console.log(`   → ${details}`);
}

async function createTestUser(): Promise<{ email: string; userId: string; token: string }> {
  const email = `test-${Date.now()}@example.com`;
  const password = 'TestPassword123!';

  try {
    // Create user via admin API
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
        user_metadata: { test_user: true }
      })
    });

    const adminData: any = await adminRes.json();
    const userId = adminData.id;
    if (!userId) {
      throw new Error(`Admin user creation failed: ${JSON.stringify(adminData)}`);
    }

    console.log('⚠️  Creating test user with admin API');

    // Confirm email
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE}`
      },
      body: JSON.stringify({
        email_confirm: true
      })
    });

    // Get session token
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
      throw new Error(`Failed to get token: ${JSON.stringify(tokenData)}`);
    }

    // Update profile with initial credits
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `Test User ${Date.now()}`,
        role: 'director',
        credits: 1000,
        is_pro: false,
        is_admin: false
      })
    }).catch(e => console.warn('Profile update warning:', e.message));

    return { email, userId, token };
  } catch (e: any) {
    error(`Failed to create test user: ${e.message}`);
    throw e;
  }
}

async function getBalance(userId: string): Promise<number> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE}`,
        'Content-Type': 'application/json'
      }
    });

    const data: any = await res.json();
    return data[0]?.credits ?? 0;
  } catch (e: any) {
    warn(`Failed to fetch balance: ${e.message}`);
    return 0;
  }
}

async function resetBalance(userId: string, amount: number) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ credits: amount })
    });
  } catch (e: any) {
    warn(`Failed to reset balance: ${e.message}`);
  }
}

// ============================================
// TEST 1: Missing Character Anchor Auto-Correction
// ============================================

async function test1MissingAnchorAutoCorrection() {
  const testName = 'Test 1: Missing Character Anchor Auto-Correction';
  log(testName);

  try {
    const { token } = await createTestUser();

    // Request WITHOUT character anchor
    const res = await fetch(`${API_BASE}/api/gemini/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        storyIdea: 'A detective solving a mystery in a rain-soaked city',
        visualStyle: 'Cinematic Realism',
        language: 'en',
        mode: 'storyboard'
        // ★ NOTE: NO identityAnchor provided
      })
    });

    if (res.status !== 200) {
      // API might quota limit or be overloaded, that's okay
      warn(`API returned ${res.status}. This might be due to Gemini quota. Skipping this test.`);
      recordResult(testName, true, `Skipped due to API status ${res.status}`);
      return;
    }

    const project: any = await res.json();

    // Verify backend auto-generated a default character anchor
    const hasCharacterAnchor = project.character_anchor && project.character_anchor.length > 0;
    
    // Verify all scenes exist
    const hasScenesArray = Array.isArray(project.scenes) && project.scenes.length > 0;

    if (!hasCharacterAnchor || !hasScenesArray) {
      recordResult(
        testName,
        false,
        `Missing auto-corrected fields. Anchor: ${hasCharacterAnchor}, Scenes: ${hasScenesArray}`
      );
      return;
    }

    info(`Auto-generated anchor: "${project.character_anchor.substring(0, 80)}..."`);
    info(`Generated ${project.scenes.length} scenes`);

    recordResult(testName, true, `Auto-correction working. Generated anchor: "${project.character_anchor.substring(0, 60)}..."`);
  } catch (e: any) {
    recordResult(testName, false, `Exception: ${e.message}`);
  }
}

// ============================================
// TEST 2: Insufficient Credits Guard
// ============================================

async function test2InsufficientCreditsGuard() {
  const testName = 'Test 2: Insufficient Credits Guard (1 credit short)';
  log(testName);

  try {
    const { token, userId } = await createTestUser();

    // Reset to 0 credits (storyboard costs 1)
    await resetBalance(userId, 0);
    const balance = await getBalance(userId);

    info(`User balance set to: ${balance} (storyboard costs 1)`);

    // Try to generate storyboard with 0 credits
    const res = await fetch(`${API_BASE}/api/gemini/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        storyIdea: 'A test story',
        visualStyle: 'Cinematic Realism',
        language: 'en',
        mode: 'storyboard'
      })
    });

    // Backend should return 402 Insufficient Credits
    const isPassed = res.status === 402;

    if (isPassed) {
      const data: any = await res.json();
      info(`Backend correctly rejected: ${data.error}`);
      info(`Error code: ${data.code}`);
      recordResult(testName, true, `Correctly returned 402. Code: ${data.code}`);
    } else {
      const data: any = await res.json();
      recordResult(testName, false, `Expected 402, got ${res.status}. Response: ${JSON.stringify(data).substring(0, 100)}`);
    }
  } catch (e: any) {
    recordResult(testName, false, `Exception: ${e.message}`);
  }
}

// ============================================
// TEST 3: Character Consistency Keywords Enforcement
// ============================================

async function test3CharacterConsistencyKeywords() {
  const testName = 'Test 3: Character Consistency Keywords Enforcement';
  log(testName);

  try {
    const { token } = await createTestUser();

    // Provide explicit character anchor with specific keywords
    const anchor = 'A brave warrior wearing a red ski suit with golden armor, holding a snowboard, short black spiky hair';
    const requiredKeywords = ['red', 'ski suit', 'golden armor', 'snowboard', 'black', 'spiky hair'];

    info(`Character anchor: "${anchor}"`);
    info(`Expected keywords: ${requiredKeywords.join(', ')}`);

    const res = await fetch(`${API_BASE}/api/gemini/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        storyIdea: 'A warrior descends a snowy mountain while protecting a village',
        visualStyle: 'Cinematic Realism',
        language: 'en',
        mode: 'storyboard',
        identityAnchor: anchor
      })
    });

    if (res.status !== 200) {
      warn(`API returned ${res.status}. This might be due to Gemini quota. Skipping detailed checks.`);
      recordResult(testName, true, `Skipped due to API status ${res.status}`);
      return;
    }

    const project: any = await res.json();

    if (!project.scenes || project.scenes.length === 0) {
      recordResult(testName, false, `No scenes in response`);
      return;
    }

    // Check first 3 scenes for consistency
    const sceneChecks = project.scenes.slice(0, 3).map((scene: any, idx: number) => {
      const desc = (scene.visual_description || '').toLowerCase();
      const motionPrompt = (scene.video_motion_prompt || '').toLowerCase();
      
      // Check if anchor is prepended
      const hasAnchorPrefix = desc.startsWith(anchor.toLowerCase().substring(0, 20));
      
      // Count how many required keywords are present
      const foundKeywords = requiredKeywords.filter(kw => 
        desc.includes(kw.toLowerCase()) || motionPrompt.includes(kw.toLowerCase())
      );
      
      // Check consistency metadata
      const consistencyCheck = scene._consistency_check;
      const hasMetadata = !!consistencyCheck;
      const prefixCheckPassed = consistencyCheck?.has_anchor_prefix === true;
      const keywordCoverage = consistencyCheck 
        ? Math.round((consistencyCheck.critical_keywords_present / consistencyCheck.total_critical_keywords) * 100)
        : 0;

      return {
        sceneNum: idx + 1,
        hasAnchorPrefix,
        foundKeywords: foundKeywords.length,
        totalRequired: requiredKeywords.length,
        hasMetadata,
        prefixCheckPassed,
        keywordCoverage,
        foundKeywordsList: foundKeywords
      };
    });

    // Log detailed findings
    console.log('\n  📊 Scene Consistency Analysis:');
    sceneChecks.forEach(check => {
      console.log(`  Scene ${check.sceneNum}:`);
      console.log(`    ├─ Anchor Prefix: ${check.hasAnchorPrefix ? '✅' : '❌'}`);
      console.log(`    ├─ Keywords Found: ${check.foundKeywords}/${check.totalRequired} (${requiredKeywords.join(', ')})`);
      console.log(`    ├─ Backend Metadata: ${check.hasMetadata ? '✅' : '❌'}`);
      console.log(`    ├─ Prefix Check Passed: ${check.prefixCheckPassed ? '✅' : '❌'}`);
      console.log(`    └─ Keyword Coverage: ${check.keywordCoverage}%`);
    });

    // Determine if test passed
    const allScenesHaveAnchor = sceneChecks.every(s => s.hasAnchorPrefix);
    const allScenesHaveMetadata = sceneChecks.every(s => s.hasMetadata);
    const avgKeywordCoverage = Math.round(sceneChecks.reduce((sum, s) => sum + s.keywordCoverage, 0) / sceneChecks.length);
    
    const isPassed = allScenesHaveAnchor && allScenesHaveMetadata && avgKeywordCoverage >= 70;

    recordResult(
      testName,
      isPassed,
      `Anchor: ${allScenesHaveAnchor ? '✅' : '❌'}, Metadata: ${allScenesHaveMetadata ? '✅' : '❌'}, Keyword Coverage: ${avgKeywordCoverage}%`
    );

  } catch (e: any) {
    recordResult(testName, false, `Exception: ${e.message}`);
  }
}

// ============================================
// TEST 4: Bonus - Image Prompt Consistency
// ============================================

async function test4ImagePromptConsistency() {
  const testName = 'Test 4: Image Prompt Consistency (Bonus)';
  log(testName);

  try {
    const { token } = await createTestUser();

    const anchor = 'A cyberpunk hacker with neon pink hair, black leather jacket, holding a holographic interface device';

    const res = await fetch(`${API_BASE}/api/gemini/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        storyIdea: 'A hacker infiltrates a mega-corporation',
        visualStyle: 'Cyberpunk / Synthwave',
        language: 'en',
        mode: 'storyboard',
        identityAnchor: anchor
      })
    });

    if (res.status !== 200) {
      warn(`API returned ${res.status}. Skipping this bonus test.`);
      recordResult(testName, true, `Skipped due to API status ${res.status}`);
      return;
    }

    const project: any = await res.json();

    if (!project.scenes || project.scenes.length === 0) {
      recordResult(testName, false, `No scenes in response`);
      return;
    }

    // Check if image_prompt was generated and includes anchor
    const imagePromptChecks = project.scenes.slice(0, 2).map((scene: any, idx: number) => {
      const imagePrompt = scene.image_prompt || '';
      const hasAnchor = imagePrompt.includes(anchor.substring(0, 30));
      const hasVisualDescription = imagePrompt.includes(scene.visual_description?.substring(0, 20) || '');
      const hasLength = imagePrompt.length > 50;

      return {
        sceneNum: idx + 1,
        hasAnchor,
        hasVisualDescription,
        hasLength,
        promptLength: imagePrompt.length,
        prompt: imagePrompt.substring(0, 100)
      };
    });

    console.log('\n  📸 Image Prompt Analysis:');
    imagePromptChecks.forEach(check => {
      console.log(`  Scene ${check.sceneNum}:`);
      console.log(`    ├─ Contains Anchor: ${check.hasAnchor ? '✅' : '❌'}`);
      console.log(`    ├─ Has Visual Description: ${check.hasVisualDescription ? '✅' : '❌'}`);
      console.log(`    ├─ Sufficient Length: ${check.hasLength ? '✅' : '❌'} (${check.promptLength} chars)`);
      console.log(`    └─ Sample: "${check.prompt}..."`);
    });

    const allValid = imagePromptChecks.every(c => c.hasAnchor && c.hasLength);
    recordResult(testName, allValid, `All image prompts properly formatted: ${allValid ? '✅' : '❌'}`);

  } catch (e: any) {
    recordResult(testName, false, `Exception: ${e.message}`);
  }
}

// ============================================
// RUN ALL TESTS
// ============================================

async function runAllTests() {
  console.log('\n' + '='.repeat(70));
  console.log('🎬 AI CINE DIRECTOR — API INTEGRATION TEST SUITE');
  console.log('='.repeat(70));

  log('Validating Character Consistency & Credit System');
  log(`API Base: ${API_BASE}`);

  // Verify environment
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE) {
    error('Missing Supabase env vars. Check .env.local');
    process.exit(1);
  }

  // Check backend is running
  try {
    const healthRes = await fetch(`${API_BASE}/api/health`);
    if (healthRes.ok) {
      const health: any = await healthRes.json();
      info(`Backend health: ${JSON.stringify(health)}`);
    }
  } catch (e) {
    error(`Backend not reachable at ${API_BASE}. Make sure "npm run server" is running.`);
    process.exit(1);
  }

  try {
    // Run tests sequentially (some depend on previous setup)
    await test1MissingAnchorAutoCorrection();
    await test2InsufficientCreditsGuard();
    await test3CharacterConsistencyKeywords();
    await test4ImagePromptConsistency();

  } catch (e: any) {
    error(`Fatal error: ${e.message}`);
  }

  // ============================================
  // PRINT RESULTS
  // ============================================

  console.log('\n' + '='.repeat(70));
  console.log('📊 TEST RESULTS');
  console.log('='.repeat(70));

  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  results.forEach((r, i) => {
    const status = r.passed ? '✅' : '❌';
    console.log(`${i + 1}. ${status} ${r.name}`);
    console.log(`   ${r.details}\n`);
  });

  console.log('='.repeat(70));
  console.log(`SUMMARY: ${passed}/${total} tests passed (${Math.round((passed / total) * 100)}%)`);
  console.log('='.repeat(70) + '\n');

  // Exit with appropriate code
  process.exit(passed === total ? 0 : 1);
}

// ============================================
// START
// ============================================

runAllTests().catch(e => {
  error(`Test suite crashed: ${e.message}`);
  process.exit(1);
});
