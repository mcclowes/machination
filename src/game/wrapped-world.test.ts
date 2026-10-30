import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, advance, type Game } from './simulation';
import { fleetPosition } from './flight';

function wrappedGame(): Game {
  const game = createGame(0);
  game.rules = { players: ['you', 'vesper', 'null'], mode: 'mining', victoryTarget: 200,
    map: { generator: 'balanced.v2', topology: 'torus', seed: 0, width: 100, height: 100 } };
  Object.assign(game.rocks[0]!, { x: 2, y: 50, drones: 40 });
  Object.assign(game.rocks[1]!, { x: 98, y: 50, drones: 40 });
  return game;
}
test('ordinary transfers take the short edge route and cross the seam continuously', () => {
  const start = wrappedGame();
  const game = dispatch(start, 'a', 'b', 10, 'you');
  const fleet = game.fleets[0]!;
  assert.equal(fleet.arrives - fleet.departed, 0.5);
  assert.deepEqual(fleetPosition({ ...game, hour: fleet.departed + 0.375 }, fleet), { x: 99, y: 50 });
  assert.equal(advance(game, fleet.arrives).fleets.length, 0);
  assert.equal(start.rocks[0]!.drones, 40);
});

test('sonar and event audiences cover neighbors across both map seams without revealing distant sites', async () => {
  const { observe } = await import('./visibility');
  const { observers } = await import('./sensors');
  const game = wrappedGame();
  for (const rock of game.rocks.filter(r => r.owner === 'you')) Object.assign(rock, { x: 2, y: 2 });
  Object.assign(game.rocks[1]!, { x: 98, y: 98, owner: 'vesper' });
  Object.assign(game.rocks.find(r => r.id === 'i')!, { x: 55, y: 55 });
  const view = observe(game, 'you');
  assert.equal(view.rocks.find(r => r.id === 'b')!.known, true);
  assert.equal(view.rocks.find(r => r.id === 'i')!.known, false);
  assert.ok(observers(game, { x: 98, y: 98 }).includes('you'));
  const planar = { ...game, rules: undefined };
  assert.equal(observe(planar, 'you').rocks.find(r => r.id === 'b')!.known, false);
});

test('opposing edge-route haulers meet at the seam and resolve once across split polling', () => {
  const start = wrappedGame();
  Object.assign(start.rocks[1]!, { owner: 'vesper' });
  const game = dispatch(dispatch(start, 'a', 'b', 20, 'you'), 'b', 'a', 10, 'vesper');
  const contact = game.fleets[0]!.departed + 0.25;
  const met = advance(game, contact);
  assert.equal(met.fleets.length, 1);
  assert.equal(met.fleets[0]!.owner, 'you');
  assert.equal(met.fleets[0]!.drones, 10);
  assert.deepEqual(advance(met, contact + 0.1), advance(game, contact + 0.1));
});

test('scavengers rendezvous with a seam-crossing target before and after it wraps', async () => {
  const { dispatchIntercept } = await import('./interception');
  for (const hour of [0.2, 0.35]) {
    const start = wrappedGame();
    Object.assign(start.rocks[1]!, { owner: 'vesper' });
    const source = start.rocks.find(r => r.id === 'c')!;
    Object.assign(source, { x: 1.9, y: 50, drones: 40 });
    source.specialists!.push({ id: 'edge-pirate', kind: 'pirate', owner: 'you' });
    const moving = advance(dispatch(start, 'b', 'a', 10, 'vesper'), hour);
    const launched = dispatchIntercept(moving, 'c', moving.fleets[0]!.id, 20, 'you', true, ['edge-pirate']);
    const rig = launched.fleets.find(f => f.intercept)!;
    assert.ok(rig.arrives < moving.fleets[0]!.arrives);
    const met = advance(launched, rig.arrives);
    assert.equal(met.fleets.length, 1);
    assert.equal(met.fleets[0]!.drones, 10);
    assert.equal(met.fleets[0]!.returning, true);
    assert.equal(met.fleets[0]!.to, 'c');
  }
});

test('released captives choose the nearest friendly site across an edge and travel the short return leg', async () => {
  const { releaseSpecialist } = await import('./specialist-travel');
  const game = wrappedGame();
  Object.assign(game.rocks[1]!, { owner: 'vesper' });
  game.rocks[1]!.specialists = [{ id: 'edge-captive', owner: 'you', kind: 'engineer', captive: true }];
  const released = releaseSpecialist(game, 'vesper', 'edge-captive');
  const fleet = released.fleets[0]!;
  assert.equal(fleet.to, 'a');
  assert.equal(fleet.arrives - fleet.departed, 0.5);
  assert.deepEqual(fleetPosition({ ...released, hour: 0.375 }, fleet), { x: 1, y: 50 });
});

test('navigator redirection preserves the current position and uses a short wrapped leg', async () => {
  const { changeCourse } = await import('./specialist-navigation');
  const game = wrappedGame();
  game.rocks[0]!.specialists!.push({ id: 'edge-navigator', owner: 'you', kind: 'navigator' });
  Object.assign(game.rocks.find(r => r.id === 'd')!, { x: 99, y: 54 });
  const moving = advance(dispatch(game, 'a', 'b', 10, 'you', false, ['edge-navigator']), 0.3);
  const fleet = moving.fleets[0]!;
  const point = fleetPosition(moving, fleet);
  const changed = changeCourse(moving, fleet.id, 'you', 'd');
  const redirected = changed.fleets[0]!;
  assert.deepEqual(fleetPosition(changed, redirected), point);
  const dx = 99 - point.x - 100;
  assert.ok(Math.abs(redirected.arrives - changed.hour - Math.hypot(dx, 4) / redirected.speed!) < 1e-9);
});

