import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfiguredGame } from './world';
import { advance } from './simulation';
import { routeCandidates, nextRouteEncounter } from './route-encounters';
import { createArchive, executeCommand, exportArchive, replayTo, restoreArchive, type GameCommand, type ReplayEntry } from './replay';
import { decodeSave } from './save-format';
import { generateSharedReplay } from '../replay/generate';
import { decodeSharedReplay, encodeSharedReplay } from '../replay/codec';
import { seekReplay } from '../replay/playback';
import { forecastObservation, observe } from './visibility';

// Ordinary encounters require the same two outposts, not merely overlapping collinear paths.
// https://subterfuge-game.com/rulebook/ (Subs)
function fixture(revision?: 11 | 12, moving = false) {
  const baseline = createConfiguredGame({ playerCount: 3, mode: 'mining', driftingBases: moving }, 0, 2026);
  if (revision !== undefined) baseline.rules!.mechanicsVersion = revision;
  baseline.hour = 24;
  for (const site of baseline.rocks) {
    site.productionAt = 1000; site.shieldAt = 1000; site.shieldsDisabled = true;
    delete site.drift;
  }
  const [a, b, d] = baseline.rocks.filter(site => site.owner === 'you' && !site.coreOf);
  const c = baseline.rocks.find(site => site.owner === 'vesper' && !site.coreOf)!;
  const points = [a!, b!, c, d!];
  const place = (coordinates: readonly number[]) => points.forEach((site, i) => {
    Object.assign(site, { x: coordinates[i]!, y: 20, drones: 40 });
    if (moving) site.drift = { origin: { x: (site.x - 2.4 + baseline.rules!.map.width) % baseline.rules!.map.width, y: 20 }, velocity: { x: .1, y: 0 } };
  });
  place([0, 40, 30, 10]);
  let game = baseline;
  const entries: ReplayEntry[] = [];
  return {
    a: a!.id, b: b!.id, c: c.id, d: d!.id, baseline, place,
    get game() { return game; },
    command(command: GameCommand) { entries.push({ hour: game.hour, command }); game = executeCommand(game, command); return game.fleets.at(-1)!; },
    at(hour: number) {
      const split = advance(advance(game, (game.hour + hour) / 2, { rivals: false }), hour, { rivals: false });
      game = advance(game, hour, { rivals: false });
      assert.deepEqual(split, game);
      return game;
    },
    check() {
      const data = { ...exportArchive(createArchive(baseline)), entries: [...entries] };
      assert.deepEqual(replayTo(restoreArchive(data), game.hour, { rivals: false, knownThrough: game.hour }), game);
      assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game, replay: data })).game, game);
    },
    shared() {
      const archive = restoreArchive({ ...exportArchive(createArchive(baseline)), entries: [...entries] });
      return decodeSharedReplay(encodeSharedReplay(generateSharedReplay({ game, archive }, 'you', baseline.hour, game.hour)));
    },
  };
}

for (const [name, coordinates, at, faster] of [
  ['four distinct outposts', [0, 40, 30, 10], 26.1, false],
  ['coincident coordinates with distinct identities', [0, 40, 40, 0], 26.7, false],
  ['wrapped overlapping paths', [98, 12, 8, 99], 24.9, false],
  ['unrelated same-direction catch-up', [0, 40, 8, 32], 25.2, true],
] as const) {
  test(`ordinary fleets on different outpost pairs do not fight: ${name}`, () => {
    const f = fixture(); f.place(coordinates);
    if (faster) f.baseline.rocks.find(site => site.id === f.a)!.specialists = [{ id: 'fast-unit', kind: 'helmsman', owner: 'you' }];
    f.command({ type: 'dispatch', owner: 'you', from: f.a, to: f.b, drones: 10, ...(faster ? { specialists: ['fast-unit'] } : {}) });
    f.command({ type: 'dispatch', owner: 'vesper', from: f.c, to: f.d, drones: 7 });
    f.at(24 + 1 / 6);
    assert.deepEqual(routeCandidates(f.game), []);
    assert.equal(nextRouteEncounter(f.game), Infinity);
    assert.deepEqual(forecastObservation(observe(f.game, 'you'), 'you', at).fleets.map(fleet => [fleet.owner, fleet.drones]), [['you', 10], ['vesper', 7]]);
    f.at(at);
    assert.deepEqual(f.game.fleets.map(fleet => [fleet.owner, fleet.drones]), [['you', 10], ['vesper', 7]]);
    assert.ok(!f.game.events.some(event => event.message.includes('fought in transit')));
    f.check();
    const scene = seekReplay(f.shared(), at);
    assert.deepEqual(scene.fleets.map(fleet => [fleet.owner, fleet.drones]), [['you', 10], ['vesper', 7]]);
  });
}

