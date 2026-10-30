import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

test('web chart positions coverage and routes above the space sky and below controls', async () => {
  const output = await build({
    stdin: { contents: `import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { BeltMap } from './src/components/BeltMap';
      const rocks = [
        { id: 'a', name: 'Alpha', x: 25, y: 30, kind: 'factory', owner: 'you', drones: 20 },
        { id: 'b', name: 'Beta', x: 75, y: 60, kind: 'generator', owner: null, drones: 0 },
      ];
      export const markup = renderToStaticMarkup(<BeltMap
        game={{ hour: 1, rocks, coverage: [{ x: 25, y: 30, radius: 20 }],
          fleets: [{ id: 1, owner: 'you', from: 'a', to: 'b', drones: 10, departed: 0, arrives: 4 }] }}
        selected="a" inspecting destination="b" onSelect={() => {}}
        viewport={{ camera: { scale: 1, x: 0, y: 0 }, onChange() {} }}
      />);`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, format: 'cjs', platform: 'node',
    alias: { 'react-native': 'react-native-web', 'react-native-svg': require.resolve('react-native-svg/src/elements.web.ts') },
    loader: { '.png': 'dataurl' }, resolveExtensions: ['.web.ts', '.web.tsx', '.web.js', '.ts', '.tsx', '.js', '.json'],
    plugins: [{ name: 'chart-clipboard', setup(builder) {
      builder.onResolve({ filter: /\/CopyObjectReference$/ }, () => ({ path: 'clipboard', namespace: 'chart-clipboard' }));
      builder.onLoad({ filter: /.*/, namespace: 'chart-clipboard' }, () => ({ contents: 'export const CopyObjectReference=()=>null;' }));
    } }],
  });
  const module = { exports: {} as { markup: string } };
  new Function('require', 'module', 'exports', output.outputFiles[0]!.text)(require, module, module.exports);
  const { markup } = module.exports;
  const svg = markup.match(/<svg\b[^>]*viewBox="[^"]*"[^>]*>[\s\S]*?<\/svg>/)?.[0];
  assert.ok(svg, 'The chart SVG is rendered with its viewport');
  assert.match(svg, /<circle\b/, 'Sensor coverage reaches the web renderer');
  assert.equal((svg.match(/<line\b/g) ?? []).length, 2, 'Flight and planned transfer routes reach the web renderer');
  assert.ok(markup.indexOf('data-testid="space-background"') < markup.indexOf(svg), 'The sky precedes the overlays');
  assert.ok(markup.indexOf(svg) < markup.indexOf('aria-label="Alpha,'), 'Site controls follow the overlays');
  assert.match(svg.split('>')[0]!, /style="[^"]*position:absolute/, 'The positioned sky must not paint over an unpositioned SVG');
});
