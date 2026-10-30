import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';
import type { ObservedEvent } from '../game/events';

const require = createRequire(import.meta.url);

test('the chart shows recent battles, fades older ones, and removes future and expired markers', async () => {
  const output = await build({
    stdin: { contents: `import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { BeltMap } from './src/components/BeltMap';
      export function render(hour, events) { return renderToStaticMarkup(<BeltMap
        game={{ hour, rocks: [], fleets: [], events }} selected="" onSelect={() => {}}
        viewport={{ camera: { scale: 1, x: 0, y: 0 }, onChange() {} }}
      />); }`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, format: 'cjs', platform: 'node',
    alias: { 'react-native': 'react-native-web', 'react-native-svg': require.resolve('react-native-svg/src/elements.web.ts') },
    loader: { '.png': 'dataurl' }, resolveExtensions: ['.web.ts', '.web.tsx', '.web.js', '.ts', '.tsx', '.js', '.json'],
    plugins: [{ name: 'chart-clipboard', setup(builder) {
      builder.onResolve({ filter: /\/CopyObjectReference$/ }, () => ({ path: 'clipboard', namespace: 'chart-clipboard' }));
      builder.onLoad({ filter: /.*/, namespace: 'chart-clipboard' }, () => ({ contents: 'export const CopyObjectReference=()=>null;' }));
    } }],
  });
  const module = { exports: {} as { render: (hour: number, events: ObservedEvent[]) => string } };
  new Function('require', 'module', 'exports', output.outputFiles[0]!.text)(require, module, module.exports);
  const events = [{ hour: 2, message: 'Haulers fought.', battle: { x: 30, y: 40 } }];
  const render = (hour: number) => module.exports.render(hour, events);
  const recent = render(2);
  assert.match(recent, /Battle · just now/);
  assert.match(recent, /aria-label="Battle, just now"/);
  assert.match(recent, /id="battle-marker-0"/);
  assert.match(render(5), /Battle · 3h ago/);
  const opacity = (markup: string) => Number(markup.match(/<g\b(?=[^>]*id="battle-marker-0")[^>]*>/)?.[0].match(/opacity[=:]"?([\d.]+)/)?.[1]);
  assert.ok(opacity(render(5)) < opacity(recent));
  assert.doesNotMatch(render(1), /battle-marker-/);
  assert.doesNotMatch(render(8), /battle-marker-/);
  assert.doesNotMatch(module.exports.render(2, [{ hour: 2, message: 'Friendly transfer.' }]), /battle-marker-/);
});
