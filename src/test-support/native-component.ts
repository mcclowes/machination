/**
 * Load real React components with only explicit platform adapters replaced for Node tests.
 *
 * @format
 */

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, type Plugin } from 'esbuild';

const require = createRequire(import.meta.url);
export async function nativeComponent<T>(
  entry: URL,
  modules: Record<string, string>,
  plugins: Plugin[] = [],
): Promise<T> {
  const output = await build({
    entryPoints: [fileURLToPath(entry.href)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      ...plugins,
      {
        name: 'explicit-native-host',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
            path: pathToFileURL(require.resolve(args.path)).href,
            external: true,
          }));
          builder.onResolve({ filter: /.*/ }, (args) =>
            Object.hasOwn(modules, args.path)
              ? { path: args.path, namespace: 'native-host' }
              : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: 'native-host' }, (args) => ({
            contents: modules[args.path]!,
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`
  ) as Promise<T>;
}
