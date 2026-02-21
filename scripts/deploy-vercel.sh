#!/usr/bin/env bash
# Deploy to Vercel non-interactively using a Vercel token.
# Usage:
#   export VERCEL_TOKEN=your_token_here
#   ./scripts/deploy-vercel.sh

set -euo pipefail

if [ -z "${VERCEL_TOKEN:-}" ]; then
  echo "ERROR: VERCEL_TOKEN is not set. Create a token at https://vercel.com/account/tokens and export it as VERCEL_TOKEN"
  exit 1
fi

echo "Linking project (non-interactive)..."
# Attempt to link; if already linked, this is harmless
npx vercel link --token "$VERCEL_TOKEN" --yes || true

echo "Deploying to production..."
npx vercel --prod --token "$VERCEL_TOKEN" --confirm

echo "Deploy complete. Check Vercel dashboard for logs and the production URL."
