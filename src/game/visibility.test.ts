import { createLegacyGame as createGame } from './legacy';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, dispatch, installModule } from './simulation';
import { forecastObservation, observe } from './visibility';

test('observations omit hidden rock data, enemy cargo, unseen haulers, and global sequence numbers', () => {
  let game = createGame(0);
  game = dispatch(game, 'e', 'j', 40, 'vesper');
  const view = observe(game, 'you');
  const hidden = view.rocks.find(r => r.id === 'e')!;
  assert.equal(hidden.known, false);
  for (const field of ['owner', 'drones', 'module', 'coreOf']) assert.ok(!(field in hidden));
  assert.equal(view.rocks.find(r => r.id === 'b')!.known, true);
  assert.equal(view.fleets.length, 0);
  assert.deepEqual(view.cargo, { you: 0 });
  assert.ok(!('nextId' in view));
  assert.ok(!view.events.some(e => e.message.includes('Faraday')));
});


test('sensor boundaries are inclusive and a mobile scout reveals then loses distant contacts', () => {
  const boundary = createGame(0);
  boundary.rocks[1]!.x = 54; boundary.rocks[1]!.y = 73;
  assert.equal(observe(boundary, 'you').rocks[1]!.known, true);
  boundary.rocks[1]!.x += 0.001;
  assert.equal(observe(boundary, 'you').rocks[1]!.known, false);
  let game = installModule(createGame(0), 'e', 'virus', 'vesper');
  game = dispatch(game, 'a', 'e', 1, 'you');
  assert.equal(observe(game, 'you').rocks[4]!.known, false);
  const near = observe(advance(game, 6, { rivals: false }), 'you');
  assert.equal(near.rocks[4]!.known, true);
  assert.equal(near.rocks[4]!.module, 'virus');
  assert.ok(!near.events.some(e => e.message.includes('constructed')), 'new visibility cannot reveal old construction');
  const lost = observe(advance(game, 8, { rivals: false }), 'you');
  assert.equal(lost.rocks[4]!.known, false);
  assert.ok(lost.events.some(e => e.message.includes('transfer neutralized')), 'participants retain battle telemetry');
});

test('forecasts leave hidden arrival outcomes unknown and do not mutate the observation', () => {
  const game = dispatch(createGame(0), 'a', 'e', 10, 'you');
  const view = observe(game, 'you');
  const original = JSON.stringify(view);
  const transit = forecastObservation(view, 'you', 4);
  assert.equal(transit.fleets.length, 1);
  assert.equal(transit.fleets[0]!.id, view.fleets[0]!.id);
  const future = forecastObservation(view, 'you', 8);
  assert.equal(future.rocks[4]!.known, false);
  assert.ok(!('owner' in future.rocks[4]!));
  assert.deepEqual(future.uncertain, ['e']);
  assert.ok(future.events.some(e => e.message.includes('outcome unknown')));
  assert.equal(future.winner, null);
  assert.equal(JSON.stringify(view), original);
  assert.throws(() => forecastObservation(view, 'you', -1));
});

test('observed launch order survives opaque IDs when forecasting simultaneous module arrivals', () => {
  const equipped = installModule(createGame(0), 'a', 'charge', 'you');
  const wave = dispatch(dispatch(equipped, 'a', 'b', 10, 'you', true), 'a', 'b', 10, 'you');
  const scrambled = { ...wave, fleets: [...wave.fleets].reverse() };
  const observed = observe(scrambled, 'you', id => 1000 - id);
  assert.equal(scrambled.fleets[0]!.id, 2, 'observation does not sort authoritative state in place');
  const inTransit = forecastObservation(observed, 'you', 1);
  assert.deepEqual(inTransit.fleets.map(f => f.id), [999, 998]);
  const predicted = forecastObservation(observed, 'you', 3);
  assert.equal(predicted.rocks[1]!.owner, 'you');
  assert.equal(predicted.rocks[1]!.drones, 10);
});

test('legacy unscoped events and out-of-range module construction never reach a player view', () => {
  const game = createGame(0);
  game.events.unshift({ hour: 0, message: 'Legacy secret order.' });
  const changed = installModule(game, 'e', 'routing', 'vesper');
  const you = observe(changed, 'you');
  const vesper = observe(changed, 'vesper');
  assert.ok(!you.events.some(e => e.message.includes('constructed')));
  assert.ok(!you.events.some(e => e.message.includes('Legacy')));
  assert.ok(vesper.events.some(e => e.message.includes('constructed')));
  assert.ok(you.events.every(e => !('audience' in e)));
});

