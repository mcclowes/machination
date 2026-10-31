/** Pin released validators so compatibility checks also work in shallow CI checkouts. @format */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build, version as esbuildVersion } from 'esbuild';

const exec = promisify(execFile);
const commit = 'e93faf68e9696f3218538d642440c9df29ad8bee';
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = new URL('../server/fixtures/released-client/', import.meta.url);
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const sources = new Map();
const result = await build({
  stdin: {
    contents:
      "export {snapshotResponse,historicalResponse} from './src/contracts/snapshot'; export {decodeSharedReplay} from './src/replay/codec'; export {api as releasedApi, RejectedCommand as ReleasedRejectedCommand} from './src/online/network';",
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  minify: true,
  plugins: [
    {
      name: 'released-git-sources',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          if (!args.path.startsWith('.')) throw new Error('Released validators must be standalone.');
          const directory = args.importer === '<stdin>' ? '' : posix.dirname(args.importer);
          const path = posix.normalize(posix.join(directory, args.path)) + '.ts';
          if (!/^src\/(game|contracts|replay|online)\/[a-z0-9/-]+\.ts$/.test(path))
            throw new Error('Unexpected released validator dependency.');
          return { path, namespace: 'released' };
        });
        builder.onLoad({ filter: /.*/, namespace: 'released' }, async (args) => {
          const { stdout } = await exec('git', ['show', `${commit}:${args.path}`], {
            cwd: root,
            maxBuffer: 2_000_000,
          });
          sources.set(args.path, sha256(stdout));
          return { contents: stdout, loader: 'ts' };
        });
      },
    },
  ],
});
const code = `// Generated from TestFlight 0.1.0 (2), ${commit}. Do not edit.\n${result.outputFiles[0].text}`;
await mkdir(destination, { recursive: true });
await writeFile(new URL('build-2.mjs', destination), code);
await writeFile(
  new URL('build-2.json', destination),
  JSON.stringify(
    {
      release: '0.1.0 (2)',
      commit,
      esbuildVersion,
      sha256: sha256(code),
      sources: Object.fromEntries([...sources].sort(([a], [b]) => a.localeCompare(b))),
    },
    null,
    2,
  ) + '\n',
);
console.log(`Pinned ${sources.size} released source files in ${Buffer.byteLength(code)} bytes.`);
