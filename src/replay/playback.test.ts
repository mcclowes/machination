import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeSharedReplay, encodeSharedReplay } from './codec';
import { nextReplayStep, previousReplayStep, replayFleetPosition, seekReplay, type ReplayPosition } from './playback';
import type { ReplayScene } from './presentation';
import type { SharedReplay } from './timeline';

function scene(hour: number, cargo: number, visible = true): ReplayScene {
  return {
    hour, rocks: [
      { id: 'a', name: 'Alpha', x: 95, y: 75, known: true, kind: 'core', drones: 3, specialists: [{ id: 'u1', kind: 'queen', owner: 'you' }] },
      { id: 'b', name: 'Beta', x: 5, y: 5, known: false, kind: 'unknown' },
    ],
    fleets: visible ? [{ id: 1, owner: 'you', from: 'a', to: 'b', drones: 2, departed: 2, arrives: 6,
      route: { from: { x: 95, y: 75 }, to: { x: 105, y: 85 } }, specialists: [{ id: 'u2', kind: 'pirate', owner: 'you' }], intercept: { home: 'a' } }] : [],
    cargo: { you: cargo }, coverage: [{ x: 95, y: 75, radius: 10 }], eliminated: [], winner: null,
    standings: { you: { cargo, funders: 1 } },
    rules: { players: ['you', 'vesper'], mode: 'mining', victoryTarget: 200,
      map: { generator: 'balanced.v2', width: 100, height: 80, topology: 'torus' } },
  };
}
function file(): SharedReplay {
  const replay: SharedReplay = {
    kind: 'machination.observed-timeline', schemaVersion: 1, presentationVersion: 1, history: 'canonical-events', perspective: 'you', from: 2, through: 8,
    groups: [{ hour: 2, states: [scene(2, 0)] }, { hour: 4, states: [scene(4, 1), scene(4, 2, false), scene(4, 3)] }, { hour: 8, states: [scene(8, 4)] }],
    spans: [{ from: 2, through: 4, scene: scene(2, 10, false) }, { from: 4, through: 8, scene: scene(4, 20) }],
  };
  return decodeSharedReplay(encodeSharedReplay(replay));
}

test('decoded file seeks endpoints, clamps, and preserves same-hour causal order', () => {
  const replay = file();
  assert.deepEqual(seekReplay(replay, -100), replay.groups[0]!.states[0]);
  assert.deepEqual(seekReplay(replay, 100), replay.groups[2]!.states[0]);
  assert.equal(seekReplay(replay, 4).cargo.you, 3);
  for (let ordinal = 0; ordinal < 3; ordinal++) assert.equal(seekReplay(replay, 4, ordinal).cargo.you, ordinal + 1);
  assert.equal(seekReplay(replay, Number.MAX_VALUE).hour, 8);
});

test('open spans select their own membership and never bridge an invisible gap', () => {
  const replay = file();
  for (const hour of [2.000001, 3, 3.999999]) {
    const result = seekReplay(replay, hour);
    assert.equal(result.hour, hour); assert.equal(result.cargo.you, 10); assert.deepEqual(result.fleets, []);
  }
  for (const hour of [4.000001, 6, 7.999999]) {
    const result = seekReplay(replay, hour);
    assert.equal(result.hour, hour); assert.equal(result.cargo.you, 20); assert.equal(result.fleets.length, 1);
  }
  assert.equal(seekReplay(replay, 4, 1).fleets.length, 0);
});

test('every returned scene is deeply detached, including nested public metadata', () => {
  const replay = file(), before = encodeSharedReplay(replay);
  for (const hour of [2, 4, 5, 8]) {
    const result = seekReplay(replay, hour);
    result.rocks[0]!.specialists![0]!.id = 'changed'; result.fleets[0]!.route!.from.x = -123;
    result.fleets[0]!.specialists![0]!.id = 'changed'; result.fleets[0]!.intercept!.home = 'b';
    result.coverage[0]!.radius = 0; result.cargo.you = 999; result.standings!.you!.funders = 999;
    result.rules!.players.reverse(); result.rules!.map.width = 1; result.eliminated.push('you'); result.rocks.pop();
  }
  assert.equal(encodeSharedReplay(replay), before);
  assert.notEqual(seekReplay(replay, 4), seekReplay(replay, 4));
});

test('invalid hours and ordinals fail explicitly in seek and step helpers', () => {
  const replay = file();
  for (const hour of [NaN, Infinity, -Infinity]) {
    assert.throws(() => seekReplay(replay, hour), RangeError);
    assert.throws(() => nextReplayStep(replay, { hour }), RangeError);
    assert.throws(() => previousReplayStep(replay, { hour }), RangeError);
  }
  for (const [hour, ordinal] of [[4, -1], [4, 0.5], [4, 3], [4, NaN], [4, Infinity], [3, 0], [4, Number.MAX_SAFE_INTEGER + 1]] as const) {
    assert.throws(() => seekReplay(replay, hour, ordinal), RangeError);
    assert.throws(() => nextReplayStep(replay, { hour, ordinal }), RangeError);
    assert.throws(() => previousReplayStep(replay, { hour, ordinal }), RangeError);
  }
});

