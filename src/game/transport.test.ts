import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame, dispatch, travelHours } from './simulation';
import { cancelLaunch, editLaunch, LAUNCH_PREPARATION } from './transport';
import { fleetPosition } from './flight';
import { decodeSave } from './save-format';
import { drillMine } from './economy';
import { giftTransfer, cancelGift } from './gifts';

test('launches prepare for ten minutes with reserved drones and can be edited or canceled before departure', () => {
  const game = createGame(0);
  const queued = dispatch(game, 'c', 'b', 20, 'you');
  const fleet = queued.fleets[0]!;
  assert.equal(fleet.departed, LAUNCH_PREPARATION);
  assert.equal(fleet.preparing, true);
  assert.equal(queued.rocks.find(r => r.id === 'c')!.drones, 20);
  assert.deepEqual(fleetPosition(queued, fleet), { x: 10, y: 56 });
  const edited = editLaunch(queued, fleet.id, 'you', 30);
  assert.equal(edited.fleets[0]!.drones, 30);
  assert.equal(edited.fleets[0]!.departed, fleet.departed);
  const canceled = cancelLaunch(edited, fleet.id, 'you');
  assert.equal(canceled.fleets.length, 0);
  assert.equal(canceled.rocks.find(r => r.id === 'c')!.drones, 40);
  assert.throws(() => cancelLaunch(queued, fleet.id, 'vesper'));
  const departed = advance(queued, fleet.departed, { rivals: false });
  assert.ok(!departed.fleets[0]!.preparing);
  assert.throws(() => cancelLaunch(departed, fleet.id, 'you'));
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: queued })).game, queued);
});

test('opposing ordinary haulers fight on their shared route and the survivor continues its original leg', () => {
  let game = dispatch(createGame(0), 'c', 'f', 40, 'you');
  game = dispatch(game, 'f', 'c', 20, 'vesper');
  const first = game.fleets[0]!;
  const meeting = first.departed + (first.arrives - first.departed) / 2;
  assert.equal(advance(game, meeting - 0.001, { rivals: false }).fleets.length, 2);
  const met = advance(game, meeting, { rivals: false });
  assert.equal(met.fleets.length, 1);
  assert.equal(met.fleets[0]!.owner, 'you');
  assert.equal(met.fleets[0]!.drones, 20);
  assert.equal(met.fleets[0]!.arrives, first.arrives);
  assert.equal(met.fleets[0]!.to, 'f');
  let stepped = game;
  for (let h = 0.13; h < meeting; h += 0.13) stepped = advance(stepped, h, { rivals: false });
  assert.deepEqual(advance(stepped, meeting, { rivals: false }), met);
});

test('reserved drones defend their departure site if combat arrives before launch', () => {
  const base = createGame(0);
  const source = base.rocks.find(r => r.id === 'c')!;
  source.shieldsDisabled = true;
  const attacking = dispatch(base, 'f', 'c', 20, 'vesper');
  const arrival = attacking.fleets[0]!.arrives;
  const before = advance(attacking, arrival - 0.05, { rivals: false });
  const preparing = dispatch(before, 'c', 'b', 40, 'you');
  const end = advance(preparing, arrival, { rivals: false });
  assert.equal(end.rocks.find(r => r.id === 'c')!.drones, before.rocks.find(r => r.id === 'c')!.drones - 20);
  assert.equal(end.fleets.filter(f => f.owner === 'you').length, 0);
});

test('core loss stops orders and mining while territory, production, and launched haulers persist', () => {
  let game = createGame(0);
  game.rocks.find(r => r.id === 'n')!.drones = 50;
  game = drillMine(game, 'n', 'you');
  game.cargo.you = 100;
  game.rocks.find(r => r.id === 'f')!.drones = 100;
  game = dispatch(game, 'c', 'e', 20, 'you');
  game = dispatch(game, 'f', 'a', 100, 'vesper');
  const arrival = game.fleets.find(f => f.owner === 'vesper')!.arrives;
  const eliminated = advance(game, arrival, { rivals: false });
  assert.ok(eliminated.eliminated.includes('you'));
  assert.equal(eliminated.rocks.find(r => r.id === 'c')!.owner, 'you');
  assert.equal(eliminated.fleets.find(f => f.owner === 'you')!.drones, 20);
  assert.equal(eliminated.cargo.you, 0);
  assert.throws(() => dispatch(eliminated, 'c', 'b', 1, 'you'));
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: eliminated })).game, eliminated);
});

test('gifts stay with the donor until contact and transfer to the current destination owner without combat', () => {
  const game = giftTransfer(createGame(0), 'c', 'f', 20, 'you', 'vesper');
  assert.equal(game.fleets[0]!.owner, 'you');
  assert.equal(game.fleets[0]!.giftAt, LAUNCH_PREPARATION);
  assert.equal(cancelGift(game, game.fleets[0]!.id, 'you').fleets[0]!.giftAt, undefined);
  const launched = advance(game, LAUNCH_PREPARATION, { rivals: false });
  assert.throws(() => cancelGift(launched, game.fleets[0]!.id, 'you'));
  const destination = launched.rocks.find(r => r.id === 'f')!;
  destination.owner = 'null';
  const arrived = advance(launched, game.fleets[0]!.arrives, { rivals: false });
  assert.equal(arrived.rocks.find(r => r.id === 'f')!.owner, 'null');
  assert.equal(arrived.rocks.find(r => r.id === 'f')!.drones, destination.drones + (game.fleets[0]!.arrives >= 8 ? 6 : 0) + 20);
});

test('new operations use continuous distance-based transit instead of rounding every voyage to whole hours', () => {
  const game = createGame(0);
  const from = game.rocks.find(r => r.id === 'c')!; const to = game.rocks.find(r => r.id === 'b')!;
  const exact = Math.hypot(from.x - to.x, from.y - to.y) / 8;
  const launched = dispatch(game, from.id, to.id, 20, 'you');
  assert.equal(launched.fleets[0]!.arrives, LAUNCH_PREPARATION + exact);
  assert.equal(travelHours(from, to, undefined, 2), exact);
});

test('a passing enemy hauler accepts a gift and sends it to its nearest friendly site', () => {
  let game = giftTransfer(createGame(0), 'c', 'f', 20, 'you', 'vesper');
  game = dispatch(game, 'f', 'c', 30, 'vesper');
  const gift = game.fleets[0]!;
  const hour = gift.departed + (gift.arrives - gift.departed) / 2;
  const met = advance(game, hour, { rivals: false });
  assert.equal(met.fleets.length, 2);
  assert.ok(met.fleets.every(f => f.owner === 'vesper'));
  const received = met.fleets.find(f => f.id === gift.id)!;
  assert.equal(received.drones, 20);
  assert.ok(received.returning);
  assert.equal(met.rocks.find(r => r.id === received.to)!.owner, 'vesper');
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: met })).game, met);
});
