import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { HOUR_MS } from '../game/retirement';

const require = createRequire(import.meta.url);
const React = require('react');
const { create, act } = require('react-test-renderer');

test('time away catches up in slices, holds saves until settled, and reports that it is catching up', async () => {
  const globals = globalThis as typeof globalThis & Record<string, any>;
  const previous = Object.getOwnPropertyDescriptor(globals, 'IS_REACT_ACT_ENVIRONMENT');
  const listeners = new Set<() => void>();
  globals.__localOperationHost = { subscribe: (_: string, callback: () => void) => { listeners.add(callback); return { remove: () => listeners.delete(callback) }; } };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  let renderer: any;
  try {
    const output = await build({
      stdin: { contents: `export {useLocalOperation} from './useLocalOperation';`, resolveDir: new URL('.', import.meta.url).pathname },
      bundle: true, write: false, format: 'esm', platform: 'node',
      plugins: [{ name: 'local-operation', setup(builder) {
        builder.onResolve({ filter: /^react$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
        builder.onResolve({ filter: /^react-native$/ }, args => ({ path: args.path, namespace: 'host' }));
        builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `export const AppState={addEventListener:globalThis.__localOperationHost.subscribe};` }));
      } }],
    });
    const { useLocalOperation } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}#${randomUUID()}`);
    const initial = { game: { hour: 0 } };
    const saved: number[] = [];
    const policy = {
      initial, automaticClock: true,
      load: async () => initial,
      save: async (operation: typeof initial) => { saved.push(operation.game.hour); },
      advance: (operation: typeof initial, hour: number) => ({ ...operation, game: { ...operation.game, hour } }),
    };
    let hook: any;
    const seen: boolean[] = [];
    const Host = () => { hook = useLocalOperation(policy, () => {}); seen.push(hook.catchingUp); return null; };
    await act(async () => { renderer = create(React.createElement(Host)); });
    assert.equal(hook.ready, true);
    const before = saved.length;

    now += 3 * HOUR_MS;
    await act(async () => { listeners.forEach(tick => tick()); });
    assert.equal(hook.catchingUp, true, 'Orders are held while time away is still being applied');
    assert.equal(saved.length, before, 'Intermediate slices are not saved');

    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.equal(hook.operation.game.hour, 3);
    assert.equal(hook.catchingUp, false);
    assert.deepEqual(saved.slice(before), [3], 'Only the settled state is saved');
    assert.ok(seen.includes(true));
  } finally {
    Date.now = realNow;
    if (renderer) await act(async () => renderer.unmount());
    delete globals.__localOperationHost;
    if (previous) Object.defineProperty(globals, 'IS_REACT_ACT_ENVIRONMENT', previous);
    else delete globals.IS_REACT_ACT_ENVIRONMENT;
  }
});
