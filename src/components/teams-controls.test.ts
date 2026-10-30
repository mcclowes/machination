import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { GameOptions } from '../game/rules';
const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
const { create, act } = require('react-test-renderer');

test('team setup labels immutable seat groups, and teammate plans expose read-only review controls', async () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let renderer: any, queue: any;
  try {
    const output = await build({ stdin: { contents: `export { GameSetup } from './src/components/GameSetup'; export { ScheduledOrders } from './src/components/ScheduledOrders';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'team-hosts', setup(builder) {
      builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
      builder.onResolve({ filter: /^(react-native)$|\/PlayerIdentity$|\/LaunchReview$/ }, args => ({ path: args.path, namespace: 'team-host' }));
      builder.onLoad({ filter: /.*/, namespace: 'team-host' }, args => ({ contents: args.path === 'react-native' ? `export const View='View',Text='Text',Pressable='Pressable',ScrollView='ScrollView',StyleSheet={create:x=>x};` : args.path.endsWith('LaunchReview') ? `export const LaunchReview='LaunchReview';` : `export const PlayerPortraits={Provider:({children})=>children},PlayerIdentity='PlayerIdentity',PlayerAvatar='PlayerAvatar';` }));
    } }] });
    const ui = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`);
    let selected: GameOptions = { playerCount: 3, mode: 'pulse' };
    function Harness() { const [value, change] = React.useState(selected); selected = value; return React.createElement(ui.GameSetup, { value, onChange: change }); }
    await act(async () => { renderer = create(React.createElement(Harness)); });
    const control = (label: string) => renderer.root.findAll((n: any) => n.type === 'Pressable' && n.props.accessibilityLabel === label)[0];
    for (const [label, count] of [['Doubles (2v2)', 4], ['4v4', 8]] as const) {
      await act(async () => control(label).props.onPress()); assert.equal(selected.playerCount, count); assert.ok(selected.teamFormat); assert.equal(selected.mode, 'mining');
      assert.match(JSON.stringify(renderer.toJSON()), /fixed teams in join order/);
    }
    await act(async () => control('Individual game').props.onPress()); assert.equal(selected.teamFormat, undefined);
    await act(async () => control('4v4').props.onPress());
    await act(async () => control('3 players').props.onPress()); assert.equal(selected.teamFormat, undefined); assert.equal(selected.playerCount, 3);
    const plans = ['you', 'vesper'].map(owner => ({ id: 'same-plan-id-00001', owner, from: 'a', to: 'b', drones: 1, executeAt: 1 }));
    await act(async () => { queue = create(React.createElement(ui.ScheduledOrders, { owner: 'you', plans, hour: 0, rocks: [], disabled: false, onCancel() {}, onInspect() {}, onEdit() {}, units: [], preparation: true })); });
    const cancels = queue.root.findAll((n: any) => n.type === 'Pressable' && String(n.props.accessibilityLabel).startsWith('Cancel scheduled order:'));
    assert.equal(cancels.length, 2); assert.equal(cancels[0].props.disabled, false); assert.equal(cancels[1].props.disabled, true);
    const reviews = queue.root.findAll((n: any) => n.type === 'Pressable' && String(n.props.accessibilityLabel).startsWith('Inspect scheduled order:'));
    await act(async () => reviews[1].props.onPress());
    const review = queue.root.findByType('LaunchReview'); assert.equal(review.props.disabled, true); assert.equal(review.props.plan.owner, 'vesper');
  } finally {
    await act(async () => { renderer?.unmount(); queue?.unmount(); });
    if (prior) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', prior); else delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
});
