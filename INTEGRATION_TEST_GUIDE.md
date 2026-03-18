# 🎬 AI CINE DIRECTOR - INTEGRATION TEST & VERIFICATION GUIDE

## ✅ BUGS FIXED

### Summary: 6-7 Critical Character Consistency Bugs Fixed
- ✅ BUG #4: is_locked field added to Gemini schema
- ✅ BUG #6: negative_prompt field added to Gemini schema  
- ✅ BUG #2: characters tracking field added
- ✅ BUG #1: Character anchor embedding in video prompts
- ✅ BUG #5: Negative prompt handling with defaults
- ✅ BUG #2,#7: Shot image_prompt validation
- ✅ BUG #1: Story entities propagation logging

---

## 🧪 INTEGRATION TEST PLAN (20x Double-Check)

### TEST #1: Gemini Schema Validation
**Objective**: Verify Gemini returns all required fields for character consistency

```bash
# Check 1: Schema includes all fields
grep "is_locked: { type: Type.BOOLEAN }" api/index.ts
grep "negative_prompt: { type: Type.STRING }" api/index.ts
grep "characters: { type: Type.ARRAY" api/index.ts
# Expected: All three grep commands return matches
```

**Double-Check Iteration 1-3**: 
- ✅ Verified is_locked in schema line 2000
- ✅ Verified negative_prompt in schema line 2016
- ✅ Verified characters field in schema line 2041

---

### TEST #2: Character Anchor Embedding (CRITICAL)
**Objective**: Ensure character identity is embedded in EVERY video generation request

#### Step 1: Story Generation
```
POST /api/gemini/generate
Body: {
  "storyIdea": "A determined cat detective solving a mystery in Tokyo",
  "visualStyle": "noir cyberpunk",
  "identityAnchor": "A sleek black cat, detective coat, piercing yellow eyes, whiskers prominent",
  "sceneCount": 3
}
```

**Expected Response**:
```json
{
  "character_anchor": "A sleek black cat, detective coat, piercing yellow eyes, whiskers prominent",
  "story_entities": [
    {
      "type": "character",
      "name": "Detective Whiskers",
      "description": "A sleek black cat, detective coat, piercing yellow eyes, whiskers prominent",
      "is_locked": true  // ★ CRITICAL: Must have is_locked=true
    }
  ],
  "scenes": [...]
}
```

**Double-Check Iteration 1-5**: Verify:
- [ ] character_anchor exactly matches identityAnchor input
- [ ] story_entities[0].is_locked === true
- [ ] story_entities[0].description includes original anchor
- [ ] characterAnchor passed to frontend successfully
- [ ] No truncation or loss of anchor text

---

#### Step 2: Image Generation (Scene 1, Shot 1)
```
POST /api/replicate/generate-image
Body: {
  "prompt": "Detective Whiskers at night, Tokyo rooftop",
  "imageModel": "flux",
  "characterAnchor": "A sleek black cat, detective coat, piercing yellow eyes, whiskers prominent",
  "storyEntities": [{
    "type": "character",
    "name": "Detective Whiskers",
    "description": "A sleek black cat, detective coat, piercing yellow eyes, whiskers prominent",
    "is_locked": true
  }]
}
```

**Expected Behavior**:
- Image shows a CAT (not human)
- Cat has detective coat, yellow eyes, whiskers
- Consistent with anchor description

**Double-Check Iteration 1-5**: Verify:
- [ ] Output image shows CAT (not human, not morphed)
- [ ] Eyes are yellow as specified
- [ ] Detective outfit visible and matching
- [ ] No identity drift from anchor
- [ ] No human features replacing animal anatomy

---

#### Step 3: Video Generation (Scene 1, Shot 1→2)
```
POST /api/replicate/predict
Body: {
  "version": "hailuo_02_fast",
  "input": {
    "prompt": "Detective Whiskers investigates a mysterious artifact",
    "motion_prompt": "Camera slowly zooms in. Cat's head turns left 45 degrees.",
    "first_frame_image": "<base64_from_step2>"
  },
  "storyEntities": [{
    "type": "character",
    "name": "Detective Whiskers",
    "description": "A sleek black cat, detective coat, piercing yellow eyes, whiskers prominent",
    "is_locked": true
  }]
}
```

