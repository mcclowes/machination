import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame } from './simulation';
import { applyCommand, createArchive, exportArchive, replayTo, traceReplayTo } from './replay';
import { createLegacyGame } from './legacy';
import { decodeOperation } from './operation-save';
import { readFile } from 'node:fs/promises';
import type { SimulationTrace } from './simulation-trace';

test('tracing preserves default physics and detaches every callback', () => {
  const base = createGame(0);
  const original = structuredClone(base);
  const records: SimulationTrace[] = [];
  const expected = advance(base, 24);
  assert.deepEqual(advance(base, 24, { trace: record => records.push(record) }), expected);
  assert.ok(records.some(r => r.type === 'span'));
  assert.deepEqual(advance(base, 24, { trace: record => {
    const games = record.type === 'point' ? [record.game] : [record.from, record.to];
    for (const game of games) { game.rocks.length = 0; game.fleets.length = 0; game.hour = -100; }
  } }), expected);
  assert.deepEqual(base, original);
});

test('private replay traces the same command schedule and cannot mutate its archive', () => {
  const options = { rivals: false, knownThrough: 1 };
  let archive = createArchive(createGame(0));
  archive = applyCommand(archive, { type: 'dispatch', owner: 'you', from: 'm', to: 'b', drones: 10 }, options).archive;
  const before = exportArchive(archive);
  const records: SimulationTrace[] = [];
  const replayOptions = { ...options, knownThrough: 12 };
  assert.deepEqual(traceReplayTo(archive, 12, replayOptions, r => records.push(r)), replayTo(archive, 12, replayOptions));
  assert.equal(records.filter(r => r.type === 'point' && r.phase === 'command:before').length, 1);
  const mutatedSinkResult = traceReplayTo(archive, 12, replayOptions, r => {
    const game = r.type === 'point' ? r.game : r.to;
    game.rocks[0]!.owner = null; game.cargo.you = -999;
  });
  assert.deepEqual(mutatedSinkResult, replayTo(archive, 12, replayOptions));
  assert.deepEqual(exportArchive(archive), before);
});

function points(records: SimulationTrace[], phase: string) {
  return records.filter((r): r is Extract<SimulationTrace, { type: 'point' }> => r.type === 'point' && r.phase === phase).map(r => r.game);
}
function traced(base: ReturnType<typeof createGame>, hour: number, options: Parameters<typeof advance>[2] = { rivals: false }) {
  const records: SimulationTrace[] = [];
  const expected = advance(structuredClone(base), hour, options);
  const actual = advance(structuredClone(base), hour, { ...options, trace: r => records.push(r) });
  assert.deepEqual(actual, expected);
  assert.deepEqual(points(records, 'advance:final').at(-1), actual);
  return { records, game: actual };
}

test('same-hour sorted arrivals preserve capture and recapture as separate atomic outcomes', () => {
  const base = createGame(0);
  const target = base.rocks.find(r => r.id === 'b')!;
  target.drones = 0;
  base.fleets = [
    { id: 9, owner: 'vesper', from: 'e', to: 'b', speed: 8, departed: 0, arrives: 1, drones: 30, specialists: [] },
    { id: 2, owner: 'you', from: 'm', to: 'b', speed: 8, departed: 0, arrives: 1, drones: 10, specialists: [] },
  ];
  const { records, game } = traced(base, 1);
  assert.deepEqual(points(records, 'arrival').map(g => g.rocks.find(r => r.id === 'b')!.owner), ['you', 'vesper']);
  assert.equal(game.rocks.find(r => r.id === 'b')!.owner, 'vesper');
  const span = records.find(r => r.type === 'span')!;
  assert.equal(span.type, 'span');
  if (span.type === 'span') {
    assert.equal(span.to.hour, 1);
    assert.equal(span.to.rocks.find(r => r.id === 'b')!.owner, null);
    assert.equal(span.to.fleets.length, 2);
  }
});

