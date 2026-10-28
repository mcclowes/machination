import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_PLAYERS, type Faction } from './players';
import { generateWorld } from './generated-world';

// Independent metric keeps generator regressions visible even if shared geometry changes.
const torusDistance = (world: { width: number; height: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
  return Math.hypot(Math.min(dx, world.width - dx), Math.min(dy, world.height - dy));
};

for (const count of [2, 3, 4, 5, 6, 7, 8, 9, 10]) test(`${count} players have equal assets, spaced sites, and bounded charts`, () => {
  for (const seed of [0, 1, 73, 0xffffffff]) {
    const players = ALL_PLAYERS.slice(0, count);
    const world = generateWorld(players, seed);
    assert.equal(world.rocks.length, count * 10);
    assert.ok(Number.isFinite(world.width) && world.width > 0);
    assert.ok(Math.abs(world.width * world.height / world.rocks.length - 1000 / 3) < 1e-9);
    assert.equal(new Set(world.rocks.map(r => r.id)).size, count * 10);
    assert.equal(world.rocks[0]!.id, 'a');
    const assets = players.map(owner => {
      const owned = world.rocks.filter(r => r.owner === owner);
      assert.equal(owned.length, 5);
      assert.equal(owned.reduce((n, r) => n + r.drones, 0), 160);
      assert.deepEqual(owned.map(r => r.drones).sort((a, b) => a - b), [0, 40, 40, 40, 40]);
      const core = owned.filter(r => r.coreOf);
      assert.equal(core.length, 1);
      assert.equal(core[0]!.coreOf, owner);
      assert.deepEqual(core[0]!.specialists, [{ id: `core-${owner}`, owner, kind: 'queen' }]);
      return owned.map(r => [r.kind, r.shieldMax, Boolean(r.coreOf)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    });
    for (const asset of assets) assert.deepEqual(asset, assets[0]);
    for (const [index, r] of world.rocks.entries()) {
      assert.match(r.id, /^[a-zA-Z0-9:-]{1,80}$/);
      assert.ok(Number.isFinite(r.x) && r.x >= 0 && r.x < world.width);
      assert.ok(Number.isFinite(r.y) && r.y >= 0 && r.y < world.height);
      assert.ok(r.kind === 'factory' || r.kind === 'generator');
      assert.ok(r.shieldMax === 10 || r.shieldMax === 20);
      assert.equal(r.shield, 0);
      assert.equal(r.shieldsDisabled, false);
      assert.equal(r.shieldAt, 48 / (r.shieldMax + (r.coreOf ? 20 : 0)));
      assert.equal(r.productionAt, 8);
      assert.ok(Array.isArray(r.specialists));
      if (!r.owner) { assert.equal(r.drones, 0); assert.deepEqual(r.specialists, []); assert.equal(r.coreOf, undefined); }
      for (const other of world.rocks.slice(index + 1)) assert.ok(torusDistance(world, r, other) >= 5);
    }
    const expansion = players.map(() => 0);
    for (const neutral of world.rocks.filter(r => !r.owner)) {
      const distances = players.map(owner => Math.min(...world.rocks.filter(r => r.owner === owner).map(r => torusDistance(world, r, neutral))));
      const winner = distances.indexOf(Math.min(...distances));
      expansion[winner] = expansion[winner]! + 1;
    }
    assert.ok(Math.max(...expansion) - Math.min(...expansion) <= 4, `nearest-home expansion opportunity differs by at most four sites: ${expansion}`);
    const cores = world.rocks.filter(r => r.coreOf);
    for (const [i, core] of cores.entries()) for (const other of cores.slice(i + 1))
      assert.ok(torusDistance(world, core, other) >= 20);
    const ratio = world.rocks.filter(r => r.kind === 'generator').length / world.rocks.length;
    assert.ok(ratio >= 0.3 && ratio <= 0.6);
  }
});

test('seeds reproduce charts, vary geography and industry, and keep shields independent', () => {
  const players = ALL_PLAYERS.slice(0, 3);
  const worlds = Array.from({ length: 12 }, (_, seed) => generateWorld(players, seed));
  assert.deepEqual(generateWorld(players, 7), generateWorld([...players], 7));
  assert.equal(new Set(worlds.map(w => JSON.stringify(w.rocks.map(r => [r.x, r.y])))).size, 12);
  assert.ok(new Set(worlds.map(w => w.rocks.filter(r => r.kind === 'generator').length)).size > 1);
  assert.equal(new Set(worlds.flatMap(w => w.rocks.map(r => `${r.kind}:${r.shieldMax}`))).size, 4);
  const first = generateWorld(players, 7); first.rocks.find(r => r.coreOf === 'you')!.specialists!.length = 0;
  assert.equal(generateWorld(players, 7).rocks.find(r => r.coreOf === 'you')!.specialists!.length, 1);
});

test('rejects invalid participants and seeds', () => {
  for (const players of [[], ['you'], ['you', 'you'], [...ALL_PLAYERS, 'you'], ['you', 'invalid']])
    assert.throws(() => generateWorld(players as Faction[], 0));
  for (const seed of [-1, 0x100000000, 1.5, NaN, Infinity]) assert.throws(() => generateWorld(['you', 'vesper'], seed));
});

test('ten-player generation has a practical cost', () => {
  const start = performance.now();
  for (let seed = 0; seed < 5; seed++) generateWorld(ALL_PLAYERS, seed);
  assert.ok(performance.now() - start < 10000, 'five largest charts must finish within ten seconds');
});

test('arbitrary participating identities each receive one core without requiring legacy factions', () => {
  const players = Object.freeze(['zenith', 'echo'] as const);
  const { rocks } = generateWorld(players, 99);
  assert.equal(rocks.filter(r => r.coreOf === 'zenith').length, 1);
  assert.deepEqual([...new Set(rocks.flatMap(r => r.owner ? [r.owner] : []))].sort(), [...players].sort());
});

test('public site names and ordering do not label hidden cores or reserve a fixed host identifier', () => {
  const hostIds = new Set<string>();
  for (const seed of [1, 5, 8]) {
    const world = generateWorld(['you', 'zenith'], seed);
    hostIds.add(world.rocks.find(r => r.coreOf === 'you')!.id);
    assert.ok(world.rocks.every(r => /^Relay \d+$/.test(r.name)));
  }
  assert.ok(hostIds.size > 1);
});

test('boundary seeds populate every chart edge and allow cores outside the former interior', () => {
  const world = generateWorld(['you', 'vesper'], 1);
  assert.ok(world.rocks.some(r => r.x < 3));
  assert.ok(world.rocks.some(r => r.x > world.width - 3));
  assert.ok(world.rocks.some(r => r.y < 3));
  assert.ok(world.rocks.some(r => r.y > world.height - 3));
  for (const seed of [0, 0xffffffff]) {
    const chart = generateWorld(['you', 'vesper', 'zenith'], seed);
    assert.ok(chart.rocks.some(r => r.coreOf && (r.x < chart.width * 0.12 || r.x > chart.width * 0.88)));
    assert.deepEqual(Object.keys(chart).sort(), ['height', 'rocks', 'width']);
    assert.deepEqual(chart, generateWorld(['you', 'vesper', 'zenith'], seed));
  }
});
