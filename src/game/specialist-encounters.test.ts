import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame, dispatch, type Game } from './simulation';
import type { SpecialistKind } from './specialist-catalog';
import { decodeSave } from './save-format';

function encounter(a: SpecialistKind, b: SpecialistKind, dronesA = 20, dronesB = 30): { game: Game; hour: number } {
  let game = createGame(0);
  game.rocks.find(r => r.id === 'c')!.specialists!.push({ id: 'encounter-a', kind: a, owner: 'you' });
  game.rocks.find(r => r.id === 'f')!.specialists!.push({ id: 'encounter-b', kind: b, owner: 'vesper' });
  game = dispatch(game, 'c', 'f', dronesA, 'you', false, ['encounter-a']);
  game = dispatch(game, 'f', 'c', dronesB, 'vesper', false, ['encounter-b']);
  const [first, second] = game.fleets;
  const ta = first!.arrives - first!.departed; const tb = second!.arrives - second!.departed;
  return { game, hour: (1 + first!.departed / ta + second!.departed / tb) / (1 / ta + 1 / tb) };
}

test('shield breakers end encounters after earlier conversion effects but before drone combat', () => {
  const { game, hour } = encounter('infiltrator', 'thief');
  const end = advance(game, hour, { rivals: false });
  assert.equal(end.fleets.length, 2);
  assert.deepEqual(end.fleets.map(f => f.drones), [17, 33]);
});

test('handoff viruses swap haulers and modules before assassin effects apply', () => {
  const { game, hour } = encounter('doubleAgent', 'assassin');
  const end = advance(game, hour, { rivals: false });
  assert.equal(end.fleets.length, 2);
  assert.deepEqual(end.fleets.map(f => [f.owner, f.drones, f.specialists![0]!.owner]), [['vesper', 0, 'vesper'], ['you', 0, 'you']]);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: end })).game, end);
});

test('diversion worms redirect their opponent before conversion or drone losses', () => {
  const { game, hour } = encounter('saboteur', 'thief');
  const end = advance(game, hour, { rivals: false });
  const redirected = end.fleets.find(f => f.owner === 'vesper')!;
  assert.equal(redirected.drones, 30);
  assert.equal(redirected.returning, true);
  assert.equal(redirected.courseLocked, true);
  assert.equal(end.rocks.find(r => r.id === redirected.to)!.owner, 'vesper');
  assert.equal(end.fleets.find(f => f.owner === 'you')!.drones, 20);
});

test('surviving haulers capture enemy modules and send them home in a real return convoy', () => {
  const { game, hour } = encounter('helmsman', 'thief', 40, 10);
  const end = advance(game, hour, { rivals: false });
  const captive = end.fleets.find(f => f.specialists?.some(u => u.id === 'encounter-b'))!;
  assert.equal(captive.owner, 'you');
  assert.equal(captive.drones, 0);
  assert.equal(captive.specialists![0]!.captive, true);
  assert.equal(captive.specialists![0]!.owner, 'vesper');
  assert.ok(captive.arrives > hour);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: end })).game, end);
});
