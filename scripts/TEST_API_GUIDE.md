# API Integration Tests - Quick Start

## Overview

The API integration test suite validates:

1. **Test 1**: Missing Character Anchor Auto-Correction
   - Verifies backend auto-generates default anchor when none provided
   - Checks that all scenes are generated properly

2. **Test 2**: Insufficient Credits Guard
   - Sets user balance to 0 (storyboard costs 1 credit)
   - Verifies backend correctly returns 402 error
   - Ensures credit guard prevents deduction

3. **Test 3**: Character Consistency Keywords Enforcement
   - Provides detailed character anchor with specific keywords
   - Verifies all scenes start with anchor text
   - Checks backend consistency metadata (`_consistency_check`)
   - Validates keyword coverage across scenes

4. **Test 4**: Image Prompt Consistency (Bonus)
   - Verifies generated `image_prompt` field includes anchor
   - Ensures prompts are properly formatted for Replicate API

## Prerequisites

```bash
# 1. Ensure .env.local has all required variables
echo "Check .env.local for:"
echo "  - VITE_SUPABASE_URL"
echo "  - VITE_SUPABASE_ANON_KEY"
echo "  - SUPABASE_SERVICE_ROLE_KEY (for tests)"
echo "  - GEMINI_API_KEY"
echo "  - REPLICATE_API_TOKEN"

# 2. Ensure backend is running
npm run server &

# 3. Wait for backend to start (5 seconds)
sleep 5
```

## Running Tests

### Run All Tests (One-time)

```bash
npm run test:api
```

### Run with Watch Mode (Re-run on file changes)

```bash
npm run test:api:watch
```

### Expected Output

```
======================================================================
🎬 AI CINE DIRECTOR — API INTEGRATION TEST SUITE
======================================================================

📋 Test 1: Missing Character Anchor Auto-Correction
ℹ️  Auto-generated anchor: "A heroic figure standing confidently in a dramatic..."
ℹ️  Generated 5 scenes
✅ Test 1: Missing Character Anchor Auto-Correction
   → Auto-correction working. Generated anchor: "A heroic figure standing co..."

📋 Test 2: Insufficient Credits Guard (1 credit short)
ℹ️  User balance set to: 0 (storyboard costs 1)
ℹ️  Backend correctly rejected: INSUFFICIENT_CREDITS
ℹ️  Error code: INSUFFICIENT_CREDITS
✅ Test 2: Insufficient Credits Guard (1 credit short)
   → Correctly returned 402. Code: INSUFFICIENT_CREDITS

📋 Test 3: Character Consistency Keywords Enforcement
ℹ️  Character anchor: "A brave warrior wearing a red ski suit..."
ℹ️  Expected keywords: red, ski suit, golden armor, snowboard, black, spiky hair

  📊 Scene Consistency Analysis:
  Scene 1:
    ├─ Anchor Prefix: ✅
    ├─ Keywords Found: 5/6 (red, ski suit, golden armor, snowboard, black, spiky hair)
    ├─ Backend Metadata: ✅
    ├─ Prefix Check Passed: ✅
    └─ Keyword Coverage: 83%

✅ Test 3: Character Consistency Keywords Enforcement
   → Anchor: ✅, Metadata: ✅, Keyword Coverage: 83%

======================================================================
📊 TEST RESULTS
======================================================================

1. ✅ Test 1: Missing Character Anchor Auto-Correction
   → Auto-correction working. Generated anchor: "A heroic figure standing co..."

2. ✅ Test 2: Insufficient Credits Guard (1 credit short)
   → Correctly returned 402. Code: INSUFFICIENT_CREDITS

3. ✅ Test 3: Character Consistency Keywords Enforcement
   → Anchor: ✅, Metadata: ✅, Keyword Coverage: 83%

4. ✅ Test 4: Image Prompt Consistency (Bonus)
   → All image prompts properly formatted: ✅

======================================================================
SUMMARY: 4/4 tests passed (100%)
======================================================================
```

## Test Details

### Test 1: Missing Character Anchor

**What it does:**
- Creates a test user with 1000 credits
- Calls `/api/gemini/generate` WITHOUT providing `identityAnchor`
- Backend should auto-generate a default anchor
- Verifies response includes `character_anchor` field

**Expected behavior:**
- ✅ Response status: 200
- ✅ `project.character_anchor` is populated (not empty)
- ✅ All scenes are generated (`project.scenes.length > 0`)

**If it fails:**
- 🔴 Check Gemini API quota in `.env.local`
- 🔴 Verify backend is running and responding
- 🔴 Check server logs for errors

---

### Test 2: Insufficient Credits Guard

**What it does:**
- Creates a test user
- Resets their balance to 0 (below the 1 credit required)
- Attempts to generate a storyboard
- Backend should reject with 402 Insufficient Credits