for (const moving of [false, true]) {
  test(`reciprocal outpost pairs retain exact contact with split/save/replay: moving=${moving}`, () => {
    const f = fixture(undefined, moving); f.place([10, 60, 50, 20]);
    f.command({ type: 'dispatch', owner: 'you', from: f.a, to: f.c, drones: 10 });
    f.command({ type: 'dispatch', owner: 'vesper', from: f.c, to: f.a, drones: 7 });
    f.at(24 + 1 / 6);
    const contact = nextRouteEncounter(f.game);
    assert.ok(Number.isFinite(contact) && contact > f.game.hour);
    f.at(contact - 1e-6); assert.equal(f.game.fleets.length, 2);
    f.at(contact);
    assert.equal(f.game.fleets.length, 1); assert.equal(f.game.fleets[0]!.drones, 3);
    assert.equal(f.game.fleets[0]!.to, f.c);
    f.check();
  });
}

test('true reciprocal seam routes still meet across the map edge', () => {
  const f = fixture(); f.place([98, 30, 2, 40]);
  f.command({ type: 'dispatch', owner: 'you', from: f.a, to: f.c, drones: 10 });
  f.command({ type: 'dispatch', owner: 'vesper', from: f.c, to: f.a, drones: 7 });
  f.at(24 + 1 / 6);
  f.at(nextRouteEncounter(f.game));
  assert.equal(f.game.fleets.length, 1); assert.equal(f.game.fleets[0]!.drones, 3);
  f.check();
});

for (const samePair of [false, true]) {
  test(`gift transfer requires an eligible ordinary route contact: samePair=${samePair}`, () => {
    const f = fixture();
    if (samePair) f.place([0, 60, 40, 10]);
    const gift = f.command({ type: 'gift', owner: 'you', recipient: 'vesper', from: f.a, to: samePair ? f.c : f.b, drones: 10 });
    f.command({ type: 'dispatch', owner: 'vesper', from: f.c, to: samePair ? f.a : f.d, drones: 7 });
    f.at(24 + 1 / 6);
    f.at(samePair ? nextRouteEncounter(f.game) : 26.1);
    const current = f.game.fleets.find(fleet => fleet.id === gift.id)!;
    assert.equal(current.owner, samePair ? 'vesper' : 'you');
    assert.equal(current.returning, samePair ? true : undefined);
    assert.equal(current.drones, 10);
    assert.equal(f.game.fleets.find(fleet => fleet.id !== gift.id)!.drones, 7);
    f.check();
  });
}

test('revision eleven preserves recorded different-pair combat', () => {
  const f = fixture(11);
  f.command({ type: 'dispatch', owner: 'you', from: f.a, to: f.b, drones: 10 });
  f.command({ type: 'dispatch', owner: 'vesper', from: f.c, to: f.d, drones: 7 });
  f.at(26.1);
  assert.equal(f.game.fleets.length, 1); assert.equal(f.game.fleets[0]!.drones, 3);
  f.check();
  assert.equal(seekReplay(f.shared(), 26.1).fleets[0]!.drones, 3);
});

test('ordinary speed refresh keeps route identity after replacing the geometric start', () => {
  const f = fixture();
  f.baseline.rocks.find(site => site.coreOf === 'you')!.specialists!.push({ id: 'remote-navigator', kind: 'navigator', owner: 'you' });
  const ordinary = f.command({ type: 'dispatch', owner: 'you', from: f.a, to: f.b, drones: 10 });
  f.command({ type: 'dispatch', owner: 'vesper', from: f.c, to: f.d, drones: 7 });
  f.at(24.4);
  f.command({ type: 'promote', owner: 'you', id: 'remote-navigator' });
  const refreshed = f.game.fleets.find(fleet => fleet.id === ordinary.id)!;
  assert.equal(refreshed.from, f.a); assert.equal(refreshed.speed, 12);
  assert.ok(refreshed.route!.from.x > 0);
  assert.equal(refreshed.courseChanged, undefined);
  assert.equal(nextRouteEncounter(f.game), Infinity);
  f.at(26); assert.equal(f.game.fleets.length, 2);
  f.check();
});

