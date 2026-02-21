# AI Cine Director - Coding Agent Instructions

## Project Overview

**AI Cine Director** is a React + TypeScript web application that turns creative ideas into storyboards and cinematic videos using AI (Gemini, Replicate).

### Architecture: Frontend + Backend Proxy

- **Frontend**: React 19 + Vite (port 3000), running in browser
- **Backend**: Express server (port 3002), handles sensitive API keys (Gemini, Replicate, Stripe)
- **Database**: Supabase (PostgreSQL) for user auth, credits, project storage
- **Auth**: Supabase Auth (email/OAuth)
- **Credit System**: User purchases credits → deducted per generation (model-dependent costs)

### Critical Setup for Local Development

```bash
# Start BOTH frontend + backend simultaneously (required!)
npm run dev:all

# This runs: concurrently "npm run server" "npm run dev"
# Frontend: http://localhost:3000
# Backend: http://localhost:3002
```

**Without both services running, you'll see `[vite] http proxy error: /api/gemini/generate` errors.**

---

## Key Architectural Decisions

### 1. Backend Proxy Pattern (server/index.ts → Express)

**Why**: API keys (GEMINI_API_KEY, REPLICATE_API_TOKEN, STRIPE_SECRET) must NEVER be exposed in frontend code.

- Frontend calls `/api/gemini/generate` → proxied to Express server
- Express backend in `server/` validates JWT, deducts credits, calls external APIs
- Vite proxy rule in `vite.config.ts`:
  ```typescript
  proxy: {
    '/api': {
      target: 'http://localhost:3002',  // Point to Express server
      changeOrigin: true,
    }
  }
  ```

### 2. Credit System (AppContext + Supabase)

**Flow**: User authenticates → AppContext loads credit balance → Generate action checks balance → Backend deducts credits → Frontend syncs new balance.

- `context/AppContext.tsx`: Manages `userState.credits`, `hasEnoughCredits()`, `deductCredits()`
- Models have costs: e.g., `MODEL_COSTS['flux'] = 1 credit` (see `types.ts`)
- Backend validates deduction via JWT header + Supabase RLS

### 3. Data Flow: Generation → Storyboard → Video

1. User enters story idea + style → Frontend calls `/api/gemini/generate`
2. Backend calls Gemini API with structured schema → Returns `StoryboardProject` (scenes array)
3. Frontend displays scenes in `SceneCard` components
4. User can generate video per scene → `/api/replicate/generate` → Video URLs stored in Supabase

**Key Files**:
- `services/geminiService.ts`: Frontend proxy layer (no API keys)
- `server/routes/gemini.ts`: Backend logic with credit checks
- `services/replicateService.ts`: Video generation proxy
- `components/VideoGenerator.tsx`: UI for generation + preview

---

## Code Patterns & Conventions

### Auth & Headers

All backend routes expect:
```typescript
// In frontend service:
const { data: { session } } = await supabase.auth.getSession();
const token = session?.access_token;

// Pass as Bearer token:
headers: {
  'Authorization': token ? `Bearer ${token}` : ''
}

// Backend validates:
const authHeader = req.headers.authorization;
const token = authHeader?.split(' ')[1];
const user = await supabase.auth.admin.getUserById(userId); // Verify via JWT
```

### TypeScript Conventions

- Core types in `types.ts`: `Scene`, `StoryboardProject`, `ImageModel`, `VideoModel`
- Enums for constrained values: `VisualStyle`, `VideoModel`, `Language`
- Backend routes use `req.body` validation (no schema validation library, rely on TypeScript)

### Error Handling

Services throw errors which bubble to UI (try/catch in components). Specific patterns:
- Missing API keys → `/api/health` endpoint shows config status
- Credit insufficient → Return `false` from `deductCredits()`, don't throw
- API failures → Wrap in Error object with clear message (Gemini, Replicate errors)

### i18n