test('a global speed promotion after crossing an edge preserves position and remaining route', async () => {
  const { promoteSpecialist } = await import('./specialists');
  const start = wrappedGame();
  start.hour = 4;
  start.rocks[1]!.owner = 'you';
  start.rocks[0]!.specialists!.push({ id: 'edge-admiral', owner: 'you', kind: 'navigator' });
  const moving = advance(dispatch(start, 'b', 'a', 10, 'you'), 4.5);
  const original = moving.fleets[0]!;
  const point = fleetPosition(moving, original);
  const promoted = promoteSpecialist(moving, 'you', 'edge-admiral');
  const faster = promoted.fleets[0]!;
  assert.deepEqual(fleetPosition(promoted, faster), point);
  assert.ok(Math.abs((faster.arrives - moving.hour) - (original.arrives - moving.hour) / 1.5) < 1e-9);
});

test('foreman production reaches a friendly factory across the seam', () => {
  const game = wrappedGame();
  game.rocks[1]!.owner = 'you';
  game.rocks[0]!.drones = 0;
  game.rocks[0]!.specialists!.push({ id: 'edge-foreman', owner: 'you', kind: 'foreman' });
  const produced = advance(game, 8);
  assert.equal(produced.rocks[1]!.drones, 50);
});

test('sentry fire reaches a traveling enemy across an edge', () => {
  const game = wrappedGame();
  game.rocks[0]!.specialists!.push({ id: 'edge-sentry', owner: 'you', kind: 'sentry' });
  Object.assign(game.rocks[1]!, { owner: 'vesper' });
  Object.assign(game.rocks.find(r => r.id === 'd')!, { x: 98, y: 90 });
  const launched = dispatch(game, 'b', 'd', 40, 'vesper');
  assert.equal(advance(launched, 2).fleets[0]!.drones, 38);
});

test('diplomats release friendly captives held across the seam', () => {
  const game = wrappedGame();
  game.rocks[0]!.specialists!.push({ id: 'edge-envoy', owner: 'you', kind: 'diplomat' });
  Object.assign(game.rocks[1]!, { owner: 'vesper', specialists: [{ id: 'held-engineer', owner: 'you', kind: 'engineer', captive: true }] });
  const freed = advance(game, 0.01);
  assert.equal(freed.rocks[1]!.specialists!.length, 0);
  assert.equal(freed.fleets[0]!.specialists![0]!.id, 'held-engineer');
  assert.equal(freed.fleets[0]!.to, 'a');
});

test('fallback succession selects the nearest core across a seam', async () => {
  const { reconcileLeadership } = await import('./specialist-combat');
  const game = wrappedGame();
  game.rocks[0]!.specialists = [];
  game.rocks[1]!.owner = 'you';
  game.rocks[1]!.specialists = [{ id: 'near-fallback', kind: 'princess', owner: 'you' }];
  game.rocks.find(r => r.id === 'c')!.specialists = [{ id: 'far-fallback', kind: 'princess', owner: 'you' }];
  reconcileLeadership(game, ['you'], game.rocks[0]!);
  assert.equal(game.rocks[1]!.specialists![0]!.kind, 'queen');
});

test('a detonation reaches sites and traveling haulers across a corner seam', async () => {
  const { detonate } = await import('./destruction');
  const game = wrappedGame();
  Object.assign(game.rocks[0]!, { x: 2, y: 2 });
  Object.assign(game.rocks[1]!, { x: 98, y: 98, owner: 'vesper' });
  game.fleets.push({ id: 1, owner: 'vesper', from: 'b', to: 'd', drones: 10, departed: 0, arrives: 1, route: { from: { x: 98, y: 98 }, to: { x: 96, y: 98 } } });
  detonate(game, game.rocks[0]!);
  assert.equal(game.rocks[1]!.destroyed, true);
  assert.equal(game.fleets.length, 0);
  assert.equal(game.rocks.find(r => r.id === 'i')!.destroyed, undefined);
});

test('new configured games retain torus rules through saves while old configured maps stay planar', async () => {
  const { createConfiguredGame } = await import('./world');
  const { decodeSave } = await import('./save-format');
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 2);
  assert.equal(game.rules!.map.topology, 'torus');
  assert.equal(game.rules!.map.generator, 'balanced.v2');
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game })).game, game);
  const old = structuredClone(game);
  old.rules!.map.generator = 'balanced.v1'; delete old.rules!.map.topology; delete old.rules!.gravity;
  assert.equal(decodeSave(JSON.stringify({ savedAt: 0, game: old })).game.rules!.map.topology, undefined);
  const bad = structuredClone(game); delete bad.rules!.map.topology;
  assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game: bad })));
});

test('a 24-hour planar training replay written by the previous engine still loads unchanged', async () => {
  const { readFile } = await import('node:fs/promises');
  const { decodeOperation } = await import('./operation-save');
  const raw = await readFile('src/game/fixtures/planar-replay-aec9546.json', 'utf8');
  const loaded = decodeOperation(raw, 86_400_000);
  assert.deepEqual(loaded.game, JSON.parse(raw).game);
});
