Deployment guide — GitHub & Vercel
=================================

Quick overview
- This repo is ready for deployment. The app uses a server (Express) that must run on Vercel serverless or a separate host. We use Vercel for frontend + serverless functions.
- Sensitive keys MUST be set in Vercel environment variables; do NOT commit them into the repo.

Files this guide will create/verify
- `.gitignore` — should already include `.env.local`, `.vercel`, and `node_modules`.

Steps to push your code to GitHub
1. Verify git remote:
   ```bash
   git remote -v
   ```
   If you see your GitHub repo (e.g. origin -> github.com/your-user/ai-cine-director.git) you're good.

2. Commit local changes and push to GitHub:
   ```bash
   git add .
   git commit -m "chore: prepare deploy settings"
   git push origin main
   ```

If you don't have a remote set you can create one with the GitHub CLI (or create repo on github.com):
   ```bash
   # using GitHub CLI (install: https://cli.github.com/)
   gh repo create your-username/ai-cine-director --public --source=. --remote=origin --push
   ```

Vercel deployment (recommended)
1. Create a new project in the Vercel dashboard and connect the GitHub repository, or use the Vercel CLI.

2. Set Environment Variables in Vercel (Project → Settings → Environment Variables). Add the following secrets (mark as Protected/Secret):
   - `SUPABASE_URL` = your Supabase Project URL
   - `SUPABASE_ANON_KEY` = your Supabase anon/public key
   - `SUPABASE_SERVICE_ROLE` = Supabase Service Role Key (secret!)
   - `GEMINI_API_KEY` = Google GenAI / Gemini API key
   - `REPLICATE_API_TOKEN` = Replicate API token
   - `STRIPE_SECRET_KEY` = Stripe secret key (if using payments)
   - `API_SERVER_PORT` (optional) = 3002 (not required on Vercel)

3. Deploy: push to `main` (or your production branch) and Vercel will trigger a build.

Useful Vercel CLI commands
```bash
# login once
npm i -g vercel
vercel login

# link local repo to Vercel project (interactive)
vercel link

# add env var via CLI (interactive)
vercel env add SUPABASE_URL production
vercel env add SUPABASE_ANON_KEY production
# for secret values you can also use --env or paste when prompted
``` 

Post-deploy checks
- Visit `https://<your-vercel-domain>/api/health` — expect JSON { status: 'ok', ... }
- Visit the frontend URL and run one generation to ensure serverless route and environment keys work.

Security & housekeeping
- Never commit `.env.local` or keys. Rotate `SUPABASE_SERVICE_ROLE` if it was ever pushed.
- For production, prefer storing only runtime secrets in Vercel and not in the repo.

If you want I can prepare a single commit with these changes (`DEPLOY.md`), then give you the exact commands to push and to set Vercel envs. Tell me when you're ready and whether you want me to run `git push` here (note: pushing requires your local Git to be authenticated to GitHub). 