`i18n.ts` exports `t()` function for translations (English/Chinese). Components import:
```typescript
import { t } from '../i18n';
export const MyComponent = () => <p>{t('key')}</p>;
```

---

## Backend Implementation Patterns

### Express Routes (server/routes/)

1. **Route setup** (`server/index.ts`):
   ```typescript
   app.use('/api/gemini', geminiRouter);
   app.use('/api/replicate', replicateRouter);
   ```

2. **Credit deduction** (in route handler):
   ```typescript
   // After calling Gemini API:
   const creditCost = calculateCost(model);
   await deductCreditsInDB(userId, creditCost);
   ```

3. **Response format**:
   ```typescript
   res.json({ project_title, visual_style, scenes: [...] }); // StoryboardProject
   ```

### Gemini Integration (server/routes/gemini.ts)

Uses `@google/genai` SDK with structured output:
```typescript
const result = await ai.models.generateContent({
  model: 'gemini-2.0-flash',
  generationConfig: { responseSchema },
  contents: [{ role: 'user', parts: [{ text: prompt }] }],
});
// Returns JSON matching responseSchema
```

### Replicate Integration (server/routes/replicate.ts)

Handles long-running video generation:
- Creates prediction → polls status → returns video URL
- Replicate costs are fetched from their API (dynamic pricing)

---

## Critical Files & What They Do

| File | Purpose |
|------|---------|
| `package.json` | Scripts: `dev:all` runs frontend + backend |
| `vite.config.ts` | Proxy `/api` → Express (port 3002) |
| `server/index.ts` | Express app setup, routes, health check |
| `context/AppContext.tsx` | Global state: credits, auth, settings |
| `services/geminiService.ts` | Frontend proxy calls (no keys) |
| `server/routes/gemini.ts` | Backend: validates JWT, calls Gemini, deducts credits |
| `types.ts` | Core domain types (Scene, StoryboardProject, enums) |
| `lib/supabaseClient.ts` | Supabase client config |
| `components/VideoGenerator.tsx` | Main UI: story input, generation, preview |

---

## Common Development Tasks

### Adding a new AI model (e.g., new video model)

1. Add to `VideoModel` enum in `types.ts`
2. Add cost in `types.ts` → `MODEL_COSTS`
3. Add handling in `server/routes/replicate.ts` (if Replicate-based)
4. Update UI dropdowns in `SettingsModal.tsx`

### Debugging Credit System

- Check `AppContext.deductCredits()` for local logic
- Check `server/routes/gemini.ts` for backend deduction
- Query `supabase.credits` table directly if balances don't sync
- Call `refreshBalance()` in AppContext to force sync from DB

### Running Production Locally

For Vercel Serverless testing (not typical local dev):
```bash
npx vercel dev  # Uses api/* functions, not server/index.ts
```

For normal dev, always use `npm run dev:all`.

---

## Environment Variables

Required in `.env.local`:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
GEMINI_API_KEY=...                    # Server-side only
REPLICATE_API_TOKEN=...               # Server-side only
STRIPE_SECRET_KEY=...                 # Server-side only
API_SERVER_PORT=3002                  # Express server port
NODE_ENV=development                  # For local dev
```

Frontend vars must start with `VITE_` to be exposed.

---

## Testing & Validation

- **Health check**: `curl http://localhost:3002/api/health` shows config status
- **Auth flow**: Use Supabase Auth dev emails (e.g., test@example.com)
- **Credit system**: AppContext logs deductions, check Supabase credits table
- **Gemini mocking**: Set `useMockMode: true` in AppSettings for development

---

## Notes for AI Agents

- **Never hardcode API keys** anywhere in frontend or public files
- **Always run `npm run dev:all`** during local development (not just `npm run dev`)
- **Credit checks are critical**: Both frontend (UX) and backend (security) validate balances
- **Vite proxy config** is essential: Update `vite.config.ts` if backend port changes
- **Supabase RLS** enforces auth on all tables; ensure JWT is passed in service calls
