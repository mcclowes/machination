import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import type { GameOptions } from '../game/rules';

const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
const { create, act } = require('react-test-renderer');

test('setup starts stationary and keeps drifting bases an explicit choice across other settings', async () => {
  const priorAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let renderer: any;
  try {
    const output = await build({
      stdin: { contents: `export { GameSetup } from './src/components/GameSetup'; export { DEFAULT_GAME_OPTIONS } from './src/game/rules'; export { createConfiguredGame } from './src/game/world';`, resolveDir: process.cwd(), loader: 'ts' },
      bundle: true, write: false, platform: 'node', format: 'esm',
      plugins: [{ name: 'setup-hosts', setup(builder) {
        builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
        builder.onResolve({ filter: /^(react-native)$|\/PlayerIdentity$/ }, args => ({ path: args.path, namespace: 'setup-host' }));
        builder.onLoad({ filter: /.*/, namespace: 'setup-host' }, args => ({ contents: args.path === 'react-native'
          ? `export const View='View',Text='Text',Pressable='Pressable',StyleSheet={create:x=>x};`
          : `export const PlayerPortraits={Provider:({children})=>children},PlayerIdentity='PlayerIdentity',PlayerAvatar='PlayerAvatar';` }));
      } }],
    });
    const setup = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`) as typeof import('./GameSetup') & typeof import('../game/rules') & typeof import('../game/world');
    let selected: GameOptions = setup.DEFAULT_GAME_OPTIONS;
    function Harness() {
      const [value, change] = React.useState(setup.DEFAULT_GAME_OPTIONS);
      selected = value;
      return React.createElement(setup.GameSetup, { value, onChange: change });
    }
    await act(async () => { renderer = create(React.createElement(Harness)); });
    const control = (label: string) => renderer.root.findAll((node: any) => node.type === 'Pressable' && node.props.accessibilityLabel === label)[0];
    const press = async (label: string) => {
      const node = control(label); assert.ok(node, label);
      await act(async () => { node.props.onPress(); });
    };
    const stationary = () => {
      const game = setup.createConfiguredGame(selected, 0, 7);
      assert.equal(game.rules!.mechanicsVersion, 11);
      assert.ok(game.rocks.every(rock => !rock.drift));
      assert.equal(control('Drifting asteroid bases').props.accessibilityState.checked, false);
    };
    const drifting = () => {
      const game = setup.createConfiguredGame(selected, 0, 7);
      assert.equal(game.rules!.mechanicsVersion, 11);
      assert.equal(game.rocks.filter(rock => rock.drift).length, selected.playerCount * 2);
      assert.ok(game.rocks.filter(rock => rock.owner).every(rock => !rock.drift));
      assert.equal(control('Drifting asteroid bases').props.accessibilityState.checked, true);
    };
    stationary();
    await press('Drifting asteroid bases'); drifting();
    await press('2 players');
    assert.equal(selected.playerCount, 2); drifting();
    await press('Domination');
    assert.equal(selected.mode, 'domination'); drifting();
    await press('Drifting asteroid bases'); stationary();
    assert.equal(selected.playerCount, 2);
    assert.equal(selected.mode, 'domination');
    assert.equal(setup.createConfiguredGame(setup.DEFAULT_GAME_OPTIONS, 0, 7).rocks.some(rock => rock.drift), false,
      'editing one setup must not change the defaults for the next setup');
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (priorAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', priorAct);
    else delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  }
});
