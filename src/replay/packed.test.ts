import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfiguredGame } from '../game/world';
import { advance } from '../game/simulation';
import { createArchive, applyCommand } from '../game/replay';
import { observe } from '../game/visibility';
import { fleetPosition } from '../game/flight';
import { presentObservation, createReplayAliases } from './presentation';
import { generateSharedReplay } from './generate';
import { seekReplay, replayFleetPosition, nextReplayStep, previousReplayStep } from './playback';
import { decodeSharedReplay, encodeSharedReplay, inspectReplayData } from './codec';
import { packSharedReplay, encodePackedReplay, decodePackedReplay, seekPackedReplay } from './packed';

function fixture() {
  const baseline = createConfiguredGame({ playerCount: 10, mode: 'pulse' }, 0, 2026);
  return generateSharedReplay({ game: advance(baseline, 8, { rivals: false }), archive: createArchive(baseline) }, 'you', 0, 8);
}

test('schema 3 stays packed through decoding and preserves exact causal frames and interior seeking', () => {
  const legacy = fixture(), before = structuredClone(legacy);
  const packed = decodePackedReplay(encodePackedReplay(packSharedReplay(legacy)));
  assert.equal(packed.schemaVersion, 3);
  assert.ok(packed.siteDictionary.length > 0);
  assert.ok(packed.groups.every(g => g.states.every(s => s.rocks.every(Number.isSafeInteger))));
  assert.throws(() => decodeSharedReplay(encodePackedReplay(packed)));
  for (const group of legacy.groups) for (let ordinal = 0; ordinal < group.states.length; ordinal++)
    assert.deepEqual(seekPackedReplay(packed, group.hour, ordinal), seekReplay(legacy, group.hour, ordinal));
  for (const span of legacy.spans) for (const fraction of [0.25, 0.5, 0.75]) {
    const hour = span.from + fraction * (span.through - span.from);
    assert.deepEqual(seekPackedReplay(packed, hour), seekReplay(legacy, hour));
  }
  assert.deepEqual(legacy, before);
  assert.deepEqual(decodeSharedReplay(encodeSharedReplay(legacy)), legacy);
});

test('selected frames are detached from the dictionary and other seeks', () => {
  const packed = packSharedReplay(fixture());
  const before = structuredClone(packed);
  const first = seekPackedReplay(packed, 0);
  first.rocks[0]!.name = 'changed'; first.rules!.players.reverse();
  first.pulse!.kings[0]!.position.x = 999;
  assert.deepEqual(packed, before);
  assert.deepEqual(seekPackedReplay(packed, 0), seekReplay(fixture(), 0));
});

test('typed site references reject malformed indexes, unreachable nodes, and private fields', () => {
  const valid = packSharedReplay(fixture());
  const changes: ((value: any) => void)[] = [
    p => p.groups[0].states[0].rocks[0] = -1,
    p => p.groups[0].states[0].rocks[0] = 0.5,
    p => p.groups[0].states[0].rocks[0] = p.siteDictionary.length,
    p => p.groups[0].states[0].rocks[0] = '0',
    p => p.siteDictionary.push(structuredClone(p.siteDictionary[0])),
    p => p.siteDictionary[0].secret = 'private sentinel',
    p => p.groups[0].states[0].rules = p.rules,
    p => p.groups[0].states[0].rocks.push(p.groups[0].states[0].rocks[0]),
    p => p.geometryVersion = 2,
    p => p.rules.players = ['vesper', 'null'],
    p => p.groups[0].states[0].hour = 1,
    p => p.spans[0].through += 1,
  ];
  for (const change of changes) {
    const value = structuredClone(valid); change(value);
    const before = structuredClone(value);
    assert.throws(() => encodePackedReplay(value));
    assert.throws(() => decodePackedReplay(JSON.stringify(value)));
    assert.deepEqual(value, before);
  }
});

test('schema 3 wire preserves signed zero and adjacent binary64 disclosed values', () => {
  const legacy = fixture();
  const first = legacy.groups[0]!.states[0]!;
  const source = first.rocks.find(r => r.known)!;
  source.drones = -0;
  const second = structuredClone(first); second.rocks.find(r => r.id === source.id)!.drones = Number.MIN_VALUE;
  legacy.groups[0]!.states = [first, second];
  const packed = decodePackedReplay(encodePackedReplay(packSharedReplay(legacy)));
  assert.ok(Object.is(seekPackedReplay(packed, 0, 0).rocks.find(r => r.id === source.id)!.drones, -0));
  assert.equal(seekPackedReplay(packed, 0, 1).rocks.find(r => r.id === source.id)!.drones, Number.MIN_VALUE);
});

function repeatedFrame(unitCount: number, stateCount: number, references = 1): any {
  const rock = { id: 'a', name: 'Site', x: 0, y: 0, known: true, kind: 'core', owner: 'you', drones: 0,
    specialists: Array.from({ length: unitCount }, (_, i) => ({ id: `u${i + 1}`, kind: 'queen', owner: 'you' })) };
  const scene = { hour: 0, rocks: Array(references).fill(0), fleets: [], coverage: [], cargo: { you: 0 }, eliminated: [], winner: null };
  return { kind: 'machination.observed-timeline', schemaVersion: 3, geometryVersion: 1, presentationVersion: 1,
    history: 'canonical-events', perspective: 'you', from: 0, through: 0, siteDictionary: [rock],
    groups: [{ hour: 0, states: Array.from({ length: stateCount }, () => structuredClone(scene)) }], spans: [] };
}

