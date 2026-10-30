import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gravityCourse } from './gravity';
import { createConfiguredGame } from './world';
import { advance, dispatch } from './simulation';
import { fleetPosition } from './flight';
import { validateOptions, validateRules } from './rules';

const map = { width: 100, height: 100, topology: 'torus' as const };
const wells = [{ id: 'giant-1', x: 50, y: 53, mass: 1, radius: 2 }];
const world = { rules: { map, mechanicsVersion: 19, gravity: { wells } } };
test('gravity courses bend around mass, preserve endpoints, and reverse across chart seams', () => {
  for (const [a, b] of [[{ x: 30, y: 50 }, { x: 70, y: 50 }], [{ x: 90, y: 50 }, { x: 20, y: 50 }]]) {
    const testWorld = a!.x === 90 ? { rules: { ...world.rules, gravity: { wells: [{ ...wells[0]!, x: 3 }] } } } : world;
    const course = gravityCourse(testWorld, a!, b!, 8, 0, 'you')!;
    const reverse = gravityCourse(testWorld, b!, a!, 8, 0, 'you')!;
    assert.ok(course.route.course!.length >= 2);
    assert.deepEqual(course.route.from, a);
    assert.ok(Math.abs(course.arrives - reverse.arrives) < 1e-10);
    for (const p of course.route.course!) assert.ok(Number.isFinite(p.x + p.y + p.at));
    const fleet = { id: 1, owner: 'you' as const, from: 'a', to: 'b', drones: 1, departed: 0, ...course };
    const back = { ...fleet, ...reverse };
    const midpoint = fleetPosition({ ...world, rocks: [], hour: course.arrives / 2 }, fleet);
    const backMidpoint = fleetPosition({ ...world, rocks: [], hour: reverse.arrives / 2 }, back);
    assert.ok(Math.hypot(midpoint.x - backMidpoint.x, midpoint.y - backMidpoint.y) < 1e-8);
    assert.ok(Math.abs(midpoint.y - 50) > 0.5);
  }
});
test('gravity defaults on, supports opting out and drift, and preserves old revisions', () => {
  assert.throws(() => validateOptions({ playerCount: 3, mode: 'mining', gravity: true, driftingBases: true }));
  const game = createConfiguredGame({ playerCount: 3, mode: 'mining', gravity: true }, 0, 7);
  assert.equal(game.rules!.mechanicsVersion, 19);
  assert.ok(game.rules!.gravity!.wells.length > 0);
  assert.deepEqual(validateRules(game.rules), game.rules);
  assert.throws(() => validateRules({ ...game.rules, mechanicsVersion: 18 }));
  assert.ok(createConfiguredGame({ playerCount: 3, mode: 'mining' }, 0, 7).rules!.gravity);
  assert.equal(createConfiguredGame({ playerCount: 3, mode: 'mining', gravity: false }, 0, 7).rules!.gravity, undefined);
  assert.equal(createConfiguredGame({ playerCount: 3, mode: 'mining', driftingBases: true }, 0, 7).rules!.gravity, undefined);
  assert.equal(createConfiguredGame({ playerCount: 3, mode: 'mining' }, 0, 7, undefined, 18).rules!.gravity, undefined);
});
test('real gravity dispatch retains its course and agrees across partitioned advancement', () => {
  let game = createConfiguredGame({ playerCount: 3, mode: 'mining', gravity: true }, 0, 7);
  const source = game.rocks.find(r => r.owner === 'you' && r.drones > 0)!;
  const target = game.rocks.find(r => r.id !== source.id && r.owner === 'you')!;
  game = dispatch(game, source.id, target.id, 1, 'you');
  assert.ok(game.fleets[0]!.route!.course);
  const until = (game.fleets[0]!.departed + game.fleets[0]!.arrives) / 2;
  const whole = advance(game, until, { rivals: false });
  const parts = advance(advance(game, until / 3, { rivals: false }), until, { rivals: false });
  assert.deepEqual(parts, whole);
});

