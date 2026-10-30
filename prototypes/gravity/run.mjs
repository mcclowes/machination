// PROTOTYPE (#104): bundles the gravity sandbox and opens it. Run: node prototypes/gravity/run.mjs
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
await build({ entryPoints: [join(here, 'app.ts')], bundle: true, format: 'iife', outfile: join(here, 'dist', 'app.js'), logLevel: 'warning' });
const page = join(here, 'index.html');
console.log(`Gravity sandbox: file://${page}`);
if (!process.argv.includes('--no-open')) execFile('open', [page]);
