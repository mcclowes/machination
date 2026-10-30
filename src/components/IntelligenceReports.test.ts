import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createConfiguredGame } from '../game/world';
import { observe } from '../game/visibility';
import { setFunding } from '../game/funding';

const require = createRequire(import.meta.url);
const React = require('react');
const { create, act } = require('react-test-renderer');

test('ranked report switches columns and preserves live, scheduled, and read-only funding controls', async () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let tree: any;
  try {
    const output = await build({
      stdin: { contents: "export { IntelligenceReports } from './src/components/IntelligenceReports';", resolveDir: process.cwd(), loader: 'ts' },
      bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'report-hosts', setup(b) {
        b.onResolve({ filter: /^react(?:\/.*)?$/ }, a => ({ path: pathToFileURL(require.resolve(a.path)).href, external: true }));
        b.onResolve({ filter: /^react-native$|\/PlayerIdentity$/ }, a => ({ path: a.path, namespace: 'host' }));
        b.onLoad({ filter: /.*/, namespace: 'host' }, a => ({ contents: a.path === 'react-native'
          ? "export const View='View',Text='Text',Pressable='Pressable',StyleSheet={create:x=>x};"
          : "export const FactionEmblem='FactionEmblem',usePlayerRoster=()=>f=>({name:f,color:'#abcdef'});" }));
      } }],
    });
    const { IntelligenceReports } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`);
    let game = createConfiguredGame({ playerCount: 3, mode: 'mining' }, 0, 42);
    game.cargo = { you: 50, vesper: 10, null: 40 };
    let enabled = true, forecast = false, scheduledAt: number | undefined;
    const changes: unknown[] = [];
    const content = () => React.createElement(IntelligenceReports, { game: observe(game, 'you'), owner: 'you', enabled, forecast, scheduledAt,
      onChange(to: 'vesper', value: boolean) { changes.push([to, value]); if (scheduledAt === undefined) game = setFunding(game, 'you', to, value); } });
    await act(async () => { tree = create(content()); });
    const button = (label: string) => tree.root.findAll((n: any) => n.type === 'Pressable' && n.props.accessibilityLabel === label)[0];
    const update = async () => { await act(async () => tree.update(content())); };
    const rows = () => tree.root.findAll((n: any) => n.type === 'View' && String(n.props.testID).startsWith('intelligence-row-'));
    assert.deepEqual(rows().map((n: any) => n.props.testID), ['intelligence-row-you', 'intelligence-row-null', 'intelligence-row-vesper']);
    await act(async () => button('Sites').props.onPress());
    assert.equal(button('Sites').props.accessibilityState.selected, true);
    assert.match(JSON.stringify(tree.toJSON()), /mines/);
    await act(async () => button('Funding').props.onPress());
    assert.equal(button('Fund Vesper').props.disabled, false);
    assert.equal(button('Fund Null collective').props.disabled, true);
    await act(async () => button('Fund Vesper').props.onPress()); await update();
    assert.deepEqual(game.funding, [{ from: 'you', to: 'vesper' }]);
    assert.equal(button('Withdraw funding from Vesper').props.disabled, false);
    enabled = false; await update();
    assert.equal(button('Withdraw funding from Vesper').props.disabled, true);
    enabled = true; scheduledAt = 30; await update();
    const scheduled = tree.root.findAll((n: any) => n.type === 'Pressable' && /Schedule at .*Withdraw funding from Vesper/.test(n.props.accessibilityLabel))[0];
    assert.equal(scheduled.props.disabled, false);
    await act(async () => scheduled.props.onPress());
    assert.deepEqual(changes.at(-1), ['vesper', false]);
    assert.equal(game.funding!.length, 1, 'a scheduled callback does not apply the action live');
    game.winner = 'you'; scheduledAt = undefined; forecast = true; await update();
    assert.match(JSON.stringify(tree.toJSON()), /Projected winner/);
    assert.equal(button('Withdraw funding from Vesper').props.disabled, true, 'finished forecasts cannot fund');
  } finally {
    if (tree) await act(async () => tree.unmount());
    if (prior) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', prior); else delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
});
