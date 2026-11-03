/** @format */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { observe } from '../game/visibility';
import { createGame } from '../game/simulation';
import type { ReplayArchive } from '../game/replay';
const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
const { create, act } = require('react-test-renderer');
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type Job = { ready: boolean; closed: boolean; failed?: boolean; hour: number };
async function harness() {
  const output = await build({
    stdin: {
      contents:
        "export { useInspectedView } from './src/solo/useInspectedView'; export { jobs } from '../game/replay';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    plugins: [
      {
        name: 'inspection-host',
        setup(builder) {
          builder.onResolve({ filter: /^react$/ }, () => ({
            path: require.resolve('react'),
            external: true,
          }));
          builder.onResolve({ filter: /^\.\.\/game\/(replay|visibility)$/ }, (args) => ({
            path: args.path,
            namespace: 'host',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({
            contents: `
        export const jobs = [];
        export function* replayToSteps(archive, hour) {
          const job = { hour, ready: false, closed: false }; jobs.push(job);
          try { while (!job.ready) yield; if(job.failed) throw new Error('Bad history'); return { hour }; }
          finally { job.closed = true; }
        }
        export function observe(game) { return game; }
        export function* forecastObservationSteps(view, faction, hour) { return {...view, hour}; }
      `,
          }));
        },
      },
    ],
  });
  const loaded = {
    exports: {} as {
      useInspectedView: typeof import('./useInspectedView').useInspectedView;
      jobs: Job[];
    },
  };
  new Function('require', 'module', 'exports', output.outputFiles[0]!.text)(
    require,
    loaded,
    loaded.exports,
  );
  const out: { current?: ReturnType<typeof loaded.exports.useInspectedView> } = {};
  const archive = {} as ReplayArchive,
    errors: string[] = [],
    onError = (message: string) => errors.push(message);
  const live = observe({ ...createGame(0), hour: 8 }, 'you');
  function Probe({ view, hour }: { view: typeof live; hour: number | null }) {
    out.current = loaded.exports.useInspectedView(archive, view, hour, true, onError);
    return null;
  }
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(React.createElement(Probe, { view: live, hour: 2 }));
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  return {
    out,
    errors,
    jobs: loaded.exports.jobs,
    update: (hour: number | null, view = live) =>
      act(async () => {
        renderer.update(React.createElement(Probe, { view, hour }));
      }),
    flush: () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }),
    unmount: () => act(async () => renderer.unmount()),
    live,
  };
}

test('a historical reconstruction survives clock-only updates and publishes only its requested hour', async () => {
  const h = await harness();
  try {
    assert.equal(h.jobs.length, 1);
    await h.update(2, { ...h.live, hour: 9 });
    assert.equal(h.jobs.length, 1);
    assert.equal(h.jobs[0]!.closed, false);
    h.jobs[0]!.ready = true;
    await h.flush();
    assert.equal(h.out.current!.shown.hour, 2);
    assert.equal(h.out.current!.inspecting, false);
  } finally {
    await h.unmount();
  }
});

test('changing the requested history closes stale work and never publishes its result', async () => {
  const h = await harness();
  try {
    await h.update(3);
    await h.flush();
    assert.equal(h.jobs[0]!.closed, true);
    assert.equal(h.jobs.length, 2);
    h.jobs[0]!.ready = true;
    h.jobs[1]!.ready = true;
    await h.flush();
    assert.equal(h.out.current!.shown.hour, 3);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.unmount();
  }
});

test('failed inspection reports the error and stops displaying a permanent busy state', async () => {
  const h = await harness();
  try {
    h.jobs[0]!.failed = true;
    h.jobs[0]!.ready = true;
    await h.flush();
    assert.equal(h.out.current!.inspecting, false);
    assert.equal(h.out.current!.failed, true);
    assert.deepEqual(h.errors, ['Bad history']);
    await h.update(null);
    assert.equal(h.out.current!.failed, false);
    assert.equal(h.out.current!.shown, h.live);
  } finally {
    await h.unmount();
  }
});
