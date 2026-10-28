import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame, dispatch } from './simulation';
import { powerCapacity, maximumShield } from './economy';
import { promoteSpecialist } from './specialists';
import { fleetPosition } from './flight';
import { decodeSave } from './save-format';

test('assemblers boost factories within half their site sensor range without boosting distant industry', () => {
  const game = createGame(0);
  game.rocks.find(r => r.id === 'm')!.specialists!.push({ id: 'assembler-test', owner: 'you', kind: 'foreman' });
  const end = advance(game, 8, { rivals: false });
  assert.equal(end.rocks.find(r => r.id === 'c')!.drones, 50);
  assert.equal(end.rocks.find(r => r.id === 'a')!.drones, 6);
});

test('energy controllers and capacitors change power, while shield controllers affect capacity globally and locally', () => {
  const game = createGame(0);
  game.rocks.find(r => r.id === 'n')!.specialists!.push({ id: 'capacitor-test', owner: 'you', kind: 'tinkerer' });
  game.rocks.find(r => r.id === 'a')!.specialists!.push({ id: 'energy-test', owner: 'you', kind: 'energy' });
  assert.equal(powerCapacity(game, 'you'), 610);
  game.rocks.find(r => r.id === 'n')!.specialists!.push({ id: 'security-test', owner: 'you', kind: 'security' });
  const end = advance(game, 1, { rivals: false });
  assert.equal(maximumShield(end.rocks.find(r => r.id === 'n')!), 40);
  assert.equal(maximumShield(end.rocks.find(r => r.id === 'a')!), 40);
  assert.equal(powerCapacity(end, 'you'), 670);
});

test('industrial controllers accelerate production cycles and add local output without polling drift', () => {
  const game = createGame(0);
  game.rocks.find(r => r.id === 'c')!.specialists!.push({ id: 'tycoon-test', owner: 'you', kind: 'tycoon' });
  const at = 8 / 1.5;
  const end = advance(game, at, { rivals: false });
  assert.equal(end.rocks.find(r => r.id === 'c')!.drones, 49);
  assert.equal(end.rocks.find(r => r.id === 'a')!.drones, 6);
  let polled = game;
  for (let h = 0.137; h < at; h += 0.137) polled = advance(polled, h, { rivals: false });
  assert.deepEqual(advance(polled, at, { rivals: false }), end);
});

test('capacitors drain three shield units per hour and sentries fire at exact two-hour boundaries', () => {
  const game = createGame(0);
  const powered = game.rocks.find(r => r.id === 'n')!;
  powered.shield = 20;
  powered.specialists!.push({ id: 'draining-test', owner: 'you', kind: 'tinkerer' });
  game.rocks.find(r => r.id === 'c')!.specialists!.push({ id: 'sentry-test', owner: 'you', kind: 'sentry' });
  const attacking = dispatch(game, 'f', 'c', 40, 'vesper');
  assert.equal(advance(attacking, 1, { rivals: false }).rocks.find(r => r.id === 'n')!.shield, 17);
  const shot = advance(attacking, 6, { rivals: false });
  assert.equal(shot.fleets[0]!.drones, 38);
  let polled = attacking;
  for (let h = 0.137; h < 6; h += 0.137) polled = advance(polled, h, { rivals: false });
  assert.deepEqual(advance(polled, 6, { rivals: false }), shot);
});

test('fleet controllers change in-flight speed without teleporting haulers or corrupting their saved route', () => {
  let game = advance(createGame(0), 4, { rivals: false });
  game.rocks.find(r => r.id === 'a')!.specialists!.push({ id: 'admiral-promotion', owner: 'you', kind: 'navigator' });
  game = advance(dispatch(game, 'c', 'f', 20, 'you'), 5, { rivals: false });
  const before = game.fleets[0]!; const point = fleetPosition(game, before);
  const promoted = promoteSpecialist(game, 'you', 'admiral-promotion');
  const accelerated = promoted.fleets[0]!;
  assert.deepEqual(fleetPosition(promoted, accelerated), point);
  assert.equal(accelerated.speed, 12);
  assert.ok(Math.abs((accelerated.arrives - game.hour) - (before.arrives - game.hour) / 1.5) < 1e-9);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: promoted })).game, promoted);
});
