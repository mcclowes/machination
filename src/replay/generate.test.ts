import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame, type Game } from '../game/simulation';
import { createLegacyGame } from '../game/legacy';
import { createConfiguredGame } from '../game/world';
import { createArchive, applyCommand, exportArchive, executeCommand, restoreArchive, type ReplayEntry } from '../game/replay';
import { observe } from '../game/visibility';
import { presentObservation, createReplayAliases } from './presentation';
import { decodeSharedReplay, encodeSharedReplay } from './codec';
import { generateSharedReplay, SharedReplayCapacityError } from './generate';
import { readFile } from 'node:fs/promises';
import { decodeOperation } from '../game/operation-save';
import { seekReplay } from './playback';

function operation(game: Game, through: number) {
  return { game: advance(game, through, { rivals: false }), archive: createArchive(game) };
}
function at(replay: ReturnType<typeof generateSharedReplay>, hour: number) {
  const group = replay.groups.find(g => g.hour === hour);
  if (group) return group.states.at(-1)!;
  const span = replay.spans.find(s => s.from < hour && hour < s.through)!;
  return { ...span.scene, hour };
}
function crossing() {
  const game = createGame(0);
  for (const rock of game.rocks) Object.assign(rock, { x: rock.owner === 'you' ? 0 : 400, y: 0 });
  game.fleets = [{ id: 777, owner: 'vesper', from: 'e', to: 'f', drones: 5, departed: 0, arrives: 4, speed: 8,
    specialists: [], route: { from: { x: -17, y: 31.999 }, to: { x: 15, y: 31.999 } } }];
  game.nextId = 778;
  return game;
}

test('exports a brief observed contact between ordinary hour endpoints and preserves its motion law', () => {
  const op = operation(crossing(), 3);
  const before = structuredClone(op.game), archive = exportArchive(op.archive);
  const replay = decodeSharedReplay(encodeSharedReplay(generateSharedReplay(op, 'you', 2, 3)));
  assert.equal(at(replay, 2).fleets.length, 0);
  assert.equal(at(replay, 3).fleets.length, 0);
  assert.equal(at(replay, 2.125).fleets[0]!.drones, 5);
  assert.deepEqual(at(replay, 2.125).fleets[0]!.route, crossing().fleets[0]!.route);
  assert.equal(at(replay, 2.125).fleets[0]!.id, 1);
  assert.ok(replay.groups.some(g => g.hour > 2 && g.hour < 2.125));
  assert.deepEqual(op.game, before); assert.deepEqual(exportArchive(op.archive), archive);
});

test('portable generation does not depend on the diagnostic V8 runtime profile', () => {
  const descriptor = Object.getOwnPropertyDescriptor(process.versions, 'v8')!;
  try {
    Object.defineProperty(process.versions, 'v8', { ...descriptor, value: 'another-js-engine' });
    const replay = generateSharedReplay(operation(crossing(), 3), 'you', 2, 3);
    assert.equal(at(replay, 2.125).fleets.length, 1);
    assert.equal(at(replay, 2).fleets.length, 0);
  } finally { Object.defineProperty(process.versions, 'v8', descriptor); }
});

test('retains visible battle before and after states at the same fractional hour', () => {
  const game = crossing();
  game.fleets.push({ ...game.fleets[0]!, id: 778, owner: 'null', drones: 3, from: 'g', to: 'h',
    route: { from: { x: 17, y: 31.999 }, to: { x: -15, y: 31.999 } } });
  game.nextId = 779;
  const replay = generateSharedReplay(operation(game, 3), 'you', 2, 3);
  const group = replay.groups.find(g => g.states.some(s => s.fleets.length === 2) && g.states.some(s => s.fleets.length === 1));
  assert.ok(group);
  assert.equal(group.hour, 2.125);
  assert.equal(group.states.at(-1)!.fleets[0]!.drones, 2);
  assert.equal(at(replay, 2).fleets.length, 0); assert.equal(at(replay, 3).fleets.length, 0);
});

test('clip boundaries use one frozen canonical trace and permit a zero-duration observed frame', () => {
  const op = operation(crossing(), 3);
  const whole = generateSharedReplay(op, 'you', 0, 3);
  const clip = generateSharedReplay(op, 'you', 2.111, 2.139);
  for (const hour of [2.111, 2.125, 2.139]) assert.deepEqual(at(clip, hour), at(whole, hour));
  const still = generateSharedReplay(op, 'you', 2.125, 2.125);
  assert.equal(still.groups.length, 1); assert.equal(still.spans.length, 0);
  assert.deepEqual(still.groups[0]!.states.at(-1), at(whole, 2.125));
});