test('unseen activity cannot crowd out an observer telemetry history', () => {
  let game = dispatch(createGame(0), 'a', 'b', 1, 'you');
  game.rocks[4]!.drones = 10000;
  for (let i = 0; i < 100; i++) {
    game = installModule(game, 'e', 'routing', 'vesper');
    game = dispatch(game, 'e', 'j', 1, 'vesper', true);
  }
  const yourEvents = observe(game, 'you').events;
  assert.ok(yourEvents.some(e => e.message.includes('1 drones dispatched to Cinder')));
  assert.ok(yourEvents.length <= 80);
  assert.ok(observe(game, 'vesper').events.length <= 80);
});

test('private scheduled launches participate in forecasts without resolving unknown destinations', async () => {
  const { scheduleTransfer } = await import('./orders');
  const queued = scheduleTransfer(createGame(0), { id: 'hidden-future-order-01', owner: 'you', from: 'a', to: 'e', drones: 20, executeAt: 1 });
  assert.equal(observe(queued, 'vesper').scheduled.length, 0);
  assert.ok(!observe(queued, 'vesper').events.some(e => e.message.includes('planned')));
  const own = observe(queued, 'you');
  assert.equal(own.scheduled.length, 1);
  const underway = forecastObservation(own, 'you', 2);
  assert.equal(underway.scheduled.length, 0);
  assert.equal(underway.fleets.length, 1);
  assert.ok(underway.fleets[0]!.id < 0, 'forecast-created units have local IDs');
  const arrived = forecastObservation(own, 'you', 9);
  assert.equal(arrived.rocks[4]!.known, false);
  assert.deepEqual(arrived.uncertain, ['e']);
  assert.equal(arrived.fleets.length, 0);
});

test('interception target references are scoped and a lost contact creates forecast uncertainty', async () => {
  const { dispatchIntercept } = await import('./interception');
  let game = installModule(createGame(0), 'a', 'scavenger', 'you');
  game = advance(dispatch(game, 'e', 'a', 40, 'vesper'), 4, { rivals: false });
  game = dispatchIntercept(game, 'a', game.fleets[0]!.id, 50, 'you');
  const known = observe(game, 'you', id => 1000 + id);
  assert.equal(known.fleets.find(f => f.intercept)!.intercept!.target, 1001);
  const predicted = forecastObservation(known, 'you', 8);
  assert.equal(predicted.rocks[0]!.module, 'scavenger');
  assert.equal(predicted.rocks[0]!.drones, 64);
  const target = game.fleets.find(f => f.owner === 'vesper')!;
  target.from = 'e'; target.to = 'e'; target.returning = true; target.module = 'scavenger';
  target.route = { from: { x: 51, y: 61 }, to: { x: 80, y: 49 } }; target.departed = 4;
  game = advance(game, 5, { rivals: false });
  const lost = observe(game, 'you', id => 1000 + id);
  assert.equal(lost.fleets.length, 1);
  assert.ok(!('target' in lost.fleets[0]!.intercept!));
  const uncertain = forecastObservation(lost, 'you', 8);
  assert.equal(uncertain.interceptionUncertain, true);
  assert.equal(uncertain.fleets.length, 0, 'no invented return from an unobserved encounter');
});

import { createGame as createParityGame, type Fleet } from './simulation';
import { rockSensorRange, sensors, observers } from './sensors';

function sensorWorld() {
  const game = createParityGame(0);
  game.rocks = game.rocks.map((r, i) => ({ ...r, x: i * 100, y: 0, owner: i === 0 ? 'you' : 'vesper', kind: 'factory', specialists: [] }));
  game.fleets = [];
  return game;
}
function remoteShip(id: number, extra: Partial<Fleet> = {}): Fleet {
  return { id, owner: 'vesper', from: 'e', to: 'b', drones: 7, departed: 0, arrives: 20, route: { from: { x: 200, y: 0 }, to: { x: 300, y: 0 } }, ...extra };
}

test('v2 sonar comes only from owned outposts, with inclusive coverage and no mobile event audience', () => {
  const game = sensorWorld();
  game.fleets = [remoteShip(1, { owner: 'you' })];
  game.rocks[1]!.x = 200;
  assert.equal(sensors(game, 'you').length, 1);
  assert.equal(observe(game, 'you').rocks[1]!.known, false);
  assert.ok(!observers(game, { x: 200, y: 0 }).includes('you'));
  game.rocks[1]!.x = 32;
  assert.equal(observe(game, 'you').rocks[1]!.known, true);
  game.rocks[1]!.x += 0.001;
  assert.equal(observe(game, 'you').rocks[1]!.kind, 'unknown');
});