test('stepping visits each causal state in both directions and stops at bounds', () => {
  const replay = file();
  const expected = [{ hour: 2, ordinal: 0 }, { hour: 4, ordinal: 0 }, { hour: 4, ordinal: 1 }, { hour: 4, ordinal: 2 }, { hour: 8, ordinal: 0 }];
  const forward: ReplayPosition[] = [], backward: ReplayPosition[] = [];
  for (let at: ReplayPosition | null = expected[0]!; at; at = nextReplayStep(replay, at)) forward.push(at);
  for (let at: ReplayPosition | null = expected[4]!; at; at = previousReplayStep(replay, at)) backward.push(at);
  assert.deepEqual(forward, expected); assert.deepEqual(backward, [...expected].reverse());
  assert.deepEqual(previousReplayStep(replay, { hour: 4 }), expected[2]);
  assert.deepEqual(nextReplayStep(replay, { hour: 4 }), expected[4]);
  assert.deepEqual(previousReplayStep(replay, { hour: 3 }), expected[0]);
  assert.deepEqual(nextReplayStep(replay, { hour: 3 }), expected[1]);
  assert.equal(previousReplayStep(replay, { hour: -100 }), null);
  assert.equal(nextReplayStep(replay, { hour: 100 }), null);
  assert.deepEqual(nextReplayStep(replay, { hour: -100 }), expected[1]);
});

test('singleton files preserve terminal state and same-hour steps', () => {
  const replay = file(); replay.through = replay.from; replay.groups = [replay.groups[0]!]; replay.spans = [];
  let decoded = decodeSharedReplay(encodeSharedReplay(replay));
  assert.deepEqual(seekReplay(decoded, 99), replay.groups[0]!.states[0]);
  assert.equal(nextReplayStep(decoded, { hour: 2 }), null); assert.equal(previousReplayStep(decoded, { hour: 2 }), null);
  replay.groups[0]!.states.push(scene(2, 1)); decoded = decodeSharedReplay(encodeSharedReplay(replay));
  assert.equal(seekReplay(decoded, -1).cargo.you, 1);
  assert.deepEqual(nextReplayStep(decoded, { hour: 2, ordinal: 0 }), { hour: 2, ordinal: 1 });
  assert.deepEqual(previousReplayStep(decoded, { hour: 2 }), { hour: 2, ordinal: 0 });
});

test('fleet geometry uses disclosed routes, shortest fallback legs, and torus wrapping', () => {
  const replay = file(), before = encodeSharedReplay(replay);
  for (const [hour, point] of [[2, { x: 95, y: 75 }], [4, { x: 0, y: 0 }], [8, { x: 5, y: 5 }]] as const) {
    const s = seekReplay(replay, hour); assert.deepEqual(replayFleetPosition(s, s.fleets[0]!), point);
    delete s.fleets[0]!.route; assert.deepEqual(replayFleetPosition(s, s.fleets[0]!), point);
  }
  const s = seekReplay(replay, 4), fleet = s.fleets[0]!;
  fleet.route = { from: { x: -105, y: -85 }, to: { x: 305, y: 245 } };
  assert.deepEqual(replayFleetPosition(s, fleet), { x: 0, y: 0 });
  delete s.rules!.map.topology;
  assert.deepEqual(replayFleetPosition(s, fleet), { x: 100, y: 80 });
  delete fleet.route; assert.deepEqual(replayFleetPosition(s, fleet), { x: 50, y: 40 });
  fleet.preparing = true; s.hour = 0; assert.deepEqual(replayFleetPosition(s, fleet), { x: 95, y: 75 });
  fleet.arrives = fleet.departed; s.hour = fleet.departed;
  assert.throws(() => replayFleetPosition(s, fleet), /duration/i);
  assert.equal(encodeSharedReplay(replay), before);
});

test('seek works without structuredClone and returns independently mutable nested plain data', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone');
  const replay = file();
  try {
    Object.defineProperty(globalThis, 'structuredClone', { configurable: true, value: undefined });
    const copy = seekReplay(replay, replay.from);
    const original = seekReplay(replay, replay.from);
    copy.rocks[0]!.specialists![0]!.owner = 'vesper';
    copy.coverage[0]!.radius = 999;
    copy.rules!.map.width = 999;
    copy.cargo.you = 999;
    assert.deepEqual(seekReplay(replay, replay.from), original);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'structuredClone', descriptor);
  }
});
