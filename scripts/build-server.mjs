/** Bundle the authoritative service with Node built-ins as its only runtime imports. */
import { builtinModules } from 'node:module';
import { build } from 'esbuild';
const result = await build({
  entryPoints: ['server/main.ts'], outfile: 'dist-server/main.mjs', bundle: true,
  platform: 'node', format: 'esm', target: 'node24', sourcemap: true, metafile: true,
});
for (const output of Object.values(result.metafile.outputs)) {
  for (const dependency of output.imports) {
    if (!dependency.path.startsWith('node:') && !builtinModules.includes(dependency.path)) throw new Error(`Unexpected runtime import: ${dependency.path}`);
  }
}
console.log(`Built standalone service from ${Object.keys(result.metafile.inputs).length} modules.`);
