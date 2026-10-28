import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advance, type Game } from './simulation';
import { createConfiguredGame } from './world';
import { drillMine, maximumShield } from './economy';

const options = { rivals: false };
const epsilon = 5e-10;
function adjacent(hour: number, up: boolean): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, hour);
  view.setBigUint64(0, view.getBigUint64(0) + (up ? 1n : -1n));
  return view.getFloat64(0);
}
function base(): Game {
  const game = createConfiguredGame({ playerCount: 3, mode: 'mining' }, 0, 12345);
  for (const rock of game.rocks) {
    rock.shield = maximumShield(rock);
    rock.productionAt = 100;
    if (rock.owner === 'you') rock.drones = 0;
  }
  return game;
}
function partitioned(game: Game, end: number, cuts: number[]): Game {
  for (const hour of cuts) game = advance(game, hour, options);
  return advance(game, end, options);
}
test('factory production waits for its scheduled instant across split advances', () => {
  const game = base();
  const factory = game.rocks.find(r => r.owner === 'you' && r.kind === 'factory' && !r.coreOf)!;
  factory.productionAt = 8;
  assert.equal(advance(game, 8 - epsilon, options).rocks.find(r => r.id === factory.id)!.drones, 0);
  const end = 16 - 1.25e-9;
  assert.deepEqual(partitioned(game, end, [8 - epsilon]), advance(game, end, options));
});
for (const kind of ['mine', 'shield', 'sentry', 'tinkerer', 'route', 'interception'] as const) {
  test(`${kind} settles at the actual due instant independently of polling`, () => {
    let game = base();
    const rock = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
    const enemy = game.rocks.find(r => r.owner === 'vesper')!;
    let due = .5;
    if (kind === 'mine') {
      rock.drones = 50;
      game = drillMine(game, rock.id, 'you');
      due = game.rocks.find(r => r.id === rock.id)!.miningAt!;
    } else if (kind === 'shield') { rock.shield = 0; rock.shieldAt = due; }
    else if (kind === 'sentry' || kind === 'tinkerer') {
      rock.shield = 5; rock.shieldAt = 100;
      rock.specialists!.push({ id: kind, owner: 'you', kind, nextActionAt: due });
      game.fleets = [{ id: 1, owner: 'vesper', from: enemy.id, to: rock.id, drones: 100, departed: 0, arrives: 10, speed: 8, specialists: [],
        route: { from: { x: rock.x + 12.000000002, y: rock.y }, to: { x: rock.x + 92.000000002, y: rock.y } } }];
      game.nextId = 2;
    } else {
      game.fleets = [
        { id: 1, owner: 'you', from: rock.id, to: enemy.id, drones: 20, departed: 0, arrives: kind === 'route' ? 1 : .5,
          speed: kind === 'route' ? 8 : 16, specialists: kind === 'route' ? [] : [{ id: 'pirate', owner: 'you', kind: 'pirate' }],
          ...(kind === 'interception' ? { intercept: { target: 2, home: rock.id } } : {}), route: { from: { x: 0, y: 0 }, to: { x: 8, y: 0 } } },
        { id: 2, owner: 'vesper', from: enemy.id, to: rock.id, drones: 10, departed: 0, arrives: kind === 'route' ? 1 : 2,
          speed: 8, specialists: [], route: { from: { x: kind === 'route' ? 8 : 12, y: 0 }, to: { x: kind === 'route' ? 0 : -4, y: 0 } } },
      ];
      game.nextId = 3;
    }
    const before = advance(game, due - epsilon, options);
    if (kind === 'mine') assert.equal(before.cargo.you, 0);
    if (kind === 'shield') assert.equal(before.rocks.find(r => r.id === rock.id)!.shield, 0);
    if (kind === 'tinkerer') assert.equal(before.rocks.find(r => r.id === rock.id)!.shield, 5);
    if (kind === 'route' || kind === 'interception') assert.equal(before.fleets.length, 2);
    const end = kind === 'mine' ? 2 * due - 1.25e-9 : due + .01;
    for (const cuts of [[due - epsilon], [adjacent(due, false)], [due], [adjacent(due, true)], [due + epsilon], [due - epsilon, due, due + epsilon]]) {
      assert.deepEqual(partitioned(game, end, cuts), advance(game, end, options));
    }
    if (kind === 'sentry') assert.equal(advance(game, end, options).fleets[0]!.drones, 100);
  });
}
test('entry refresh preserves equal-hour shield and timed ability work', () => {
  const game = base();
  const rock = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  rock.shield = 3; rock.shieldAt = 0;
  assert.equal(advance(game, .01, options).rocks.find(r => r.id === rock.id)!.shield, 4);
  rock.specialists!.push({ id: 'drain', kind: 'tinkerer', owner: 'you', nextActionAt: 0 });
  const result = advance(game, .01, options).rocks.find(r => r.id === rock.id)!;
  assert.equal(result.shield, 3); // Recharge precedes drain at the same hour.
  assert.equal(result.specialists!.find(u => u.id === 'drain')!.nextActionAt, 1 / 3);
  assert.equal(result.shieldAt, 48 / maximumShield(rock));
});
test('revisions 1–4 retain early production and shifted cadence', () => {
  for (const revision of [undefined, 2, 3, 4] as const) {
    const game = base();
    if (revision === undefined) delete game.rules!.mechanicsVersion;
    else game.rules!.mechanicsVersion = revision;
    const factory = game.rocks.find(r => r.owner === 'you' && r.kind === 'factory' && !r.coreOf)!;
    factory.productionAt = 8;
    const early = advance(game, 8 - epsilon, options).rocks.find(r => r.id === factory.id)!;
    assert.equal(early.drones, 6);
    assert.equal(early.productionAt, 16 - epsilon);
  }
});