test('frozen curves survive saves and reject malformed or unversioned waypoint tables', async () => {
  const { decodeSave } = await import('./save-format');
  let game = createConfiguredGame({ playerCount: 3, mode: 'mining', gravity: true }, 0, 7);
  const from = game.rocks.find(r => r.owner === 'you' && r.drones > 0)!;
  const to = game.rocks.find(r => r.owner === 'you' && r.id !== from.id)!;
  game = advance(dispatch(game, from.id, to.id, 1, 'you'), 0.2, { rivals: false });
  const raw = JSON.stringify({ savedAt: 0, game });
  assert.deepEqual(decodeSave(raw).game, game);
  for (const corrupt of [
    (g: typeof game) => { g.fleets[0]!.route!.course![1]!.at = 0; },
    (g: typeof game) => { g.fleets[0]!.route!.course!.at(-1)!.x += 1; },
    (g: typeof game) => { delete g.rules!.gravity; },
  ]) {
    const bad = structuredClone(game); corrupt(bad);
    assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game: bad })));
  }
});

test('opposing haulers meet on the actual arc and produce partition-independent combat', async () => {
  const { encounterHour } = await import('./route-encounters');
  let game = advance(createConfiguredGame({ playerCount: 2, mode: 'mining', gravity: true }, 0, 7), 12, { rivals: false });
  game.rules!.gravity = { wells };
  const a = game.rocks.find(r => r.owner === 'you' && r.drones > 0)!;
  const b = game.rocks.find(r => r.owner === 'vesper' && r.drones > 0)!;
  Object.assign(a, { x: 30, y: 50 }); Object.assign(b, { x: 70, y: 50 });
  game = dispatch(dispatch(game, a.id, b.id, 10, 'you'), b.id, a.id, 5, 'vesper');
  game = advance(game, 12.2, { rivals: false });
  const f = game.fleets[0]!, g = game.fleets[1]!;
  const expected = (f.departed + f.arrives) / 2;
  // At launch the solver examines one affine segment at a time; advance schedules every vertex.
  const hit = advance(game, expected + 0.01, { rivals: false });
  assert.equal(hit.fleets.length, 1);
  assert.equal(hit.fleets[0]!.drones, 5);
  const event = hit.events.find(e => e.battle)!;
  assert.ok(event);
  assert.ok(Math.abs(event.hour - expected) < 1e-7);
  assert.ok(Math.abs(event.battle!.y - 50) > 0.5);
  assert.deepEqual(advance(advance(game, expected - 0.123, { rivals: false }), expected + 0.01, { rivals: false }), hit);
  assert.ok(Number.isFinite(encounterHour({ ...game, hour: expected - 0.001 }, f, g)));
});

test('powered interceptors solve a rendezvous with a curved target, including future segments', async () => {
  const { interceptionCourse } = await import('./flight');
  const route = gravityCourse(world, { x: 30, y: 50 }, { x: 70, y: 50 }, 8, 12, 'you')!;
  const fleet = { id: 1, owner: 'you' as const, from: 'a', to: 'b', drones: 1, departed: 12, ...route };
  const w = { ...world, hour: 12, rocks: [] };
  const origin = { x: 50, y: 40 };
  const intercept = interceptionCourse(w, origin, fleet, 16, 12.1)!;
  assert.ok(intercept);
  const target = fleetPosition({ ...w, hour: intercept.arrives }, fleet);
  assert.ok(Math.hypot(target.x - intercept.point.x, target.y - intercept.point.y) < 1e-7);
  assert.ok(Math.abs(Math.hypot(intercept.point.x - origin.x, intercept.point.y - origin.y) / 16 - (intercept.arrives - 12.1)) < 1e-8);
});

test('shared replays retain public gravity, the frozen course, and arc positions', async () => {
  const { createArchive } = await import('./replay');
  const { generateSharedReplay } = await import('../replay/generate');
  const { encodeSharedReplay, decodeSharedReplay } = await import('../replay/codec');
  const { seekReplay, replayFleetPosition } = await import('../replay/playback');
  let game = createConfiguredGame({ playerCount: 2, mode: 'mining', gravity: true }, 0, 7);
  const a = game.rocks.find(r => r.owner === 'you' && r.drones > 0)!;
  const b = game.rocks.find(r => r.owner === 'you' && r.id !== a.id)!;
  game = dispatch(game, a.id, b.id, 1, 'you');
  const hour = (game.fleets[0]!.arrives + game.fleets[0]!.departed) / 2;
  const op = { game: advance(game, hour + 0.01, { rivals: false }), archive: createArchive(game) };
  const replay = decodeSharedReplay(encodeSharedReplay(generateSharedReplay(op, 'you', 0, hour + 0.01)));
  const scene = seekReplay(replay, hour);
  assert.deepEqual(scene.rules!.gravity, game.rules!.gravity);
  assert.deepEqual(replayFleetPosition(scene, scene.fleets[0]!), fleetPosition({ ...game, hour }, game.fleets[0]!));
});

