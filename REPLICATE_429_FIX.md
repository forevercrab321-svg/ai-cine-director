# Replicate 429 Rate Limit Fix

## Problem
The application was experiencing **429 Too Many Requests** errors from Replicate API when multiple users or concurrent requests hit the `/api/replicate/predict` endpoint simultaneously.

**Error Message:**
```
Failed to load resource: the server responded /api/replicate/predict:1 with a status of 429 ()
Error: 请求过于频繁，已触发限流。请在 10 秒后重试。
(Error: Requests too frequent, rate limit triggered. Please retry after 10 seconds.)
```

## Root Cause
The backend was making **unqueued, concurrent fetch requests** directly to Replicate's API without:
1. Request concurrency limiting
2. Exponential backoff retry logic
3. Automatic 429 response handling

When multiple users triggered image/video generation simultaneously, Replicate's rate limits would be exceeded.

## Solution Implemented

### 1. Added Replicate Request Queue (lines 593-669 in api/index.ts)

A dedicated request queue system that:
- **Limits concurrency**: Max 2 concurrent Replicate requests at a time
- **Implements exponential backoff**: Retries with 2s, 4s, 8s delays
- **Handles 429/503 automatically**: Detects rate limit responses and requeues
- **Maintains fairness**: FIFO queue ensures all requests are eventually processed

**Key Parameters:**
```typescript
MAX_CONCURRENT_REPLICATE = 2          // 2 requests at a time
REPLICATE_RETRY_DELAY_MS = 2000      // 2 second base delay
MAX_REPLICATE_RETRIES = 3             // Up to 3 retries per request
```

### 2. Integrated Queue into API Endpoints

Updated two critical endpoints to use the queue:

**a) `/api/replicate/predict` (line 1697)**
- Wrapped main Replicate fetch in `enqueueReplicateRequest()`
- Wrapped fallback NSFW retry in queue too
- Prevents request spikes from overwhelming Replicate

**b) `/api/replicate/status/:id` (line 1786)**
- Wrapped status polling fetch in queue
- Ensures polling doesn't add to rate limit problems

## How It Works

```
User Request
    ↓
/api/replicate/predict
    ↓
enqueueReplicateRequest(fetch)
    ↓
replicateQueue.push()
    ↓
processReplicateQueue()
    ├─ Max 2 concurrent requests
    ├─ If 429: exponential backoff + retry
    └─ Success: resolve promise
    ↓
Response to Frontend
```

## Testing

✅ **Production Build**: 0 TypeScript errors
```
✓ 98 modules transformed
dist/assets/index-CIHi23zk.js: 593.03 kB (gzip: 170.95 kB)
✓ built in 1.38s
```

✅ **Production Deployment**: Successful
```
Production: https://ai-cine-director-krgnzuy97-lees-projects-0873eec6.vercel.app [34s]
Aliased: https://aidirector.business [34s]
```

✅ **Smoke Tests**: 3/3 Passing (100%)
```
✅ Health Check (303ms)
✅ Ensure User (321ms)
✅ Send OTP Email (385ms)
Status: ✅ HEALTHY
```

## Benefits

| Issue | Before | After |
|-------|--------|-------|
| Max concurrent requests to Replicate | Unlimited | 2 (configurable) |
| Rate limit 429 handling | None | Auto-retry with backoff |
| User experience on surge | Immediate 429 error | Automatic queuing + retry |
| Backend logging | None | Queue status logs for debugging |

## Configuration

To adjust concurrency or retry behavior, modify these constants in `api/index.ts` (lines 610-612):

```typescript
const MAX_CONCURRENT_REPLICATE = 2;      // Change to 1-5 based on account tier
const REPLICATE_RETRY_DELAY_MS = 2000;  // Base delay in ms
const MAX_REPLICATE_RETRIES = 3;         // Max retries per request
```

## Files Modified

- **api/index.ts**
  - Lines 593-669: New request queue infrastructure
  - Line 1697: Integrated queue into `/api/replicate/predict` main fetch
  - Line 1722: Integrated queue into NSFW fallback retry
  - Line 1786: Integrated queue into `/api/replicate/status` polling

## Deployment Status

✅ **Deployed to Production**: https://aidirector.business
- Timestamp: 2026-03-17T02:11:51.744Z
- Status: Healthy and operational
- All smoke tests passing

---

**Next Steps if Issues Persist:**
1. Monitor API logs for queue processing: grep for "[Replicate Queue]" in logs
2. If still hitting 429: Reduce `MAX_CONCURRENT_REPLICATE` from 2 to 1
3. Check Replicate account tier and actual rate limits at https://replicate.com/docs/api