test('a queue before production cannot spend future output, including near-due queries', async () => {
  const { scheduleAction } = await import('./future-actions');
  for (const at of [8 - epsilon, 8, 8 + epsilon]) {
    const game = base();
    const factory = game.rocks.find(r => r.owner === 'you' && r.kind === 'factory' && !r.coreOf)!;
    factory.productionAt = 8; factory.drones = 44;
    const queued = scheduleAction(game, { id: 'timing-mine-action', owner: 'you', executeAt: at, action: { type: 'drill-mine', rock: factory.id } });
    const result = advance(queued, 8.01, options);
    assert.equal(result.rocks.find(r => r.id === factory.id)!.kind, at < 8 ? 'factory' : 'mine');
    assert.deepEqual(partitioned(queued, 8.01, [8 - 2 * epsilon, 8 - epsilon, 8, 8 + epsilon]), result);
  }
});

test('configured v5 worlds preserve complete states through arbitrary cuts, trace, and private replay/save', async () => {
  const { applyCommand, createArchive, exportArchive, replayTo, traceReplayTo } = await import('./replay');
  const { decodeSave } = await import('./save-format');
  const { decodeReplay } = await import('./replay-save');
  for (const seed of [12345, 83, 987654]) {
    const game = createConfiguredGame({ playerCount: 3, mode: 'mining' }, 0, seed);
    assert.equal(game.rules!.mechanicsVersion, 5);
    const home = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
    const target = game.rocks.find(r => r.owner === null)!;
    const { archive } = applyCommand(createArchive(game, { rivals: true }),
      { type: 'dispatch', owner: 'you', from: home.id, to: target.id, drones: 10 }, { rivals: true, knownThrough: 0 });
    const before = exportArchive(archive);
    const initial = replayTo(archive, 0, { rivals: true, knownThrough: 24 });
    const expected = advance(initial, 24);
    let split = initial;
    for (const hour of [1e-10, 1 / 6 - epsilon, 1 / 6, .7, 1.5999999995, 2.33, 7.9999999995, 8, 8.0000000005, 12.5, 23.9999999995]) split = advance(split, hour);
    assert.deepEqual(advance(split, 24), expected);
    assert.deepEqual(advance(initial, 24, { trace: r => {
      if (r.type === 'point') { r.game.rocks.length = 0; r.game.hour = -1; }
      else r.to.fleets.length = 0;
    } }), expected);
    assert.deepEqual(traceReplayTo(archive, 24, { rivals: true, knownThrough: 24 }, () => {}), expected);
    assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: expected })).game, expected);
    assert.doesNotThrow(() => decodeReplay(before, expected, true));
    assert.deepEqual(exportArchive(archive), before);
    assert.deepEqual(advance(initial, 24, { stopWhen: g => g.hour >= 8 }), advance(initial, 8));
  }
});

