/**
 * Pre-bundle api/index.ts for Vercel deployment.
 *
 * Why: @vercel/nft uses an acorn-based JS parser that cannot parse TypeScript
 * interface/type declarations. It fails to trace imports from api/index.ts,
 * so utility files (utils/, lib/) and npm packages are never included in the
 * Lambda bundle, causing FUNCTION_INVOCATION_FAILED on every request.
 *
 * Fix: bundle everything into a single CJS file (api/bundle.js) with esbuild
 * BEFORE Vercel deploys. api/package.json sets {"type":"commonjs"} so Node
 * treats api/bundle.js as CJS. nft sees plain JS with no unresolved imports.
 */

import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

console.log('[bundle-api] Bundling api/index.ts → api/bundle.js ...');

await build({
    entryPoints: [resolve(root, 'api/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',   // api/package.json sets type:commonjs so .js = CJS
    outfile: resolve(root, 'api/bundle.js'),
    external: ['@ffmpeg-installer/ffmpeg'],
    logLevel: 'warning',
    keepNames: true,
    minifyWhitespace: false,
    minifyIdentifiers: false,
    minifySyntax: false,
});

console.log('[bundle-api] ✅ api/bundle.js written successfully.');
