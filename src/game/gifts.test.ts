import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame, dispatch, installModule } from './simulation';
import { giftTransfer } from './gifts';
import { observe, forecastObservation } from './visibility';
import { decodeSave } from './save-format';

function neighbors() {
  const game = createGame(0);
  game.rocks.find(r => r.id === 'b')!.owner = 'vesper';
  return game;
}
test('a gift transfers ownership and loaded modules at launch, with recipient sensors and friendly arrival', () => {
  const start = installModule(neighbors(), 'a', 'charge', 'you');
  const game = giftTransfer(start, 'a', 'b', 20, 'you', 'vesper', true);
  assert.equal(start.rocks[0]!.drones, 70);
  assert.equal(game.rocks[0]!.drones, 50);
  assert.equal(game.rocks[0]!.module, undefined);
  assert.equal(game.fleets[0]!.owner, 'vesper');
  assert.equal(game.fleets[0]!.module, 'charge');
  assert.ok(observe(game, 'vesper').coverage.some(s => s.x === 22 && s.y === 73 && s.radius === 16));
  assert.ok(observe(game, 'vesper').events.some(e => e.message.includes('gifted')));
  assert.ok(!observe(game, 'null').events.some(e => e.message.includes('gifted')));
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game })).game, game);
  const arrived = advance(game, 3, { rivals: false });
  assert.equal(arrived.rocks[1]!.drones, 34);
  assert.equal(arrived.rocks[1]!.owner, 'vesper');
  assert.equal(arrived.rocks[1]!.module, 'charge');
  assert.equal(arrived.fleets.length, 0);
  const forecast = forecastObservation(observe(game, 'vesper'), 'vesper', 3);
  assert.equal(forecast.rocks[1]!.drones, 34);
});
test('gifts follow recipient combat rules if a destination changes hands', () => {
  const game = giftTransfer(neighbors(), 'a', 'b', 20, 'you', 'vesper');
  game.rocks[1]!.owner = 'null'; game.rocks[1]!.drones = 5;
  const end = advance(game, 3, { rivals: false });
  assert.equal(end.rocks[1]!.owner, 'vesper');
  assert.equal(end.rocks[1]!.drones, 15);
  assert.equal(end.eliminated.length, 0);
});
test('gift survival belongs to the recipient, including after donor core loss', () => {
  const start = neighbors(); start.rocks[0]!.drones = 1000;
  let game = giftTransfer(start, 'a', 'b', 20, 'you', 'vesper');
  game.rocks[4]!.drones = 1000; game.rocks[0]!.drones = 0;
  game.rocks[4]!.x = 23; game.rocks[4]!.y = 73;
  game = dispatch(game, 'e', 'a', 100, 'vesper');
  const afterCoreLoss = advance(game, 1, { rivals: false });
  assert.ok(afterCoreLoss.eliminated.includes('you'));
  assert.ok(afterCoreLoss.fleets.some(f => f.id === 1 && f.owner === 'vesper'));
  const end = advance(game, 8, { rivals: false });
  assert.ok(end.eliminated.includes('you'));
  assert.equal(end.rocks[1]!.drones, 34);
  const recipientLost = giftTransfer(neighbors(), 'a', 'b', 20, 'you', 'vesper');
  recipientLost.rocks[0]!.drones = 1000; recipientLost.rocks[4]!.drones = 0;
  recipientLost.rocks[4]!.x = 23; recipientLost.rocks[4]!.y = 73;
  const eliminated = advance(dispatch(recipientLost, 'a', 'e', 100, 'you'), 8, { rivals: false });
  assert.ok(eliminated.eliminated.includes('vesper'));
  assert.equal(eliminated.fleets.length, 0);
  assert.equal(eliminated.rocks[1]!.drones, 14, 'undelivered gift disappears with its recipient');
});
test('gift validation never permits hidden, neutral, self, eliminated, or unauthorized recipients', () => {
  const game = neighbors();
  for (const to of ['e', 'd', 'c', 'missing']) assert.throws(() => giftTransfer(game, 'a', to, 10, 'you', 'vesper'));
  assert.throws(() => giftTransfer(game, 'a', 'b', 10, 'you', 'you'));
  assert.throws(() => giftTransfer(game, 'c', 'b', 1000, 'you', 'vesper'));
  assert.throws(() => giftTransfer(game, 'b', 'a', 5, 'you', 'vesper'));
  assert.throws(() => giftTransfer(game, 'a', 'b', 5, 'you', '__proto__' as 'vesper'));
  assert.throws(() => giftTransfer(game, 'a', 'b', 5, 'you', 'vesper', true));
  game.eliminated.push('vesper');
  assert.throws(() => giftTransfer(game, 'a', 'b', 5, 'you', 'vesper'));
});
