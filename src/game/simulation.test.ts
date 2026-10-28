import { createLegacyGame as createGame } from './legacy';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, advance, travelHours, operationStatus } from './simulation';

test('dispatch reserves drones immediately and arrives only after travel time', () => {
  const game = createGame(0);
  const from = game.rocks[0]!;
  const to = game.rocks[1]!;
  const sent = dispatch(game, from.id, to.id, 30, 'you');
  assert.equal(sent.rocks[0]!.drones, from.drones - 30);
  assert.equal(game.rocks[0]!.drones, from.drones);
  const eta = travelHours(from, to);
  assert.equal(advance(sent, eta - 0.01).fleets.length, 1);
  assert.equal(advance(sent, eta).fleets.length, 0);
  assert.equal(advance(sent, eta).rocks[1]!.owner, 'you');
});

test('a core capture eliminates its intelligence, assets, and incoming fleets', () => {
  let game = createGame(0);
  game.rocks = game.rocks.map(r => ({ ...r, drones: r.id === 'a' ? 500 : 0 }));
  game.rocks.find(r => r.id === 'e')!.drones = 20;
  game = dispatch(game, 'e', 'a', 1, 'vesper');
  game = dispatch(game, 'a', 'e', 400, 'you');
  const end = advance(game, travelHours(game.rocks[0]!, game.rocks[4]!));
  assert.ok(end.eliminated.includes('vesper'));
  assert.equal(end.rocks.find(r => r.id === 'f')!.owner, null);
  assert.ok(end.fleets.every(f => f.owner !== 'vesper'));
});

test('economy and rival orders are identical across large and incremental advances', () => {
  const game = createGame(0);
  const jumped = advance(game, 48);
  let stepped = game;
  for (let h = 0.25; h <= 48; h += 0.25) stepped = advance(stepped, h);
  assert.deepEqual(stepped, jumped);
  assert.ok(jumped.fleets.length || jumped.events.length > 1);
  assert.deepEqual(game, createGame(0));
});

test('rejects invalid orders without mutating the operation', () => {
  const game = createGame(0);
  for (const count of [0, -1, 0.5, 91, NaN, Infinity]) assert.throws(() => dispatch(game, 'a', 'b', count, 'you'));
  assert.throws(() => dispatch(game, 'e', 'a', 10, 'you'));
  assert.throws(() => dispatch(game, 'a', 'a', 10, 'you'));
  assert.throws(() => advance(game, -1));
  assert.throws(() => advance(game, Infinity));
  assert.deepEqual(game, createGame(0));
});

test('ties preserve ownership and friendly haulers reinforce', () => {
  let game = createGame(0);
  game = dispatch(game, 'a', 'b', 14, 'you');
  const tied = advance(game, 3);
  assert.equal(tied.rocks[1]!.owner, null);
  assert.equal(tied.rocks[1]!.drones, 0);
  game = dispatch(game, 'a', 'c', 12, 'you');
  const reinforced = advance(game, 4);
  assert.equal(reinforced.rocks[2]!.drones, 36 + 16 + 12);
});

test('mining quota ends an operation and freezes subsequent simulation', () => {
  const game = createGame(0);
  game.rocks[1]!.owner = 'you';
  game.cargo.you = 299;
  const end = advance(game, 1);
  assert.equal(end.winner, 'you');
  assert.equal(operationStatus(end, 'you'), 'victory');
  assert.equal(end.cargo.you, 300);
  assert.deepEqual(advance(end, 100), end);
  assert.throws(() => dispatch(end, 'a', 'b', 1, 'you'));
});

test('quota victory occurs at the same instant regardless of time step', () => {
  const game = createGame(0);
  game.rocks[1]!.owner = 'you';
  game.cargo.you = 299;
  assert.deepEqual(advance(game, 10), advance(game, 0.5));
});

test('a rival quota victory ends the contract without claiming the player core was lost', () => {
  const game = createGame(0);
  assert.equal(operationStatus(game, 'you'), 'active');
  game.cargo.vesper = 299;
  const end = advance(game, 1);
  assert.equal(end.winner, 'vesper');
  assert.equal(end.eliminated.includes('you'), false);
  assert.equal(end.rocks.find(r => r.coreOf === 'you')!.owner, 'you');
  assert.equal(operationStatus(end, 'you'), 'defeat');
  assert.equal(operationStatus(end, 'vesper'), 'victory');
});

test('core elimination remains distinct while rivals continue the operation', () => {
  let game = createGame(0);
  game.rocks.find(r => r.id === 'a')!.drones = 0;
  game = dispatch(game, 'e', 'a', 90, 'vesper');
  const end = advance(game, 8, { rivals: false });
  assert.equal(end.eliminated.includes('you'), true);
  assert.equal(end.winner, null);
  assert.equal(operationStatus(end, 'you'), 'eliminated');
  assert.equal(operationStatus(end, 'vesper'), 'active');
  assert.equal(operationStatus({ ...end, winner: 'vesper' }, 'you'), 'eliminated');
});
