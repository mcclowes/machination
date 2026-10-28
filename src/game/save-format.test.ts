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

test('legacy saves remain valid and optional rock and hauler modules are validated', async () => {
  const { installModule } = await import('./simulation');
  const legacy = createGame(0);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: legacy })).game, legacy);
  const equipped = installModule(legacy, 'a', 'routing', 'you');
  const moving = dispatch(equipped, 'a', 'b', 30, 'you', true);
  for (const game of [equipped, moving, advance(moving, 2, { rivals: false })]) {
    assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game })).game, game);
  }
  const badRock = JSON.parse(JSON.stringify({ savedAt: 0, game: equipped }));
  badRock.game.rocks[0].module = 'missing';
  assert.throws(() => decodeSave(JSON.stringify(badRock)));
  const badFleet = JSON.parse(JSON.stringify({ savedAt: 0, game: moving }));
  badFleet.game.fleets[0].module = 'missing';
  assert.throws(() => decodeSave(JSON.stringify(badFleet)));
});

test('old event history loads but malformed visibility audiences are refused', () => {
  const game = createGame(0);
  game.events = [{ hour: 0, message: 'Legacy event without an audience.' }];
  assert.equal(decodeSave(JSON.stringify({ savedAt: 0, game })).game.events.length, 1);
  const malformed = JSON.parse(JSON.stringify({ savedAt: 0, game }));
  malformed.game.events[0].audience = ['rogue'];
  assert.throws(() => decodeSave(JSON.stringify(malformed)));
});

test('scheduled transfers persist while legacy saves without a queue still load', async () => {
  const { scheduleTransfer } = await import('./orders');
  const game = scheduleTransfer(createGame(0), { id: 'persisted-plan-0001', owner: 'you', from: 'a', to: 'b', drones: 100, executeAt: 3 });
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game })).game, game);
  const old = createGame(0); delete old.scheduled;
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: old })).game, old);
  const malformed = JSON.parse(JSON.stringify({ savedAt: 0, game }));
  malformed.game.scheduled[0].executeAt = 0;
  assert.throws(() => decodeSave(JSON.stringify(malformed)));
  malformed.game.scheduled[0].executeAt = 3;
  malformed.game.scheduled[0].module = 'unknown';
  assert.throws(() => decodeSave(JSON.stringify(malformed)));
});