test('same-direction catches on the same pair remain eligible after the origin changes owner', () => {
  const f = fixture(); f.place([0, 40, 0, 10]);
  Object.assign(f.baseline.rocks.find(site => site.id === f.a)!, { drones: 11 });
  Object.assign(f.baseline.rocks.find(site => site.id === f.c)!, { y: 8, specialists: [{ id: 'fast-captor', kind: 'helmsman', owner: 'vesper' }] });
  f.command({ type: 'dispatch', owner: 'you', from: f.a, to: f.b, drones: 10 });
  const captor = f.command({ type: 'dispatch', owner: 'vesper', from: f.c, to: f.a, drones: 31, specialists: ['fast-captor'] });
  f.at(captor.arrives);
  assert.equal(f.game.rocks.find(site => site.id === f.a)!.owner, 'vesper');
  f.command({ type: 'dispatch', owner: 'vesper', from: f.a, to: f.b, drones: 20, specialists: ['fast-captor'] });
  f.at(f.game.hour + 1 / 6);
  const contact = nextRouteEncounter(f.game);
  assert.ok(Number.isFinite(contact));
  f.at(contact);
  assert.equal(f.game.fleets.length, 1);
  assert.equal(f.game.fleets[0]!.owner, 'vesper'); assert.equal(f.game.fleets[0]!.drones, 10);
  f.check();
});

test('a completed Navigator turn stays a special leg after an Assassin kills the Navigator', () => {
  const f = fixture(); f.place([0, 40, 30, 40]);
  f.baseline.rocks.find(site => site.id === f.a)!.specialists = [{ id: 'turning-navigator', kind: 'navigator', owner: 'you' }];
  f.baseline.rocks.find(site => site.id === f.c)!.specialists = [{ id: 'nav-assassin', kind: 'assassin', owner: 'vesper' }];
  const own = f.command({ type: 'dispatch', owner: 'you', from: f.a, to: f.b, drones: 10, specialists: ['turning-navigator'] });
  f.command({ type: 'dispatch', owner: 'vesper', from: f.c, to: f.a, drones: 7, specialists: ['nav-assassin'] });
  f.at(24.5);
  f.command({ type: 'hauler', owner: 'you', change: { action: 'course', fleet: own.id, to: f.d } });
  assert.equal(f.game.fleets.find(fleet => fleet.id === own.id)!.courseChanged, undefined);
  assert.equal(observe(f.game, 'vesper').fleets.find(fleet => fleet.id === own.id)!.pendingCourse, undefined);
  f.command({ type: 'dispatch', owner: 'vesper', from: f.c, to: f.a, drones: 1 });
  f.at(24.5 + 1 / 6);
  assert.equal(f.game.fleets.find(fleet => fleet.id === own.id)!.courseChanged, true);
  f.check();
  f.at(nextRouteEncounter(f.game));
  const survivor = f.game.fleets.find(fleet => fleet.id === own.id)!;
  assert.equal(survivor.drones, 3); assert.deepEqual(survivor.specialists, []);
  assert.equal(survivor.courseChanged, true);
  f.check();
  const next = nextRouteEncounter(f.game);
  assert.equal(forecastObservation(observe(f.game, 'you'), 'you', next).fleets.find(fleet => fleet.id === own.id)!.drones, 2);
  f.at(next);
  assert.equal(f.game.fleets.find(fleet => fleet.id === own.id)!.drones, 2);
  assert.equal(f.game.fleets.find(fleet => fleet.id === own.id)!.courseChanged, true);
  f.check();
  assert.ok(seekReplay(f.shared(), f.game.hour).fleets.every(fleet => !('courseChanged' in fleet)));
});

test('returning released specialists retain existing special-leg contact and capture routing', () => {
  const f = fixture();
  for (const site of f.baseline.rocks.filter(site => site.owner === 'vesper')) { site.x = 30; site.y = 20; }
  f.baseline.rocks.find(site => site.id === f.a)!.specialists = [
    { id: 'fast-launch', kind: 'helmsman', owner: 'you' },
    { id: 'released-passenger', kind: 'foreman', owner: 'vesper', captive: true },
  ];
  f.command({ type: 'release', owner: 'you', id: 'released-passenger' });
  f.command({ type: 'dispatch', owner: 'you', from: f.a, to: f.b, drones: 10, specialists: ['fast-launch'] });
  f.at(24 + 1 / 6);
  const contact = nextRouteEncounter(f.game); assert.ok(Number.isFinite(contact));
  f.at(contact);
  const held = f.game.fleets.find(fleet => fleet.specialists?.some(unit => unit.id === 'released-passenger'))!;
  assert.equal(held.owner, 'you'); assert.equal(held.returning, true);
  assert.equal(held.specialists!.find(unit => unit.id === 'released-passenger')!.captive, true);
  assert.equal(held.courseChanged, undefined);
  f.check();
});