test('v5 preparation still completes exactly, with unchanged stopWhen behavior', async () => {
  const { dispatch } = await import('./simulation');
  const game = base();
  const source = game.rocks.find(r => r.owner === 'you')!;
  source.drones = 10;
  const destination = game.rocks.find(r => r.owner === null)!;
  const launched = dispatch(game, source.id, destination.id, 1, 'you');
  const due = launched.fleets[0]!.departed;
  assert.equal(advance(launched, due - epsilon, options).fleets[0]!.preparing, true);
  assert.equal(advance(launched, due, options).fleets[0]!.preparing, undefined);
  assert.deepEqual(partitioned(launched, due + epsilon, [due - epsilon, due]), advance(launched, due + epsilon, options));
});
test('computed noninteger route contacts retain provenance and equal-hour id order without zero-step loops', async () => {
  const { nextRouteEncounter } = await import('./route-encounters');
  const game = base();
  const home = game.rocks.find(r => r.owner === 'you')!;
  const enemy = game.rocks.find(r => r.owner === 'vesper')!;
  const from = { x: 3.1, y: 2 }, to = { x: 14.4, y: 2 };
  game.fleets = [
    { id: 3, owner: 'vesper', from: enemy.id, to: home.id, drones: 10, departed: 0, arrives: 1.4125, speed: 8, specialists: [], route: { from: to, to: from } },
    { id: 1, owner: 'you', from: home.id, to: enemy.id, drones: 50, departed: 0, arrives: 1.4125, speed: 8, specialists: [], route: { from, to } },
    { id: 2, owner: 'vesper', from: enemy.id, to: home.id, drones: 20, departed: 0, arrives: 1.4125, speed: 8, specialists: [], route: { from: to, to: from } },
  ];
  game.nextId = 4;
  const due = nextRouteEncounter(game);
  assert.ok(Number.isFinite(due));
  const contacts: number[][] = [];
  const result = advance(game, due + .01, { ...options, trace: r => {
    if (r.type === 'point' && r.phase === 'route-contact') contacts.push(r.game.fleets.map(f => f.id));
  } });
  assert.deepEqual(contacts, [[3, 1], [1]]);
  assert.equal(result.fleets[0]!.drones, 20);
  assert.deepEqual(partitioned(game, due + .01, [due - epsilon, due, due + epsilon]), result);
});
test('v5 gifts and pending identities survive save and replay without changing their preparation window', async () => {
  const { applyCommand, createArchive, exportArchive, replayTo } = await import('./replay');
  const { decodeReplay } = await import('./replay-save');
  const { decodeSave } = await import('./save-format');
  const game = createConfiguredGame({ playerCount: 3, mode: 'mining' }, 0, 12345);
  const source = game.rocks.find(r => r.owner === 'you' && r.drones >= 10)!;
  const destination = game.rocks.find(r => r.owner === 'vesper')!;
  const { archive, game: gifted } = applyCommand(createArchive(game),
    { type: 'gift', owner: 'you', from: source.id, to: destination.id, drones: 10, recipient: 'vesper' }, { rivals: false, knownThrough: 0 });
  const due = gifted.fleets[0]!.departed;
  const end = gifted.fleets[0]!.arrives + .01;
  const expected = advance(gifted, end, options);
  assert.deepEqual(partitioned(gifted, end, [due - epsilon, due, due + epsilon]), expected);
  assert.deepEqual(replayTo(archive, end, { rivals: false, knownThrough: end }), expected);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: expected })).game, expected);
  assert.doesNotThrow(() => decodeReplay(exportArchive(archive), expected, false));
});
test('traveling timed modules restart their station cadence on arrival without rewinding time', async () => {
  const { dispatch } = await import('./simulation');
  const game = base();
  const source = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const destination = game.rocks.find(r => r.owner === 'you' && r.id !== source.id)!;
  source.specialists!.push({ id: 'travel-sentry', kind: 'sentry', owner: 'you', nextActionAt: .5 });
  const launched = dispatch(game, source.id, destination.id, 0, 'you', false, ['travel-sentry']);
  const arrival = launched.fleets[0]!.arrives;
  assert.ok(arrival > .5);
  const result = advance(launched, arrival + .01, { ...options, trace: r => {
    if (r.type === 'span') assert.ok(r.to.hour >= r.from.hour, 'simulation clock rewound on timed module arrival');
  } });
  assert.equal(result.rocks.find(r => r.id === destination.id)!.specialists!.find(u => u.id === 'travel-sentry')!.nextActionAt, arrival + 2);
});