**Expected Behavior** (Per Bug Fix #1, #2, #3):
- Video motion_prompt is enhanced: `[CHARACTER: black cat detective whiskers ...] Camera slowly zooms...`
- Character identity lock directive injected
- Video output shows SAME CAT as image (no morphing)
- Cat performs exact motion described (head turn)

**Double-Check Iteration 1-5**: Verify:
- [ ] Video shows SAME CAT as image (face consistency)
- [ ] Cat hasn't aged, morphed, or changed species
- [ ] Motion matches video_prompt specification
- [ ] Eyes still yellow, coat still visible
- [ ] No identity drift between frames

---

### TEST #3: Species Fidelity (Non-Human Lock)
**Objective**: Ensure animal protagonists stay non-human throughout

#### Scenario: Dog Story
```
Story Idea: "A brave golden retriever saves a village from danger"
Expected: Dog stays dog in all scenes (never becomes human)
```

**Double-Check Iteration 1-3**:
- [ ] Gemini detects "dog" in story idea
- [ ] Story entities include: `"description": "A golden retriever, brave, loyal..."`
- [ ] All image prompts include "dog" or "retriever"
- [ ] All video prompts include "dog protagonist" anchor
- [ ] Final videos show dog throughout (no morphing to human)

---

### TEST #4: Multi-Scene Consistency Chain
**Objective**: Ensure character face/identity consistent across ALL scenes

#### Setup: 5-Scene Story
1. Scene 1: Introduction (rooftop)
2. Scene 2: Conflict (underground)
3. Scene 3: Escalation (street)
4. Scene 4: Climax (temple)
5. Scene 5: Resolution (dawn)

**Per Fix #2, #7**: Shot image_prompt strategy
- Scene N, Shot 1: `image_prompt` = FULL detailed description
- Scene N, Shot 2+: `image_prompt` = "" (empty string)

**Double-Check Iteration 1-3**:
- [ ] All 5 scenes generated successfully
- [ ] Scene 1 Shot 1 image shows "Detective Whiskers"
- [ ] Scene 2-5 Shot 1 images all show SAME FACE as Scene 1
- [ ] No aging, weight change, costume change
- [ ] Character identity remains locked across all 5 scenes

---

### TEST #5: Negative Prompt Enforcement (Per Fix #5)
**Objective**: Verify character consistency constraints in negative prompt

#### Check 1: Negative Prompt in Gemini Response
```typescript
// api/index.ts line ~2048
// Expected: parsedData.scenes[].negative_prompt contains identity protection
negative_prompt: "altered identity, different person, age change, morphing, identity drift"
```

**Double-Check Iteration 1-3**:
- [ ] Gemini returns negative_prompt field
- [ ] negative_prompt includes "altered identity" or equivalent
- [ ] negative_prompt passed to Replicate request
- [ ] Replicate API receives and applies negative prompt

---

### TEST #6: Director-Level Cinematography (Per Fix #6)
**Objective**: Verify Gemini prompts include cinematic excellence directives

#### Check 1: System Instruction Content
```typescript
// api/index.ts line ~2184
// Expected: Contains cinematographer personas and visual excellence pillars
- Spielberg's visual storytelling mastery
- Nolan's architectural complexity
- Villeneuve's vast immersive scale
- Park Chan-wook's visual poetry
- Kurosawa's compositional perfection
```

**Check 2: Cinema_Prompt Instruction Upgrade**
```
Verify prompts include:
- COMPOSITION MASTERY: rule of thirds, depth layering, leading lines
- LIGHTING LANGUAGE: chiaroscuro, color psychology, volumetric
- CAMERA PSYCHOLOGY: angle meaning, movement intention
- MOVEMENT POETRY: camera motion = narrative emotion
- COLOR ARCHITECTURE: unified chromatic language
- SCALE & BREATHING: cinematic space and breathing room
```

**Double-Check Iteration 1-3**:
- [ ] Gemini prompts mention composition/framing
- [ ] Lighting descriptions mention "cinematic", "chiaroscuro", "atmospheric"
- [ ] Camera movements described with cinematic intent
- [ ] Prompts include visual sophistication language
- [ ] Storyboard quality noticeably elevated vs. pre-fix

---

## 🎯 FULL END-TO-END TEST

### SCENARIO A: Animal Protagonist (Cat Detective)

```
INPUT:
- Story Idea: "Detective Whiskers solves the case of the stolen ruby"
- Visual Style: "noir cyberpunk with Asian aesthetics"
- Character Anchor: "A clever black cat with piercing yellow eyes, wearing a detective trench coat"
- Scenes: 3
```

**EXPECTED OUTPUT CHAIN**:

1. ✅ **Gemini Storyboard** (3 scenes, locked protagonist)
   - Scene 1: "Rooftop introduction - Detective Whiskers surveys the city"
   - Scene 2: "Underground hideout - Whiskers discovers a clue"
   - Scene 3: "Final confrontation - Whiskers solves the mystery"
   - character_anchor: "A clever black cat with piercing yellow eyes..."
   - story_entities[0].is_locked: true

2. ✅ **Image Generation** (Scene 1, Shot 1)
   - Output: Black CAT (not human) in detective coat
   - Eyes: Yellow, piercing gaze
   - Outfit: Professional trench coat, noir aesthetic
   - Quality: 8/10 (cinematic, well-composed)

3. ✅ **Video Generation** (Scene 1, Shot 1→2)
   - Protagonist: SAME CAT from image
   - Motion: "Camera tilts up slowly, revealing city skyline. Whiskers' ears perk up."
   - Identity: No drift, no morphing, same face
   - Duration: 3-4 seconds

4. ✅ **Scenes 2-3 Image Chain**
   - Scene 2 Shot 1: Whiskers in underground location (same face, yellow eyes)
   - Scene 3 Shot 1: Whiskers at final location (same face, no aging)
   - Consistency Score: 95%+

---

### SCENARIO B: Human Protagonist (Detective Drama)

```
INPUT:
- Story Idea: "A seasoned detective uncovers a conspiracy"
- Visual Style: "gritty noir realism"
- Character Anchor: "Male detective, 45 years old, weathered face, salt-and-pepper hair, sharp eyes"
- Scenes: 3
```

**EXPECTED OUTPUT CHAIN**:

1. ✅ **Gemini Storyboard**
   - character_anchor: "Male detective, 45 years old, weathered face..."
   - story_entities[0].is_locked: true

2. ✅ **Image Generation**
   - Male human, age ~45, weathered features
   - Salt-and-pepper hair visible
   - Sharp, intelligent eyes

3. ✅ **Video Generation Chain**
   - Scene 1-3: SAME FACE across all scenes
   - No aging (still 45 at Scene 3)
   - No morphing (same facial features)
   - Consistency Score: 95%+

---

## 📊 VALIDATION METRICS

### Metric 1: Character Identity Consistency
```
Scoring (per scene):
- 100%: Same face across all shots
- 80%: Minor variations, still recognizable
- 50%: Identity drifting noticeably
- 0%: Different person in final frames

Target: 90%+ across all 5 scenes
```

### Metric 2: Species Fidelity
```
Scoring (for non-human stories):
- 100%: Animal protagonists remain clearly non-human
- 50%: Species ambiguous (could be human or animal)
- 0%: Clear conversion to human

Target: 100% (zero species morphs)
```

### Metric 3: Cinemat ic Quality
```
Scoring (visual excellence):
- 10/10: Masterful composition, lighting, color
- 8/10: Professional, well-executed
- 6/10: Adequate, clear shots
- 4/10: Basic, uninspired
- 0/10: Poor quality

Target: 8+/10 (director-level quality)
```

### Metric 4: Prompt Chain Integrity
```
Scoring:
- 100%: Character anchor embedded in every prompt
- 75%: Anchor in most prompts, occasional gaps
- 50%: Anchor in some prompts
- 0%: No anchor embedding

Target: 100% (perfect chain)
```

---

## 🔧 REGRESSION TESTING

**After each fix deployment, verify:**

1. ✅ Old storyboards still generate correctly
2. ✅ Character consistency improved (not broken)
3. ✅ No new errors in API logs
4. ✅ Performance unaffected
5. ✅ Video generation speed unchanged

---

## 📝 ISSUE TRACKING

### Known Issues (Pre-Fix)
- ❌ Character faces differ between scenes
- ❌ Animals morph into humans
- ❌ Identity lacks consistency directives
- ❌ Negative prompt not used for character protection
- ❌ Cinematographic quality uninspired

### Fixed Issues (Post-Deploy)
- ✅ Character anchor embedded in video prompts
- ✅ story_entities with is_locked=true propagated
- ✅ Species anatomy enforced throughout
- ✅ Negative prompt includes identity protection
- ✅ Director-level cinematography directives added

---

## 🚀 DEPLOYMENT CHECKLIST

Before pushing to production:

- [ ] All 6-7 critical fixes verified in api/index.ts
- [ ] Integration tests passed (Scenario A & B)
- [ ] Character consistency improved (pre/post comparison)
- [ ] Regression tests passed (old flows still work)
- [ ] Performance tests passed (no slowdown)
- [ ] Error logging shows proper character lock tracing
- [ ] Negative prompt enforcement confirmed
- [ ] Director-level prompts confirmed in output

---

*Prepared by: Technical Implementation Team*  
*Status: Ready for Comprehensive Integration Testing*  
*Priority: CRITICAL - Production Quality Gate*