test('queued transfers, action execution, and aborts retain stored order', () => {
  const base = createGame(0);
  base.scheduled = [
    { id: 'first', owner: 'you', from: 'm', to: 'b', drones: 10, executeAt: 1, fleetId: 50 },
    { id: 'abort', owner: 'you', from: 'm', to: 'b', drones: 99999, executeAt: 1, fleetId: 51 },
    { id: 'action', owner: 'you', executeAt: 1, action: { type: 'shields', rock: 'm', disabled: true } },
    { id: 'last', owner: 'you', from: 'm', to: 'b', drones: 10, executeAt: 1, fleetId: 52 },
  ];
  const { records } = traced(base, 1);
  const queue = points(records, 'queue');
  assert.equal(queue.length, 4);
  assert.deepEqual(queue.map(g => g.fleets.map(f => f.id)), [[50], [50], [50], [50, 52]]);
  assert.match(queue[1]!.events[0]!.message, /aborted/);
  assert.equal(queue[2]!.rocks.find(r => r.id === 'm')!.shieldsDisabled, true);
});

test('private replay preserves equal-hour commands, automatic rival decisions, and validation', () => {
  const base = createGame(0);
  let archive = createArchive(base, { rivals: true });
  for (const disabled of [true, false]) archive = applyCommand(archive,
    { type: 'shields', owner: 'you', rock: 'm', disabled }, { rivals: true, knownThrough: 1 }).archive;
  const records: SimulationTrace[] = [];
  const options = { rivals: true, knownThrough: 12 };
  assert.deepEqual(traceReplayTo(archive, 12, options, r => records.push(r)), replayTo(archive, 12, options));
  assert.deepEqual(points(records, 'command:after').map(g => g.rocks.find(r => r.id === 'm')!.shieldsDisabled), [true, false]);
  assert.deepEqual(points(records, 'command:before').map(g => g.hour), [1, 1]);
  assert.ok(points(records, 'rival').length >= 4);
  assert.throws(() => traceReplayTo(archive, 12, { ...options, rivals: false }, () => {}), /rival mode/);
  assert.throws(() => traceReplayTo(archive, 13, options, () => {}), /known history/);
});

test('actual route contacts are atomic and not inferred from retained prose', () => {
  const base = createGame(0);
  const a = base.rocks.find(r => r.id === 'm')!;
  const b = base.rocks.find(r => r.id === 'b')!;
  const route = { from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y } };
  base.fleets = [
    { id: 1, owner: 'you', from: 'm', to: 'b', drones: 20, speed: 8, departed: 0, arrives: 2, route, specialists: [] },
    { id: 2, owner: 'vesper', from: 'b', to: 'm', drones: 10, speed: 8, departed: 0, arrives: 2, route: { from: route.to, to: route.from }, specialists: [] },
  ];
  const { records } = traced(base, 1.1);
  const contacts = points(records, 'route-contact');
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0]!.hour, 1);
  assert.deepEqual(contacts[0]!.fleets.map(f => [f.id, f.drones]), [[1, 10]]);
});

test('timed abilities and passive conversion expose complete per-effect states', () => {
  const base = createGame(0);
  const rock = base.rocks.find(r => r.id === 'm')!;
  rock.specialists = [
    { id: 'drain-1', owner: 'you', kind: 'tinkerer', nextActionAt: 1 },
    { id: 'drain-2', owner: 'you', kind: 'tinkerer', nextActionAt: 1 },
    { id: 'hypnosis', owner: 'you', kind: 'hypnotist' },
    { id: 'prisoner', owner: 'vesper', kind: 'queen', captive: true },
  ];
  rock.shield = 5;
  rock.shieldAt = 100;
  const { records } = traced(base, 1);
  const actions = points(records, 'timed-ability');
  assert.deepEqual(actions.map(g => g.rocks.find(r => r.id === 'm')!.shield), [4, 3]);
  const captive = points(records, 'passive:hypnotist')[0]!.rocks.find(r => r.id === 'm')!.specialists!.find(u => u.id === 'prisoner')!;
  assert.equal(captive.owner, 'you');
  assert.equal(captive.kind, 'princess');
  assert.equal(captive.captive, undefined);
});

test('snapshots survive event retention pruning and remain independent of later records', () => {
  const base = createGame(0);
  const target = base.rocks.find(r => r.id === 'b')!;
  target.drones = 10000;
  base.fleets = Array.from({ length: 90 }, (_, i) => ({ id: i + 1, owner: 'you' as const, from: 'm', to: 'b', drones: 1, speed: 8, departed: 0, arrives: 1, specialists: [] }));
  const { records, game } = traced(base, 1);
  const arrivals = points(records, 'arrival');
  assert.equal(arrivals.length, 90);
  assert.equal(arrivals[0]!.fleets.length, 89);
  assert.equal(arrivals.at(-1)!.fleets.length, 0);
  assert.ok(arrivals.at(-1)!.events.length > game.events.length);
  assert.equal(game.events.filter(e => e.message.includes('defending force')).length, 80);
  const first = structuredClone(arrivals[0]!);
  arrivals.at(-1)!.rocks.length = 0;
  assert.deepEqual(arrivals[0], first);
});