test('local pulse motion and event limits follow the current curve segment', async () => {
  const { pulseAssetMotion, expandingIntersection } = await import('./pulse-contact');
  const { nextFlightVertex } = await import('./flight');
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining', gravity: true }, 0, 7);
  const route = { from: { x: 10, y: 10 }, to: { x: 20, y: 20 }, course: [{ x: 10, y: 10, at: 0 }, { x: 20, y: 10, at: 0.5 }, { x: 20, y: 20, at: 1 }] };
  const f = { id: 1, owner: 'you' as const, from: game.rocks[0]!.id, to: game.rocks[1]!.id, drones: 1, departed: 12, arrives: 14, route };
  game.hour = 12.5;
  assert.deepEqual(pulseAssetMotion(game, f), { point: { x: 15, y: 10 }, velocity: { x: 10, y: 0 } });
  assert.equal(nextFlightVertex(game, f), 13);
  const wave = expandingIntersection(game, { x: 25, y: 10 }, 0, 2, f, 14);
  assert.equal(wave, Infinity, 'a projected hit past the next turn is not a valid current-segment event');
  game.hour = 13;
  assert.deepEqual(pulseAssetMotion(game, f), { point: { x: 20, y: 10 }, velocity: { x: 0, y: 10 } });
});

test('speed changes preserve the remaining arc and do not teleport the hauler', async () => {
  const { refreshUnitEffects } = await import('./specialist-effects');
  const game = advance(createConfiguredGame({ playerCount: 2, mode: 'mining', gravity: true }, 0, 7), 12, { rivals: false });
  const route = gravityCourse(world, { x: 30, y: 50 }, { x: 70, y: 50 }, 8, 12, 'you')!;
  const home = game.rocks.find(r => r.owner === 'you')!;
  game.fleets = [{ id: 1, owner: 'you', from: home.id, to: home.id, drones: 1, specialists: [{ id: 'test-helmsman', kind: 'helmsman', owner: 'you' }], speed: 8, departed: 12, ...route }];
  game.hour = 13;
  const before = fleetPosition(game, game.fleets[0]!);
  const arrival = game.fleets[0]!.arrives;
  refreshUnitEffects(game);
  assert.equal(game.fleets[0]!.speed, 16);
  assert.ok(game.fleets[0]!.route!.course!.length > 2);
  assert.ok(Math.abs(game.fleets[0]!.arrives - (13 + (arrival - 13) / 2)) < 1e-9);
  const after = fleetPosition(game, game.fleets[0]!);
  assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < 1e-9);
});

test('antigravity uses one repulsive shape while owner speed changes integrated ETA', () => {
  const w = { rules: { ...world.rules, gravity: { wells: [{ ...wells[0]!, mass: -0.5, owner: 'you' }] } } };
  const a = { x: 30, y: 50 }, b = { x: 70, y: 50 };
  const friendly = gravityCourse(w, a, b, 8, 12, 'you')!;
  const hostile = gravityCourse(w, a, b, 8, 12, 'vesper')!;
  assert.deepEqual(friendly.route.course!.map(({ x, y }) => ({ x, y })), hostile.route.course!.map(({ x, y }) => ({ x, y })));
  assert.ok(friendly.arrives < hostile.arrives);
});

test('private command replay reconstructs gravity launches without migrating old operations', async () => {
  const { createArchive, applyCommand, replayTo } = await import('./replay');
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining', gravity: true }, 0, 7);
  const source = game.rocks.find(r => r.owner === 'you' && r.drones > 0)!;
  const target = game.rocks.find(r => r.id !== source.id && r.owner === 'you')!;
  const applied = applyCommand(createArchive(game), { type: 'dispatch', owner: 'you', from: source.id, to: target.id, drones: 1 }, { rivals: false, knownThrough: 0 });
  assert.deepEqual(replayTo(applied.archive, 0.4, { rivals: false, knownThrough: 0.4 }), advance(applied.game, 0.4, { rivals: false }));
  const old = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 7, undefined, 18);
  assert.equal(dispatch(old, source.id, target.id, 1, 'you').fleets[0]!.route, undefined);
  assert.equal(old.rules!.mechanicsVersion, 18);
});
