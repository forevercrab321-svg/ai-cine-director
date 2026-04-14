#!/bin/bash
# deploy-check.sh — Run on your Mac before deploying to Vercel
# Usage: bash scripts/deploy-check.sh

set -e
cd "$(dirname "$0")/.."

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
PASS="${GREEN}PASS${NC}"; FAIL="${RED}FAIL${NC}"; WARN="${YELLOW}WARN${NC}"

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   AI Cine Director — Deployment Check${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""

# ── Load env ────────────────────────────────────────────────────────────────
if [ -f .env.local ]; then
  set -a; source .env.local; set +a
fi

ERRORS=0

check() {
  local label="$1"
  local result="$2"   # "pass" or "fail"
  local note="$3"
  if [ "$result" = "pass" ]; then
    echo -e "  [${PASS}] $label $note"
  else
    echo -e "  [${FAIL}] $label $note"
    ERRORS=$((ERRORS + 1))
  fi
}

warn() {
  echo -e "  [${WARN}] $1"
}

# ── Step 1: Required env vars ────────────────────────────────────────────────
echo -e "${YELLOW}Step 1: Required Environment Variables${NC}"
echo ""

[ -n "$VITE_SUPABASE_URL" ]          && check "VITE_SUPABASE_URL"          pass "$VITE_SUPABASE_URL" \
                                       || check "VITE_SUPABASE_URL"          fail "(missing)"
[ -n "$VITE_SUPABASE_ANON_KEY" ]     && check "VITE_SUPABASE_ANON_KEY"     pass "(set)" \
                                       || check "VITE_SUPABASE_ANON_KEY"     fail "(missing)"
[ -n "$SUPABASE_SERVICE_ROLE_KEY" ]  && check "SUPABASE_SERVICE_ROLE_KEY"  pass "(set)" \
                                       || check "SUPABASE_SERVICE_ROLE_KEY"  fail "(missing)"
[ -n "$GEMINI_API_KEY" ]             && check "GEMINI_API_KEY"             pass "(set)" \
                                       || check "GEMINI_API_KEY"             fail "(missing)"
[ -n "$REPLICATE_API_TOKEN" ]        && check "REPLICATE_API_TOKEN"        pass "(set)" \
                                       || check "REPLICATE_API_TOKEN"        fail "(missing)"
[ -n "$RESEND_API_KEY" ]             && check "RESEND_API_KEY"             pass "(set)" \
                                       || check "RESEND_API_KEY"             fail "(missing)"
[ -n "$STRIPE_SECRET_KEY" ]          && check "STRIPE_SECRET_KEY"          pass "(set)" \
                                       || check "STRIPE_SECRET_KEY"          fail "(missing)"
[ -n "$STRIPE_WEBHOOK_SECRET" ]      && check "STRIPE_WEBHOOK_SECRET"      pass "(set)" \
                                       || check "STRIPE_WEBHOOK_SECRET"      fail "(missing)"
[ -n "$VITE_APP_URL" ]               && check "VITE_APP_URL"               pass "$VITE_APP_URL" \
                                       || check "VITE_APP_URL"               fail "(missing — Stripe redirects broken)"

echo ""
# ── Step 2: TypeScript ───────────────────────────────────────────────────────
echo -e "${YELLOW}Step 2: TypeScript Check${NC}"
echo ""
if npx tsc --noEmit 2>/dev/null; then
  check "TypeScript" pass "(0 errors)"
else
  check "TypeScript" fail "(errors detected — run: npx tsc --noEmit)"
fi
echo ""

# ── Step 3: Migration status ─────────────────────────────────────────────────
echo -e "${YELLOW}Step 3: Database Migration${NC}"
echo ""
if npx tsx scripts/apply-migration.ts 2>/dev/null; then
  check "Migration" pass "(all columns verified)"
else
  check "Migration" fail "(run: npx tsx scripts/apply-migration.ts for instructions)"
fi
echo ""

# ── Step 4: Build ────────────────────────────────────────────────────────────
echo -e "${YELLOW}Step 4: Production Build${NC}"
echo ""
if npm run build 2>&1 | tail -5 | grep -q "built in\|dist/"; then
  check "npm run build" pass ""
else
  echo "  Running build (this may take 30s)..."
  if npm run build > /tmp/build.log 2>&1; then
    check "npm run build" pass ""
  else
    check "npm run build" fail "(see /tmp/build.log)"
    echo ""
    tail -20 /tmp/build.log
  fi
fi
echo ""

# ── Step 5: Vercel config ────────────────────────────────────────────────────
echo -e "${YELLOW}Step 5: Vercel Config${NC}"
echo ""
if [ -f vercel.json ]; then
  check "vercel.json" pass "(exists)"
  if grep -q "maxDuration" vercel.json; then
    check "maxDuration" pass "(set in vercel.json)"
  else
    warn "maxDuration not set — Gemini calls may timeout on Vercel"
  fi
else
  check "vercel.json" fail "(missing)"
fi

if command -v vercel &>/dev/null; then
  check "Vercel CLI" pass "$(vercel --version 2>/dev/null | head -1)"
else
  warn "Vercel CLI not installed — install with: npm i -g vercel"
fi
echo ""

# ── Result ───────────────────────────────────────────────────────────────────
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}✅  ALL CHECKS PASS — ready to deploy${NC}"
  echo ""
  echo "  Next step:"
  echo "    vercel --prod"
  echo ""
  echo "  Or push to git if CI/CD is configured."
else
  echo -e "${RED}❌  $ERRORS check(s) failed — fix above before deploying${NC}"
fi
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""

exit $ERRORS