test('v2 own and incoming ships remain visible remotely without exposing foreign preparation or stale intercept destinations', () => {
  const game = sensorWorld();
  game.fleets = [remoteShip(1, { owner: 'you' }), remoteShip(2, { to: 'a', giftAt: 0 }), remoteShip(3, { intercept: { home: 'e', target: 1 } }), remoteShip(4, { to: 'a', preparing: true }), remoteShip(5, { to: 'a', intercept: { home: 'e', target: 99 } }), remoteShip(6), remoteShip(7, { owner: 'you', preparing: true })];
  const view = observe(game, 'you', id => id + 100);
  assert.deepEqual(view.fleets.map(f => f.id), [101, 102, 103, 107]);
  assert.equal(view.fleets[2]!.intercept!.target, 101);
  game.rocks[0]!.owner = 'null';
  game.fleets[0]!.owner = 'null';
  assert.deepEqual(observe(game, 'you').fleets.map(f => f.id), [7]);
});

test('v2 remote types reveal only public mines or active Intelligence Officer knowledge', () => {
  const game = sensorWorld();
  game.rocks[2]!.kind = 'mine';
  let view = observe(game, 'you');
  assert.equal(view.rocks[1]!.kind, 'unknown');
  assert.equal(view.rocks[2]!.kind, 'mine');
  game.fleets = [remoteShip(1, { owner: 'you', specialists: [{ id: 'intel', kind: 'intelligence', owner: 'you' }] })];
  view = observe(game, 'you');
  assert.equal(view.rocks[1]!.kind, 'factory');
  assert.equal(view.rocks[1]!.known, false);
  assert.ok(!('owner' in view.rocks[1]!));
  game.fleets[0]!.specialists![0]!.captive = true;
  assert.equal(observe(game, 'you').rocks[1]!.kind, 'unknown');
});

test('v2 Princess local and Intelligence Officer global ranges include preparing units but exclude captives', () => {
  const game = sensorWorld();
  game.rocks[0]!.specialists = [{ id: 'p', owner: 'you', kind: 'princess' }];
  game.fleets = [remoteShip(1, { owner: 'you', from: 'a', preparing: true, specialists: [{ id: 'i', owner: 'you', kind: 'intelligence' }] })];
  assert.equal(rockSensorRange(game, game.rocks[0]!), 56);
  game.rocks[1]!.x = 56;
  assert.equal(observe(game, 'you').rocks[1]!.known, true);
  game.rocks[0]!.specialists[0]!.captive = true;
  assert.equal(rockSensorRange(game, game.rocks[0]!), 40);
});

test('v2 observations and forecasts are detached and preserve unknown remote types and outcomes', () => {
  const game = sensorWorld();
  game.rocks[0]!.specialists = [{ id: 'q', owner: 'you', kind: 'queen' }];
  game.fleets = [remoteShip(1, { owner: 'you', from: 'a' })];
  const saved = structuredClone(game);
  const view = observe(game, 'you');
  const snapshot = structuredClone(view);
  const future = forecastObservation(view, 'you', 21);
  assert.equal(future.rocks[1]!.kind, 'unknown');
  assert.equal(future.rocks[1]!.known, false);
  assert.ok(future.uncertain.includes('b'));
  assert.deepEqual(view, snapshot);
  view.rocks[0]!.specialists![0]!.kind = 'princess';
  assert.deepEqual(game, saved);
});

test('v2 foreign preparation is private even inside sonar and mobile Princess has no local range effect', () => {
  const game = sensorWorld();
  game.fleets = [remoteShip(1, { preparing: true, route: { from: { x: 0, y: 0 }, to: { x: 10, y: 0 } } }), remoteShip(2, { owner: 'you', specialists: [{ id: 'p', owner: 'you', kind: 'princess' }] })];
  assert.deepEqual(observe(game, 'you').fleets.map(f => f.id), [2]);
  assert.equal(rockSensorRange(game, game.rocks[0]!), 32);
  game.fleets[1]!.specialists = [{ id: 'i', owner: 'vesper', kind: 'intelligence' }];
  assert.equal(observe(game, 'you').rocks[1]!.kind, 'unknown', 'foreign or mismatched officers do not reveal types');
  assert.equal(rockSensorRange(game, game.rocks[0]!), 32);
});