test('legacy spans retain continuous production and mining endpoints before effects', () => {
  const base = createLegacyGame(0);
  base.rocks.find(r => r.id === 'b')!.owner = 'you';
  const { records } = traced(base, 0.25);
  const spans = records.filter((r): r is Extract<SimulationTrace, { type: 'span' }> => r.type === 'span');
  assert.equal(spans.length, 1);
  assert.equal(spans[0]!.from.hour, 0);
  assert.equal(spans[0]!.to.hour, 0.25);
  assert.equal(spans[0]!.from.rocks[0]!.drones, 90);
  assert.equal(spans[0]!.to.rocks[0]!.drones, 91);
  assert.equal(spans[0]!.from.cargo.you, 0);
  assert.equal(spans[0]!.to.cargo.you, 0.5);
});

test('stopWhen, zero duration, victory, draw, and terminal returns retain exact outcomes', () => {
  traced(createGame(0), 10, { rivals: false, stopWhen: g => g.hour >= 2 });
  const zero = traced(createGame(0), 0);
  assert.equal(zero.records.filter(r => r.type === 'span').length, 0);
  const victory = createLegacyGame(0);
  victory.cargo.you = 299;
  victory.rocks.find(r => r.id === 'b')!.owner = 'you';
  const won = traced(victory, 4);
  assert.equal(won.game.hour, 0.5);
  assert.equal(points(won.records, 'victory').at(-1)!.winner, 'you');
  traced(won.game, 10);
  const draw = createGame(0);
  draw.eliminated = ['you', 'vesper', 'null'];
  const drawn = traced(draw, 1);
  assert.equal(points(drawn.records, 'victory').at(-1)!.draw, true);
});

test('economy ends spans before discrete production and exposes funding reconciliation', () => {
  const base = createGame(0);
  const factory = base.rocks.find(r => r.id === 'm')!;
  factory.drones = 0;
  factory.productionAt = 1;
  base.funding = [{ from: 'you', to: 'vesper' }];
  const { records } = traced(base, 1);
  const span = records.find(r => r.type === 'span')!;
  assert.equal(span.type, 'span');
  if (span.type === 'span') assert.equal(span.to.rocks.find(r => r.id === 'm')!.drones, 0);
  assert.equal(points(records, 'economy')[0]!.rocks.find(r => r.id === 'm')!.drones, 6);
  assert.deepEqual(points(records, 'funding')[0]!.funding, []);
});

test('legacy and specialist interceptions report each resolved mission including unknown outcomes', () => {
  for (const base of [createLegacyGame(0), createGame(0)]) {
    const origin = base.rocks.find(r => r.id === 'a')!;
    const p = { x: origin.x + 1, y: origin.y };
    base.fleets = [
      { id: 1, owner: 'you', from: 'a', to: 'a', drones: 30, departed: 0, arrives: 1, route: { from: origin, to: p }, intercept: { target: 2, home: 'a' }, module: 'scavenger', specialists: [{ id: 'rig', owner: 'you', kind: 'pirate' }] },
      { id: 2, owner: 'vesper', from: 'e', to: 'a', speed: 8, drones: 10, departed: 0, arrives: 2, route: { from: p, to: p }, specialists: [] },
    ];
    const result = traced(base, 1);
    assert.equal(points(result.records, 'interception').length, 1);
    assert.ok(!result.game.fleets.some(f => f.id === 2));
    const unknown = traced(base, 1, { rivals: false, unknownInterceptions: [1] });
    assert.equal(points(unknown.records, 'interception').length, 1);
    assert.ok(!unknown.game.fleets.some(f => f.id === 1));
  }
});

