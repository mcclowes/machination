import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createGame, dispatch } from '../game/simulation';
import { observe } from '../game/visibility';

const require = createRequire(import.meta.url);
const React = require('react');
const { create, act } = require('react-test-renderer');

test('the combat action opens an observation-based prediction and follows changed observations', async () => {
  const priorAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let renderer: any;
  try {
    const output = await build({ entryPoints: [new URL('./HaulerCombat.tsx', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'combat-host', setup(builder) {
      builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
      builder.onResolve({ filter: /^react-native$/ }, args => ({ path: args.path, namespace: 'native-host' }));
      builder.onLoad({ filter: /.*/, namespace: 'native-host' }, () => ({ contents: `export const View='View',Text='Text',Pressable='Pressable',StyleSheet={create:x=>x};` }));
      builder.onResolve({ filter: /\/PlayerIdentity$/ }, () => ({ path: 'roster', namespace: 'roster-host' }));
      builder.onLoad({ filter: /.*/, namespace: 'roster-host' }, () => ({ contents: `export const usePlayerRoster=()=>f=>({name:f});` }));
    } }] });
    const { HaulerCombat } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`);
    const game = createGame(0);
    for (const site of game.rocks) { site.productionAt = 1000; site.shieldAt = 1000; }
    Object.assign(game.rocks.find(r => r.id === 'b')!, { owner: 'vesper', drones: 46, shield: 3 });
    const view = observe(dispatch(game, 'c', 'b', 6, 'you'), 'you');
    const props = { observation: { view, faction: 'you', observedAt: 0 }, fleetId: 1 };
    await act(async () => { renderer = create(React.createElement(HaulerCombat, props)); });
    assert.equal(renderer.root.findAllByProps({ testID: 'combat-prediction' }).length, 0);
    const press = async (label: string) => act(async () => renderer.root.findAll((n: any) => n.type === 'Pressable' && n.props.accessibilityLabel === label)[0].props.onPress());
    await press('Combat prediction');
    assert.match(JSON.stringify(renderer.toJSON()), /43 drones survive/);
    const changed = structuredClone(view);
    const target = changed.rocks.find(r => r.id === 'b')!;
    if (!target.known) throw new Error('Fixture target must be observed');
    target.drones = 50;
    await act(async () => renderer.update(React.createElement(HaulerCombat, { ...props, observation: { ...props.observation, view: changed } })));
    assert.match(JSON.stringify(renderer.toJSON()), /47 drones survive/);
    assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /43 drones survive/);
    const disabled = structuredClone(changed);
    const disabledTarget = disabled.rocks.find(r => r.id === 'b')!;
    if (!disabledTarget.known) throw new Error('Fixture target must be observed');
    disabledTarget.shieldsDisabled = true;
    await act(async () => renderer.update(React.createElement(HaulerCombat, { ...props, observation: { ...props.observation, view: disabled } })));
    assert.match(JSON.stringify(renderer.toJSON()), /44 drones survive/);
    assert.match(JSON.stringify(renderer.toJSON()), /50 drones · shields disabled/);
    assert.match(JSON.stringify(renderer.toJSON()), /Shields disabled · no drones absorbed/);
    assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /\+ 3 shields|Shields absorb/);
    await press('Close combat prediction');
    assert.equal(renderer.root.findAllByProps({ testID: 'combat-prediction' }).length, 0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (priorAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', priorAct);
    else delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
});
