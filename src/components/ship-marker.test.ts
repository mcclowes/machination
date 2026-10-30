import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

const loaded = build({
  stdin: { contents: `import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { ShipMarker } from './src/components/ShipMarker';
    import { BeltMap } from './src/components/BeltMap';
    export const render = props => renderToStaticMarkup(<ShipMarker color="#73d6dc" drones={1234} heading={135} {...props} />);
    export const chart = (fleet, rules, scale = 1) => renderToStaticMarkup(<BeltMap
      game={{ hour: 1, rules, rocks: [{ id: 'a', x: 10, y: 50, name: 'Alpha', kind: 'factory' }, { id: 'b', x: 90, y: 50, name: 'Beta', kind: 'mine' }],
        fleets: [{ id: 1, owner: 'you', from: 'a', to: 'b', drones: 12, departed: 0, arrives: 4, ...fleet }] }}
      selected="" onSelect={() => {}} viewport={{ camera: { scale, x: 0, y: 0 }, onChange() {} }} />);`,
    resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, format: 'cjs', platform: 'node',
  alias: { 'react-native': 'react-native-web', 'react-native-svg': require.resolve('react-native-svg/src/elements.web.ts') },
  loader: { '.png': 'dataurl' },
  resolveExtensions: ['.web.ts', '.web.tsx', '.web.js', '.ts', '.tsx', '.js', '.json'],
  plugins: [{ name: 'ship-clipboard', setup(builder) {
    builder.onResolve({ filter: /\/CopyObjectReference$/ }, () => ({ path: 'clipboard', namespace: 'ship-clipboard' }));
    builder.onLoad({ filter: /.*/, namespace: 'ship-clipboard' }, () => ({ contents: 'export const CopyObjectReference=()=>null;' }));
  } }],
}).then(output => {
  const module = { exports: {} as { render: (props: Record<string, unknown>) => string; chart: (fleet?: object, rules?: object, scale?: number) => string } };
  new Function('require', 'module', 'exports', output.outputFiles[0]!.text)(require, module, module.exports);
  return module.exports;
});

test('ship markers show propulsion only in flight and keep counts outside the rotated hull', async () => {
  const { render } = await loaded;
  const flying = render({});
  assert.match(flying, /rotate\(135 22 22\)/);
  assert.match(flying, /data-testid="ship-exhaust"/);
  assert.match(flying, /<\/svg>[\s\S]*1234/, 'The exact count stays upright outside the rotated SVG');
  assert.doesNotMatch(flying, /data-testid="ship-selection"/);
  assert.match(render({ selected: true }), /data-testid="ship-selection"/);
  const preparing = render({ preparing: true });
  assert.doesNotMatch(preparing, /data-testid="ship-exhaust"/);
  assert.match(preparing, /data-testid="ship-docked"/);
  const disabled = render({ enginesDisabled: true });
  assert.doesNotMatch(disabled, /data-testid="ship-exhaust"/);
  assert.match(disabled, /data-testid="ship-disabled"/);
  assert.match(render({ drones: 0 }), /<\/svg>[\s\S]*>0</, 'Specialist-only ships retain a visible count');
});

test('the chart points ships along wrapped, intercepted, and returning flight routes at every zoom', async () => {
  const { chart } = await loaded;
  const rules = { map: { width: 100, height: 100, topology: 'torus' } };
  assert.match(chart(), /rotate\(0 22 22\)/, 'A bounded route points toward the destination');
  assert.match(chart({}, rules), /rotate\(180 22 22\)/, 'A wrapped route takes the short course across the seam');
  const route = { from: { x: 50, y: 20 }, to: { x: 50, y: 80 } };
  for (const scale of [1, 4]) {
    assert.match(chart({ route, intercept: { target: 2, home: 'a' } }, rules, scale), /rotate\(90 22 22\)/, 'An interceptor faces its rendezvous');
    assert.match(chart({ route: { from: route.to, to: route.from }, returning: true }, rules, scale), /rotate\(-90 22 22\)/, 'A returning ship faces home');
  }
});
