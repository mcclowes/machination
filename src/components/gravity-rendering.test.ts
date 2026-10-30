import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
test('the real web chart renders public giants and the frozen ballistic path', async () => {
  const output = await build({
    stdin: { contents: `import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { BeltMap } from './src/components/BeltMap';
      import { gravityCourse } from './src/game/gravity';
      const rules = { mechanicsVersion: 19, map: { width: 100, height: 100, topology: 'torus' }, gravity: { wells: [{ id: 'giant-1', x: 50, y: 53, mass: 1, radius: 2 }] } };
      const rocks = [{ id: 'a', name: 'Alpha', x: 30, y: 50, kind: 'factory', owner: 'you', drones: 10 }, { id: 'b', name: 'Beta', x: 70, y: 50, kind: 'factory', owner: 'you', drones: 10 }];
      const course = gravityCourse({ rules }, rocks[0], rocks[1], 8, 12, 'you');
      const fleet = { id: 1, owner: 'you', from: 'a', to: 'b', drones: 1, departed: 12, ...course };
      export function render(enabled = true) {
        return renderToStaticMarkup(<BeltMap game={{ rules: enabled ? rules : { ...rules, gravity: undefined }, hour: (12 + course.arrives) / 2, rocks, fleets: [{ ...fleet, route: enabled ? fleet.route : { from: fleet.route.from, to: fleet.route.to } }] }}
          selected="" onSelect={() => {}} viewport={{ camera: { scale: 1, x: 0, y: 0 }, onChange() {} }} />);
      }`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, format: 'cjs', platform: 'node',
    alias: { 'react-native': 'react-native-web', 'react-native-svg': require.resolve('react-native-svg/src/elements.web.ts') },
    loader: { '.png': 'dataurl' }, resolveExtensions: ['.web.ts', '.web.tsx', '.web.js', '.ts', '.tsx', '.js', '.json'],
    plugins: [{ name: 'gravity-clipboard', setup(builder) {
      builder.onResolve({ filter: /\/CopyObjectReference$/ }, () => ({ path: 'clipboard', namespace: 'gravity-clipboard' }));
      builder.onLoad({ filter: /.*/, namespace: 'gravity-clipboard' }, () => ({ contents: 'export const CopyObjectReference=()=>null;' }));
    } }],
  });
  const module = { exports: {} as { render: (enabled?: boolean) => string } };
  new Function('require', 'module', 'exports', output.outputFiles[0]!.text)(require, module, module.exports);
  const markup = module.exports.render();
  assert.match(markup, /aria-label="Gravity giant giant-1"/);
  const path = markup.match(/<path\b[^>]*data-testid="gravity-flight-route"[^>]*>/)?.[0];
  assert.ok(path);
  assert.ok((path.match(/L /g) ?? []).length > 100);
  assert.doesNotMatch(module.exports.render(false), /gravity-body|gravity-flight-route/);
});
