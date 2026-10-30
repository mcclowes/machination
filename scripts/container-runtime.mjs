import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

/** Exercise the replay engine's actual numeric-runtime guard inside the packaged runtime. */
export async function verifyContainerRuntime(docker, container) {
  const result = await build({
    stdin: { contents: "import { requireNumericRuntime } from './src/replay/numeric-support'; requireNumericRuntime();", resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
    bundle: true, write: false, platform: 'node', format: 'cjs',
  });
  await docker('exec', container, 'node', '-e', result.outputFiles[0].text);
}
