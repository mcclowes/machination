import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

test('the web chart renders shield arcs around observed bases at every zoom', async () => {
  const output = await build({
    stdin: { contents: `import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { BeltMap } from './src/components/BeltMap';
      const base = { id: 'a', name: 'Alpha', x: 50, y: 50, kind: 'factory', owner: 'you', drones: 40, shield: 25, shieldMax: 40 };
      export function render(patch = {}, scale = 1) {
        return renderToStaticMarkup(<BeltMap game={{ hour: 1, rocks: [{ ...base, ...patch }], fleets: [] }}
          selected="a" inspecting onSelect={() => {}}
          viewport={{ camera: { scale, x: 0, y: 0 }, onChange() {} }} />);
      }`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, format: 'cjs', platform: 'node',
    alias: { 'react-native': 'react-native-web', 'react-native-svg': require.resolve('react-native-svg/src/elements.web.ts') },
    loader: { '.png': 'dataurl' }, resolveExtensions: ['.web.ts', '.web.tsx', '.web.js', '.ts', '.tsx', '.js', '.json'],
    plugins: [{ name: 'shield-clipboard', setup(builder) {
      builder.onResolve({ filter: /\/CopyObjectReference$/ }, () => ({ path: 'clipboard', namespace: 'shield-clipboard' }));
      builder.onLoad({ filter: /.*/, namespace: 'shield-clipboard' }, () => ({ contents: 'export const CopyObjectReference=()=>null;' }));
    } }],
  });
  const module = { exports: {} as { render: (patch?: object, scale?: number) => string } };
  new Function('require', 'module', 'exports', output.outputFiles[0]!.text)(require, module, module.exports);
  const { render } = module.exports;
  const arcs = (markup: string) => markup.match(/<path\b[^>]*stroke="#b6c3c5"[^>]*>/g) ?? [];
  assert.equal(arcs(render()).length, 3);
  assert.deepEqual(arcs(render({}, 4)), arcs(render()), 'Zoom keeps shield strokes and spacing readable');
  assert.equal(arcs(render({ shield: 40, coreOf: 'you' })).length, 4, 'Core shields use observed charge without adding the core bonus twice');
  for (const patch of [{ known: false }, { destroyed: true }, { shieldsDisabled: true }, { owner: null }, { shield: 0 }]) {
    assert.equal(arcs(render(patch)).length, 0);
  }
  assert.match(render(), /aria-label="Alpha,[^"]*shield charge 25/, 'The site remains an accessible selection control');
});
