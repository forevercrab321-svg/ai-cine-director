// ─────────────────────────────────────────────────────────────────────────────
// api/bundle.cjs — AUTO-GENERATED during Vercel build
// ─────────────────────────────────────────────────────────────────────────────
// This file is a placeholder committed to the repo so that Vercel's function
// pattern validation succeeds at build-config-check time.
//
// During the Vercel build, the command:
//   node scripts/bundle-api.mjs
// overwrites this file with the real esbuild bundle of api/index.ts.
//
// If you see this response in production, the build command failed to run.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

module.exports = function handler(req, res) {
    res.status(503).json({
        error: 'Build bundle not generated',
        message: 'The build command (node scripts/bundle-api.mjs) did not overwrite this stub. Check Vercel build logs.',
    });
};
