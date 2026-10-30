import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createConfiguredGame } from '../game/world';
import { observe } from '../game/visibility';
import { commandPulse, type PulseAction } from '../game/pulse';
import { advance } from '../game/simulation';

const require = createRequire(import.meta.url), React = require('react'), { create, act } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
test('controls enable real charging and firing, show movement warnings, and remove a terminated wave from the map', async () => {
  const output = await build({
    stdin: { contents: "export { DisruptorControls } from './src/components/DisruptorControls'; export { PulseControls, PulseMoveWarning } from './src/components/PulseControls'; export { MapPulses } from './src/components/MapPulses';", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'pulse-hosts', setup(b) {
      b.onResolve({ filter: /^react(?:\/.*)?$/ }, a => ({ path: pathToFileURL(require.resolve(a.path)).href, external: true }));
      b.onResolve({ filter: /^react-native(?:-svg)?$|\/PlayerIdentity$/ }, a => ({ path: a.path, namespace: 'pulse-host' }));
      b.onLoad({ filter: /.*/, namespace: 'pulse-host' }, a => ({ contents: a.path === 'react-native'
        ? "export const View='View',Text='Text',Pressable='Pressable',TextInput='TextInput',StyleSheet={create:x=>x};"
        : a.path === 'react-native-svg' ? "export const G='g',Circle='circle',Text='text';"
        : "export const usePlayerRoster=()=>f=>({name:f,color:'#abc'});" }));
    } }],
  });
  const ui = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`);
  let game = createConfiguredGame({ playerCount: 2, mode: 'pulse' }, 0, 42), tree: any;
  let sequence = 0, enabled = true;
  const command = (action: PulseAction) => { game = commandPulse(game, 'you', { id: `pulse-ui-command-${++sequence}`, action }); };
  const content = () => {
    const view = observe(game, 'you');
    return React.createElement(React.Fragment, {}, React.createElement(ui.PulseControls, { game: view, owner: 'you', enabled, onCommand: command }), React.createElement(ui.PulseMoveWarning, { game: view, owner: 'you', units: [{ kind: 'queen' }] }), React.createElement(ui.MapPulses, { pulse: view.pulse, sx: 2, sy: 2 }), React.createElement(ui.DisruptorControls, { game: view, owner: 'you', site: game.rocks.find(r => r.coreOf === 'you')!.id, enabled, onCommand: (request: any) => { game = commandPulse(game, 'you', { id: `disruptor-ui-command-${++sequence}`, ...request }); } }));
  };
  const update = async () => { await act(async () => tree.update(content())); };
  try {
    await act(async () => { tree = create(content()); });
    const buttons = () => tree.root.findAllByType('Pressable');
    assert.equal(buttons()[0].props.disabled, true, 'insufficient material disables charging');
    game.cargo.you = 100; await update();
    assert.equal(buttons()[0].props.disabled, false);
    await act(async () => buttons()[0].props.onPress()); await update();
    assert.equal(game.cargo.you, 0);
    assert.ok(JSON.stringify(tree.toJSON()).includes('immediately when executed'));
    game = advance(game, 6, { rivals: false }); await update();
    enabled = false; await update();
    assert.ok(buttons().every((b: any) => b.props.disabled), 'read-only views disable pulse actions');
    enabled = true; await update();
    await act(async () => buttons()[0].props.onPress()); await update();
    assert.equal(game.pulse!.kings[0]!.state, 'firing');
    game = advance(game, 6.5, { rivals: false }); await update();
    assert.ok(tree.root.findAllByType('circle').some((c: any) => c.props.r === 8), 'the wave radius uses map scale');
    await act(async () => buttons()[0].props.onPress()); await update();
    assert.equal(tree.root.findAllByType('circle').length, 0, 'termination removes both origin and wave');
    game.cargo.you = 25;
    game.rocks.find(r => r.coreOf === 'you')!.specialists!.push({ id: 'ui-disruptor', kind: 'disruptor', owner: 'you' });
    await update();
    const chargeDisruptor = () => buttons().find((b: any) => b.props.accessibilityLabel === 'Charge Disruptor');
    enabled = false; await update(); assert.equal(chargeDisruptor().props.disabled, true);
    enabled = true; await update();
    await act(async () => tree.root.findByType('TextInput').props.onChangeText('26')); await update();
    assert.equal(chargeDisruptor().props.disabled, true, 'out-of-range material is refused');
    await act(async () => tree.root.findByType('TextInput').props.onChangeText('20')); await update();
    await act(async () => chargeDisruptor().props.onPress()); await update();
    assert.equal(game.cargo.you, 5);
    assert.ok(JSON.stringify(tree.toJSON()).includes('Movement cancels'));
    game = advance(game, 7, { rivals: false }); await update();
    assert.equal(game.pulse!.tactical!.waves.length, 1);
    const ring = tree.root.findAllByType('circle').find((c: any) => c.props.strokeWidth === 1);
    assert.ok(ring, 'tactical pulses use a thinner ring');
    assert.ok(ring.props.strokeOpacity <= 1);

  } finally { if (tree) await act(async () => tree.unmount()); }
});