test('separate budgets reject repeated expansion and oversized selected frames within the stored-node cap', () => {
  for (const replay of [repeatedFrame(20000, 101), repeatedFrame(50000, 1, 2)]) {
    // Both inputs fit the stored-data cap. Their expanded validation work or single frame does not.
    assert.ok(inspectReplayData(replay) < 250000);
    assert.throws(() => decodePackedReplay(JSON.stringify(replay)), /Invalid packed replay/);
    assert.throws(() => encodePackedReplay(replay), /Invalid packed replay/);
  }
});

test('encoder rejects hooks and cycles before any field is read or serialized', () => {
  let invoked = false;
  const replay = packSharedReplay(fixture());
  Object.defineProperty(replay.siteDictionary[0], 'name', { enumerable: true, get() { invoked = true; return 'unsafe'; } });
  assert.throws(() => encodePackedReplay(replay));
  assert.equal(invoked, false);
  const hooked = packSharedReplay(fixture());
  Object.defineProperty(hooked, 'toJSON', { value() { invoked = true; return {}; } });
  assert.throws(() => encodePackedReplay(hooked));
  assert.equal(invoked, false);
  const cycle: any = packSharedReplay(fixture()); cycle.siteDictionary[0].cycle = cycle;
  assert.throws(() => encodePackedReplay(cycle));
});

test('drifting charts and scenes without public rules retain their original geometry contract', () => {
  const baseline = createConfiguredGame({ playerCount: 2, mode: 'mining', driftingBases: true }, 0, 73);
  const legacy = generateSharedReplay({ game: advance(baseline, 1, { rivals: false }), archive: createArchive(baseline) }, 'you', 0, 1);
  const packed = decodePackedReplay(encodePackedReplay(packSharedReplay(legacy)));
  assert.equal(packed.geometryVersion, 2);
  for (const hour of [0, 0.25, 0.75, 1]) assert.deepEqual(seekPackedReplay(packed, hour), seekReplay(legacy, hour));
  const staticLegacy = fixture();
  for (const scene of [...staticLegacy.groups.flatMap(g => g.states), ...staticLegacy.spans.map(s => s.scene)]) { delete scene.rules; delete scene.pulse; }
  const withoutRules = decodePackedReplay(encodePackedReplay(packSharedReplay(staticLegacy)));
  assert.equal('rules' in withoutRules, false);
  assert.deepEqual(seekPackedReplay(withoutRules, 0), seekReplay(staticLegacy, 0));
});

test('packed curved-flight playback matches the authoritative observation and geometry', () => {
  const baseline = createConfiguredGame({ playerCount: 3, mode: 'pulse' }, 0, 2026);
  const owned = baseline.rocks.filter(r => r.owner === 'you');
  const source = owned.find(r => r.drones >= 5)!;
  const target = owned.find(r => r.id !== source.id)!;
  const dispatched = applyCommand(createArchive(baseline), { type: 'dispatch', owner: 'you', from: source.id, to: target.id, drones: 5 }, { rivals: false, knownThrough: 0 });
  const fleet = dispatched.game.fleets[0]!;
  assert.ok(fleet.route?.course?.length);
  const through = Math.min(fleet.arrives, 1);
  assert.ok(through > fleet.departed);
  const hour = fleet.departed + (through - fleet.departed) / 2;
  const operation = { game: advance(dispatched.game, through, { rivals: false }), archive: dispatched.archive };
  const legacy = generateSharedReplay(operation, 'you', 0, through);
  const packed = decodePackedReplay(encodePackedReplay(packSharedReplay(legacy)));
  const aliases = createReplayAliases();
  presentObservation(observe(baseline, 'you'), aliases);
  presentObservation(observe(dispatched.game, 'you'), aliases);
  const actual = advance(dispatched.game, hour, { rivals: false });
  const expected = presentObservation(observe(actual, 'you'), aliases);
  const playback = seekPackedReplay(packed, hour);
  assert.deepEqual(playback, expected);
  assert.deepEqual(replayFleetPosition(playback, playback.fleets[0]!), fleetPosition(actual, actual.fleets[0]!));
  for (const group of legacy.groups) for (let ordinal = 0; ordinal < group.states.length; ordinal++) {
    const position = { hour: group.hour, ordinal };
    assert.deepEqual(nextReplayStep(packed, position), nextReplayStep(legacy, position));
    assert.deepEqual(previousReplayStep(packed, position), previousReplayStep(legacy, position));
  }
});

test('a bounded repeated dictionary remains valid below the aggregate validation budget', () => {
  const packed = decodePackedReplay(encodePackedReplay(repeatedFrame(20000, 90)));
  assert.equal(packed.groups[0]!.states.length, 90);
  assert.equal(packed.siteDictionary.length, 1);
  assert.equal(seekPackedReplay(packed, 0, 89).rocks[0]!.specialists!.length, 20000);
});