test('hidden queued commands and private prose introduce neither records nor identities', () => {
  const baseline = createGame(0);
  const clean = operation(baseline, 2);
  const privateBaseline = structuredClone(baseline);
  privateBaseline.events.push({ hour: 0, audience: ['vesper'], message: 'private sentinel' });
  const changed = applyCommand(createArchive(privateBaseline), { type: 'schedule', owner: 'vesper', plan: {
    id: 'secret-queue-sentinel', from: 'e', to: 'f', drones: 5, executeAt: 20,
  } }, { rivals: false, knownThrough: 0.371 });
  const dirty = { ...changed, game: advance(changed.game, 2, { rivals: false }) };
  assert.equal(encodeSharedReplay(generateSharedReplay(clean, 'you', 0, 2)), encodeSharedReplay(generateSharedReplay(dirty, 'you', 0, 2)));
});

test('configured worlds retain public portraits and observed preparation while stripping private fields', () => {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 83);
  const source = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const dest = game.rocks.find(r => r.owner === 'you' && r.id !== source.id)!;
  const op = applyCommand(createArchive(game), { type: 'dispatch', owner: 'you', from: source.id, to: dest.id, drones: 5 }, { rivals: false, knownThrough: 0 });
  const replay = generateSharedReplay(op, 'you', 0, 0);
  assert.ok(replay.groups[0]!.states.at(-1)!.fleets[0]!.preparing);
  const raw = encodeSharedReplay(replay);
  for (const key of ['scheduled', 'recruitment', 'seed', 'epoch', 'events', 'productionAt', 'lastContacts']) assert.ok(!raw.includes(`"${key}"`), key);
  const expected = presentObservation(observe(op.game, 'you'), createReplayAliases());
  assert.deepEqual(replay.groups[0]!.states.at(-1), expected);
});

test('bounds, unsupported continuous economy, and mismatched histories refuse without partial export', () => {
  const op = operation(createGame(0), 2);
  for (const [from, through] of [[-1, 1], [0, 3], [2, 1], [NaN, 1], [0, Infinity]]) assert.throws(() => generateSharedReplay(op, 'you', from!, through!));
  assert.throws(() => generateSharedReplay({ ...op, game: { ...op.game, cargo: { ...op.game.cargo, you: 900 } } }, 'you', 0, 2), /history/);
  assert.throws(() => generateSharedReplay(operation(createLegacyGame(0), 1), 'you', 0, 1), /continuous|version/i);
  assert.throws(() => generateSharedReplay(op, 'zenith', 0, 2), /perspective/i);
});

test('old planar and mine-loss archives preserve their stored observed frontier', async () => {
  for (const path of ['src/game/fixtures/planar-replay-aec9546.json', 'src/game/fixtures/mine-replays-e92b028.json']) {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    for (const fixture of Array.isArray(parsed) ? parsed : [parsed]) {
      const op = decodeOperation(JSON.stringify(fixture), fixture.savedAt);
      const baseline = exportArchive(op.archive).baseline.hour;
      const replay = decodeSharedReplay(encodeSharedReplay(generateSharedReplay(op, 'you', baseline, op.game.hour)));
      const end = seekReplay(replay, op.game.hour);
      const expected = presentObservation(observe(op.game, 'you'));
      // Export-local aliases depend on first appearance, while all observed attributes survive.
      const manifests = (scene: typeof end) => scene.fleets.map(({ id, specialists, ...fleet }) => ({ ...fleet, specialists: specialists?.map(({ id, ...unit }) => unit) }));
      assert.deepEqual(manifests(end), manifests(expected));
      const sites = (scene: typeof end) => scene.rocks.map(({ specialists, ...rock }) => ({ ...rock, ...(specialists ? { specialists: specialists.map(({ id, ...unit }) => unit) } : {}) }));
      assert.deepEqual(sites(end), sites(expected));
      assert.deepEqual(end.cargo, expected.cargo);
      assert.deepEqual(end.standings, expected.standings);
      assert.equal(end.winner, expected.winner);
    }
  }
});

test('capacity refusal leaves the authoritative operation and archive intact', () => {
  const baseline = createGame(0);
  const entries: ReplayEntry[] = Array.from({ length: 2_000 }, (_, i) => ({ hour: 0, command: { type: 'shields', owner: 'you', rock: 'a', disabled: i % 2 === 0 } }));
  const op = { game: entries.reduce((g, e) => executeCommand(g, e.command), baseline),
    archive: restoreArchive({ version: 1, rules: 1, baseline, entries, rivals: false }) };
  const before = structuredClone(op.game), archive = exportArchive(op.archive);
  assert.throws(() => generateSharedReplay(op, 'you', 0, 0), SharedReplayCapacityError);
  assert.deepEqual(op.game, before); assert.deepEqual(exportArchive(op.archive), archive);
});