test('whole combat outcomes keep simultaneous swaps and destruction atomic', () => {
  for (const kind of ['doubleAgent', 'martyr'] as const) {
    const base = createGame(0);
    const a = base.rocks.find(r => r.id === 'm')!;
    const b = base.rocks.find(r => r.id === 'b')!;
    base.fleets = [
      { id: 1, owner: 'you', from: 'm', to: 'b', drones: 20, speed: 8, departed: 0, arrives: 2, route: { from: a, to: b }, specialists: [{ id: 'ability-a', kind, owner: 'you' }] },
      { id: 2, owner: 'vesper', from: 'b', to: 'm', drones: 10, speed: 8, departed: 0, arrives: 2, route: { from: b, to: a }, specialists: [{ id: 'ability-b', kind, owner: 'vesper' }] },
    ];
    const { records } = traced(base, 1);
    const contacts = points(records, 'route-contact');
    assert.equal(contacts.length, 1);
    if (kind === 'doubleAgent') {
      assert.deepEqual(contacts[0]!.fleets.map(f => [f.owner, f.drones]), [['vesper', 0], ['you', 0]]);
      assert.deepEqual(contacts[0]!.fleets.map(f => f.specialists![0]!.owner), ['vesper', 'you']);
    } else assert.equal(contacts[0]!.fleets.length, 0);
  }
});

test('historical planar and mining archives trace to their exact stored frontiers', async () => {
  for (const path of ['src/game/fixtures/planar-replay-aec9546.json', 'src/game/fixtures/mine-replays-e92b028.json']) {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    for (const fixture of Array.isArray(parsed) ? parsed : [parsed]) {
      const loaded = decodeOperation(JSON.stringify(fixture), fixture.savedAt);
      const options = { rivals: true, knownThrough: loaded.game.hour };
      const records: SimulationTrace[] = [];
      assert.deepEqual(traceReplayTo(loaded.archive, loaded.game.hour, options, r => records.push(r)), fixture.game);
      assert.deepEqual(points(records, 'replay:final').at(-1), fixture.game);
    }
  }
});

test('sentry damage, envoy release, and launch preparation have semantic boundaries', () => {
  const base = createGame(0);
  const rock = base.rocks.find(r => r.id === 'm')!;
  const holding = base.rocks.find(r => r.id === 'b')!;
  holding.x = rock.x; holding.y = rock.y;
  holding.specialists = [{ id: 'held', owner: 'you', kind: 'helmsman', captive: true }];
  rock.specialists = [
    { id: 'sentry', owner: 'you', kind: 'sentry', nextActionAt: 1 },
    { id: 'envoy', owner: 'you', kind: 'diplomat' },
  ];
  base.fleets = [
    { id: 5, owner: 'vesper', from: 'e', to: 'b', speed: 8, drones: 100, departed: 0, arrives: 10, route: { from: rock, to: rock }, specialists: [] },
    { id: 6, owner: 'you', from: 'm', to: 'b', speed: 8, drones: 1, departed: 0.5, arrives: 10, preparing: true, specialists: [] },
  ];
  base.nextId = 7;
  const { records } = traced(base, 1);
  assert.equal(points(records, 'passive:diplomat').length, 1);
  assert.equal(points(records, 'timed-ability').at(-1)!.fleets.find(f => f.id === 5)!.drones, 95);
  assert.equal(points(records, 'preparation').find(g => g.hour === 0.5)!.fleets.find(f => f.id === 6)!.preparing, undefined);
});

test('gift, release, resignation, and inactivity submissions stay atomic in private replay', () => {
  for (const command of [
    { type: 'gift', owner: 'you', from: 'm', to: 'b', drones: 10, recipient: 'vesper' },
    { type: 'release', owner: 'you', id: 'captive' },
    { type: 'resign', owner: 'you' },
    { type: 'inactivity', owners: ['vesper', 'null'] },
  ] as const) {
    const base = createGame(0);
    base.rocks.find(r => r.id === 'm')!.specialists!.push({ id: 'captive', owner: 'vesper', kind: 'helmsman', captive: true });
    const options = { rivals: false, knownThrough: 0 };
    const { archive, game } = applyCommand(createArchive(base), structuredClone(command) as Parameters<typeof applyCommand>[1], options);
    const records: SimulationTrace[] = [];
    assert.deepEqual(traceReplayTo(archive, 0, options, r => records.push(r)), game);
    assert.equal(points(records, 'command:before').length, 1);
    assert.deepEqual(points(records, 'command:after'), [game]);
  }
});