**Expected behavior:**
- ✅ Response status: 402 (Payment Required)
- ✅ Response includes `error: "Insufficient credits"`
- ✅ Response includes `code: "INSUFFICIENT_CREDITS"`
- ✅ User balance remains 0 (no deduction occurred)

**If it fails:**
- 🔴 Backend credit check not returning 402
- 🔴 Check `server/routes/gemini.ts` `reserve_credits()` logic
- 🔴 Verify `ledger_v1.sql` RPC functions are deployed

---

### Test 3: Character Consistency Keywords

**What it does:**
- Creates test user with 1000 credits
- Provides explicit character anchor with keywords: `red ski suit`, `golden armor`, `snowboard`, `black`, `spiky hair`
- Generates storyboard
- Analyzes first 3 scenes for:
  - Anchor prefix enforcement
  - Keyword presence
  - Backend consistency metadata

**Expected behavior:**
- ✅ All scenes start with anchor text
- ✅ Backend metadata exists (`_consistency_check`)
- ✅ `has_anchor_prefix` is true
- ✅ Keyword coverage ≥ 70%
- ✅ Sample output shows keywords in descriptions

**If it fails:**
- ⚠️ Less than 70% keyword coverage: LLM not including all keywords
- 🔴 No `_consistency_check` metadata: Backend validation not running
- 🔴 `has_anchor_prefix` is false: Backend not prepending anchor

**Fix if needed:**
```typescript
// In server/routes/gemini.ts
// Ensure enforceAnchorConsistency() is called on ALL scenes
project = validateStoryboardConsistency(project, project.character_anchor, anchorKeywords);
```

---

### Test 4: Image Prompt Consistency (Bonus)

**What it does:**
- Creates test user
- Generates storyboard with cyberpunk character anchor
- Checks that `image_prompt` field is populated
- Verifies `image_prompt` includes anchor + visual_description

**Expected behavior:**
- ✅ `image_prompt` field exists
- ✅ Length > 50 characters
- ✅ Contains anchor reference
- ✅ Contains visual description keywords

**If it fails:**
- 🟡 This is a bonus test; failure doesn't block deployment
- Check `server/routes/gemini.ts` where `image_prompt` is generated

---

## Debugging

### Check Backend Health

```bash
curl http://localhost:3002/api/health
# Should return:
# {
#   "status": "ok",
#   "geminiKey": "✅ configured",
#   "replicateToken": "✅ configured"
# }
```

### View Backend Logs

```bash
# In another terminal
tail -f server/logs.txt

# Or watch for specific patterns
grep "Anchor Enforcement" server/logs.txt
grep "reserve_credits" server/logs.txt
```

### Test in Browser Console

```javascript
// After logging in, test credit guard directly
const { addToast, hasEnoughCredits } = useAppContext();

// Should return false and show toast if balance < 1
hasEnoughCredits(1);

// Check actual balance
userState.balance
```

### Query Test Users

```bash
# Find test users created during tests
supabase query "SELECT id, email, credits FROM profiles WHERE email LIKE 'test-%@example.com' ORDER BY created_at DESC"

# View ledger for specific user
supabase query "SELECT * FROM credits_ledger WHERE user_id = '<user-id>' ORDER BY created_at DESC LIMIT 10"
```

---

## Common Issues

### "Backend not reachable at http://localhost:3002"

```bash
# Make sure backend is running
npm run server

# Check if port 3002 is in use
lsof -i :3002
```

### "Missing Supabase env vars"

```bash
# Verify .env.local has:
cat .env.local | grep SUPABASE
cat .env.local | grep SERVICE_ROLE

# If missing, get them from Supabase dashboard
```

### "Test 3 shows low keyword coverage (<70%)"

This might mean:
1. Gemini API is being rate-limited (quota issue)
2. LLM is not following the enhanced system prompt
3. Character anchor not being passed correctly

**Fix:**
```bash
# Restart backend to refresh Gemini client
npm run server

# Check backend logs for "Anchor Enforcement" messages
# If none appear, the enforceAnchorConsistency() function isn't being called
```

### "Test 2 returns 200 instead of 402"

This means the credit guard is not working. Check:

```typescript
// In server/routes/gemini.ts
const { data: reserved, error: reserveErr } = await supabaseUserClient.rpc('reserve_credits', {
  amount: COST,
  ref_type: 'gemini',
  ref_id: jobRef
});

if (!reserved) {
  return res.status(402).json({ error: "Insufficient credits" }); // ← Must be here
}
```

---

## Next Steps

After all tests pass:

1. ✅ Commit test file to git
2. ✅ Add `npm run test:api` to pre-deployment checks
3. ✅ Run `npm run stress-test` for concurrent load testing
4. ✅ Deploy with confidence!

