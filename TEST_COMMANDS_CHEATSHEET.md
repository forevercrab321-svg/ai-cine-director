#!/bin/bash

# Display test command cheat sheet
cat << 'EOF'

╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                   🎬 AI CINE DIRECTOR — TEST COMMANDS                        ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝

┌─ SETUP ─────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  1. Ensure backend is running:                                            │
│     $ npm run server                                                       │
│                                                                             │
│  2. In another terminal, run tests:                                        │
│     $ npm run test:api                                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─ API INTEGRATION TESTS ──────────────────────────────────────────────────────┐
│                                                                             │
│  ✅ Quick Test (Recommended First)                                         │
│     $ npm run test:api                                                     │
│                                                                             │
│     Tests:                                                                 │
│     1. Missing Character Anchor Auto-Correction                           │
│     2. Insufficient Credits Guard                                         │
│     3. Character Consistency Keywords Enforcement                         │
│     4. Image Prompt Consistency (Bonus)                                   │
│                                                                             │
│     Expected: All 4 tests pass in ~30-60 seconds                          │
│                                                                             │
│  🔄 Watch Mode (Re-run on file changes)                                   │
│     $ npm run test:api:watch                                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─ STRESS TEST SUITE ──────────────────────────────────────────────────────────┐
│                                                                             │
│  🏋️  Full Backend Stress Test                                              │
│     $ npm run stress-test                                                  │
│                                                                             │
│     Tests (10 total):                                                      │
│     1. Single Credit Deduction                                             │
│     2. Concurrent Deductions (Race Condition Prevention)                   │
│     3. Character Anchor Consistency Enforcement                            │
│     4. Reserve → Finalize → Refund Flow                                    │
│     5. Insufficient Credits Guard                                          │
│     6. Negative Credit Prevention                                          │
│     7. Concurrent Storyboard Generation                                    │
│     8. Auth Token Validation                                               │
│     9. Video Motion Prompt Consistency                                     │
│     10. Error Recovery & Refund                                            │
│                                                                             │
│     Expected: All 10 tests pass in ~2-5 minutes                           │
│                                                                             │
│  🔄 Watch Mode                                                              │
│     $ npm run stress-test:watch                                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─ FULL DEVELOPMENT WORKFLOW ──────────────────────────────────────────────────┐
│                                                                             │
│  Terminal 1 - Backend:                                                    │
│  $ npm run server                                                          │
│                                                                             │
│  Terminal 2 - Frontend:                                                   │
│  $ npm run dev                                                             │
│                                                                             │
│  OR both at once:                                                          │
│  $ npm run dev:all                                                         │
│                                                                             │
│  Terminal 3 - Testing:                                                    │
│  $ npm run test:api                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─ DEBUG & TROUBLESHOOT ──────────────────────────────────────────────────────┐
│                                                                             │
│  Check backend health:                                                    │
│  $ curl http://localhost:3002/api/health                                  │
│                                                                             │
│  View test file:                                                          │
│  $ cat scripts/test-api.ts                                                │
│                                                                             │
│  Read test guide:                                                         │
│  $ cat scripts/TEST_API_GUIDE.md                                          │
│                                                                             │
│  Check environment:                                                       │
│  $ grep SUPABASE .env.local                                               │
│  $ grep GEMINI .env.local                                                 │
│  $ grep REPLICATE .env.local                                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─ WHAT EACH TEST VALIDATES ──────────────────────────────────────────────────┐
│                                                                             │
│  ✅ Test 1: Character Anchor Auto-Correction                              │
│     └─ Verifies backend generates default anchor if not provided          │
│                                                                             │
│  ✅ Test 2: Credit Guard                                                  │
│     └─ Confirms 402 error when credits insufficient                       │
│     └─ Validates no deduction occurs on failure                           │
│                                                                             │
│  ✅ Test 3: Character Consistency                                          │
│     └─ All scenes start with EXACT anchor text                            │
│     └─ Keywords (red, ski suit, etc.) present in scenes                   │
│     └─ Backend consistency metadata is populated                          │
│     └─ Keyword coverage ≥ 70%                                             │
│                                                                             │
│  ✅ Test 4: Image Prompts                                                 │
│     └─ image_prompt field is generated                                    │
│     └─ Includes anchor + visual description                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─ EXPECTED OUTPUT ───────────────────────────────────────────────────────────┐
│                                                                             │
│  ✅ All 4 API tests pass:                                                  │
│     SUMMARY: 4/4 tests passed (100%)                                      │
│                                                                             │
│  ✅ All 10 stress tests pass:                                              │
│     SUMMARY: 10/10 tests passed (100%)                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

💡 TIP: For CI/CD pipelines, add this to your GitHub Actions:

   - name: API Integration Tests
     run: npm run test:api
     if: github.event_name == 'pull_request'

   - name: Stress Test Suite
     run: npm run stress-test
     if: github.ref == 'refs/heads/main'

EOF