test('completed-turn metadata is validated independently of a surviving Navigator', () => {
  const f = fixture();
  f.baseline.rocks.find(site => site.id === f.a)!.specialists = [{ id: 'saved-navigator', kind: 'navigator', owner: 'you' }];
  const sent = f.command({ type: 'dispatch', owner: 'you', from: f.a, to: f.b, drones: 10, specialists: ['saved-navigator'] });
  f.at(24.5);
  f.command({ type: 'hauler', owner: 'you', change: { action: 'course', fleet: sent.id, to: f.d } });
  f.at(24.5 + 1 / 6);
  f.check();
  for (const value of [false, 'true', 1]) {
    const bad = structuredClone(f.game); (bad.fleets[0] as any).courseChanged = value;
    assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game: bad })));
  }
  const old = structuredClone(f.game); old.rules!.mechanicsVersion = 11;
  assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game: old })));
  const returning = structuredClone(f.game); returning.fleets[0]!.returning = true;
  assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game: returning })));
});

test('the explicit moving-base variant retains its previous different-pair geometry contract', () => {
  const f = fixture(undefined, true);
  f.command({ type: 'dispatch', owner: 'you', from: f.a, to: f.b, drones: 10 });
  f.command({ type: 'dispatch', owner: 'vesper', from: f.c, to: f.d, drones: 7 });
  f.at(24 + 1 / 6);
  const contact = nextRouteEncounter(f.game); assert.ok(Number.isFinite(contact));
  f.at(contact);
  assert.equal(f.game.fleets.length, 1); assert.equal(f.game.fleets[0]!.drones, 3);
  f.check();
});

test('targeted Pirate interception and its marked return bypass ordinary pair eligibility', () => {
  const f = fixture();
  f.baseline.rocks.find(site => site.id === f.a)!.specialists = [{ id: 'targeting-pirate', kind: 'pirate', owner: 'you' }];
  const target = f.command({ type: 'dispatch', owner: 'vesper', from: f.c, to: f.d, drones: 7 });
  f.at(24.4);
  f.command({ type: 'intercept', owner: 'you', from: f.a, target: target.id, drones: 10, specialists: ['targeting-pirate'] });
  const rig = f.game.fleets.find(fleet => fleet.intercept)!;
  assert.equal(rig.speed, 16); assert.ok(rig.arrives < target.arrives);
  f.at(rig.arrives);
  const survivor = f.game.fleets.find(fleet => fleet.specialists?.some(unit => unit.id === 'targeting-pirate'))!;
  assert.equal(survivor.drones, 3); assert.equal(survivor.returning, true);
  assert.equal(survivor.interceptionReturn, true); assert.equal(survivor.speed, 32);
  assert.equal(survivor.courseChanged, undefined);
  f.check();
});

test('Saboteur return replaces completed-turn classification without retaining incompatible metadata', () => {
  const f = fixture(); f.place([0, 40, 30, 40]);
  f.baseline.rocks.find(site => site.id === f.a)!.specialists = [{ id: 'forced-navigator', kind: 'navigator', owner: 'you' }];
  f.baseline.rocks.find(site => site.id === f.c)!.specialists = [{ id: 'forced-saboteur', kind: 'saboteur', owner: 'vesper' }];
  const own = f.command({ type: 'dispatch', owner: 'you', from: f.a, to: f.b, drones: 10, specialists: ['forced-navigator'] });
  f.command({ type: 'dispatch', owner: 'vesper', from: f.c, to: f.a, drones: 7, specialists: ['forced-saboteur'] });
  f.at(24.5);
  f.command({ type: 'hauler', owner: 'you', change: { action: 'course', fleet: own.id, to: f.d } });
  f.at(24.5 + 1 / 6);
  assert.equal(f.game.fleets.find(fleet => fleet.id === own.id)!.courseChanged, true);
  f.at(nextRouteEncounter(f.game));
  const returning = f.game.fleets.find(fleet => fleet.id === own.id)!;
  assert.equal(returning.returning, true); assert.equal(returning.courseChanged, undefined);
  assert.equal(f.game.rocks.find(site => site.id === returning.to)!.owner, 'you');
  f.check();
});
