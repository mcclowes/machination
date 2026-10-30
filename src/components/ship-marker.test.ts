import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

test('ship markers show propulsion only in flight and keep counts outside the rotated hull', async () => {
  const output = await build({
    stdin: { contents: `import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { ShipMarker } from './src/components/ShipMarker';
      export const render = props => renderToStaticMarkup(<ShipMarker color="#73d6dc" drones={1234} heading={135} {...props} />);`,
      resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, format: 'cjs', platform: 'node',
    alias: { 'react-native': 'react-native-web', 'react-native-svg': require.resolve('react-native-svg/src/elements.web.ts') },
    resolveExtensions: ['.web.ts', '.web.tsx', '.web.js', '.ts', '.tsx', '.js', '.json'],
  });
  const module = { exports: {} as { render: (props: Record<string, unknown>) => string } };
  new Function('require', 'module', 'exports', output.outputFiles[0]!.text)(require, module, module.exports);
  const render = module.exports.render;
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
