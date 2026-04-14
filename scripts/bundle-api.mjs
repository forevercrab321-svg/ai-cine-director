/**
 * Pre-bundle api/index.ts for Vercel deployment.
 *
 * Why: @vercel/nft uses an acorn-based JS parser that cannot parse TypeScript
 * interface/type declarations. It fails to trace imports from api/index.ts,
 * so utility files (utils/, lib/) and npm packages are never included in the
 * Lambda bundle, causing FUNCTION_INVOCATION_FAILED on every request.
 *
 * Fix: bundle everything into a single CJS file (api/bundle.cjs) with esbuild
 * BEFORE Vercel deploys. nft then sees a plain JS file with no unresolved
 * imports — no tracing needed, no parse failure.
 */

import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

console.log('[bundle-api] Bundling api/index.ts → api/bundle.cjs ...');

await build({
    entryPoints: [resolve(root, 'api/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',                       // .cjs ignores "type":"module" — always CommonJS
    outfile: resolve(root, 'api/bundle.cjs'),
    // Keep ffmpeg external — it's a native binary, not a JS module
    external: ['@ffmpeg-installer/ffmpeg'],
    // Suppress warnings for dynamic require() inside handlers
    logLevel: 'warning',
    // Keep names for readable stack traces
    keepNames: true,
    // Minify only whitespace to keep logs readable
    minifyWhitespace: false,
    minifyIdentifiers: false,
    minifySyntax: false,
});

console.log('[bundle-api] ✅ api/bundle.cjs written successfully.');
