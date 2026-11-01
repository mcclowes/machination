/** @format */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { measureReplayPacking } from './measure-replay-packing.mjs';

function timeline(sites) {
  const scene = (hour, rocks) => ({
    hour,
    rocks,
    rules: { mechanicsVersion: 19 },
    fleets: [],
    coverage: [],
  });
  return {
    kind: 'machination.observed-timeline',
    schemaVersion: 1,
    from: 0,
    through: 1,
    groups: [
      { hour: 0, states: sites.map((rock) => scene(0, [rock])) },
      { hour: 1, states: [scene(1, [sites[0]])] },
    ],
    spans: [{ from: 0, through: 1, scene: scene(0.5, [sites[0]]) }],
  };
}

test('measures exact repeated sites while retaining causal states and scene anchors', () => {
  const site = {
    id: 'a',
    name: 'Factory',
    x: 0.1,
    y: 32,
    drones: 5,
    shield: 10,
    specialists: [{ id: 'u', kind: 'king' }],
  };
  const replay = timeline(Array.from({ length: 100 }, () => structuredClone(site)));
  const before = structuredClone(replay);
  const result = measureReplayPacking(replay);
  assert.equal(result.uniqueSites, 1);
  assert.equal(result.uniqueRules, 1);
  assert.equal(result.states, 101);
  assert.equal(result.spans, 1);
  assert.ok(result.packed.records < result.original.records / 2);
  assert.ok(result.packed.bytes < result.original.bytes);
  assert.deepEqual(replay, before);
});

test('never merges neighboring binary64 coordinates, signed zeros, or changed disclosures', () => {
  const result = measureReplayPacking(
    timeline([
      { id: 'a', x: 0, known: false },
      { id: 'a', x: -0, known: false },
      { id: 'a', x: 0.1, known: false },
      { id: 'a', x: 0.10000000000000002, known: false },
      { id: 'a', x: 0, known: true, drones: 0 },
    ]),
  );
  assert.equal(result.uniqueSites, 5);
  assert.equal(result.exactRoundTrip, true);
});

test('ignores object key insertion order without conflating absent and null fields', () => {
  const result = measureReplayPacking(
    timeline([
      { id: 'a', x: 1 },
      { x: 1, id: 'a' },
      { id: 'a', x: 1, owner: null },
    ]),
  );
  assert.equal(result.uniqueSites, 2);
});

test('measures a real ten-seat pulse/gravity export without changing its causal timeline', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { fileURLToPath } = await import('node:url');
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `
    import { createConfiguredGame } from './src/game/world.ts';
    import { advance } from './src/game/simulation.ts';
    import { createArchive } from './src/game/replay.ts';
    import { generateSharedReplay } from './src/replay/generate.ts';
    import { measureReplayPacking } from './scripts/measure-replay-packing.mjs';
    const baseline = createConfiguredGame({ playerCount: 10, mode: 'pulse' }, 0, 2026);
    const game = advance(baseline, 8, { rivals: false });
    console.log(JSON.stringify(measureReplayPacking(generateSharedReplay({ game, archive: createArchive(baseline) }, 'you', 0, 8))));
  `,
    ],
    { cwd: fileURLToPath(new URL('../', import.meta.url)), timeout: 30000 },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.exactRoundTrip, true);
  assert.ok(result.states > result.groups);
  assert.ok(result.spans > 0);
  assert.equal(result.uniqueRules, 1);
  assert.ok(result.packed.records < result.original.records / 2);
});
