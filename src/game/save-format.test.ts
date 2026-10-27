import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSave } from './save-format';
import { advance, createGame, dispatch } from './simulation';

test('round-trips active and completed operations through the save boundary', () => {
  const active = advance(dispatch(createGame(0), 'a', 'b', 20, 'you'), 2);
  for (const game of [createGame(0), active, advance(active, 1000)]) {
    const saved = { savedAt: 1000, game };
    assert.deepEqual(decodeSave(JSON.stringify(saved)), saved);
  }
});

test('refuses damaged or unsupported saves rather than exposing invalid state', () => {
  const saved = () => ({ savedAt: 1000, game: createGame(0) });
  const invalid: unknown[] = [null, {}, { game: {} }, { ...saved(), savedAt: -1 }];
  const wrongVersion = saved(); wrongVersion.game.version = 2 as 1; invalid.push(wrongVersion);
  const wrongOwner = saved(); wrongOwner.game.rocks[0]!.owner = 'rogue' as 'you'; invalid.push(wrongOwner);
  const negative = saved(); negative.game.rocks[0]!.drones = -1; invalid.push(negative);
  const duplicate = saved(); duplicate.game.rocks[1]!.id = 'a'; invalid.push(duplicate);
  const cargo = saved(); cargo.game.cargo.you = NaN; invalid.push(cargo);
  for (const data of invalid) assert.throws(() => decodeSave(JSON.stringify(data)));
  assert.throws(() => decodeSave('{broken'));
});
