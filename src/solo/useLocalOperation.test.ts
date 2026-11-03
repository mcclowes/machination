/** @format */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { localLifecycle } from '../game/local-lifecycle';
import { createGame } from '../game/simulation';
import { createArchive } from '../game/replay';
import type { LocalOperation } from '../game/operation-save';
const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
const { create, act } = require('react-test-renderer');
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

async function harness(policy: ReturnType<typeof localLifecycle>) {
  const output = await build({
    stdin: {
      contents:
        "export { useLocalOperation } from './src/solo/useLocalOperation'; export { fire } from 'react-native';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    plugins: [
      {
        name: 'hook-host',
        setup(builder) {
          builder.onResolve({ filter: /^react$/ }, () => ({
            path: require.resolve('react'),
            external: true,
          }));
          builder.onResolve({ filter: /^react-native$/ }, () => ({
            path: 'native',
            namespace: 'host',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({
            contents: `const listeners = new Set(); export const fire = () => { for (const fn of listeners) fn('active'); }; export const AppState = { addEventListener: (_, fn) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; } };`,
          }));
        },
      },
    ],
  });
  const loaded = {
    exports: {} as {
      useLocalOperation: typeof import('./useLocalOperation').useLocalOperation;
      fire: () => void;
    },
  };
  new Function('require', 'module', 'exports', output.outputFiles[0]!.text)(
    require,
    loaded,
    loaded.exports,
  );
  const out: { current?: ReturnType<typeof loaded.exports.useLocalOperation> } = {};
  function Probe() {
    out.current = loaded.exports.useLocalOperation(policy, () => {});
    return null;
  }
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(React.createElement(Probe));
  });
  return { out, fire: loaded.exports.fire, unmount: () => act(async () => renderer.unmount()) };
}
function operation(): LocalOperation {
  const game = createGame(0);
  return { game, archive: createArchive(game, { rivals: true }) };
}

test('replacing an operation during restore never publishes or saves the old result', async () => {
  const initial = operation(),
    restored = operation(),
    replacement = operation();
  replacement.game.hour = 8;
  const writes: LocalOperation[] = [];
  let finish!: (value: LocalOperation) => void;
  const policy = localLifecycle({
    initial: () => initial,
    create: () => initial,
    load: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    save: async (value) => {
      writes.push(value);
    },
  });
  const h = await harness(policy);
  try {
    assert.equal(h.out.current!.busy, true);
    assert.equal(h.out.current!.ready, false);
    assert.deepEqual(writes, []);
    await act(async () => h.out.current!.replace(replacement));
    await act(async () => finish(restored));
    assert.equal(h.out.current!.operation, replacement);
    assert.equal(h.out.current!.ready, true);
    assert.deepEqual(writes, [replacement]);
  } finally {
    await h.unmount();
  }
});

test('clock catch-up includes time spent restoring and busy clock notifications never duplicate advancement', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const initial = operation();
  let finish!: (value: LocalOperation) => void;
  const targets: number[] = [];
  const writes: { hour: number; savedAt?: number }[] = [];
  const policy = localLifecycle({
    initial: () => initial,
    create: () => initial,
    load: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    save: async (value, savedAt) => {
      writes.push({ hour: value.game.hour, savedAt });
    },
  });
  policy.advanceSteps = function* (op, target) {
    targets.push(target);
    yield;
    return { ...op, game: { ...op.game, hour: target } };
  };
  const h = await harness(policy);
  try {
    context.mock.timers.tick(3_600_000);
    await act(async () => finish(initial));
    await act(async () => {
      h.fire();
      h.fire();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    assert.deepEqual(targets, [1]);
    assert.equal(h.out.current!.operation.game.hour, 1);
    assert.deepEqual(writes, [
      { hour: 0, savedAt: 1000 },
      { hour: 1, savedAt: 3_601_000 },
    ]);
    context.mock.timers.tick(3_600_000);
    await act(async () => {
      h.fire();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    assert.deepEqual(targets, [1, 2]);
  } finally {
    await h.unmount();
  }
});
