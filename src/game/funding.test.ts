import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame, dispatch } from './simulation';
import { createLegacyGame } from './legacy';
import { setFunding } from './funding';
import { powerCapacity, drillMine } from './economy';
import { decodeSave } from './save-format';
import { observe, forecastObservation } from './visibility';

test('funding is free, requires a twenty-unit lead, stacks per sponsor, and adds power and factory output', () => {
  const initial = createGame(0);
  assert.throws(() => setFunding(initial, 'you', 'vesper', true));
  initial.cargo.you = 20; initial.cargo.null = 20;
  let game = setFunding(initial, 'you', 'vesper', true);
  game = setFunding(game, 'null', 'vesper', true);
  assert.equal(powerCapacity(game, 'vesper'), 350);
  assert.equal(game.cargo.you, 20);
  assert.equal(game.cargo.null, 20);
  assert.equal(advance(game, 8, { rivals: false }).rocks.find(r => r.id === 'f')!.drones, 50);
  assert.equal(powerCapacity(setFunding(game, 'you', 'vesper', false), 'vesper'), 300);
  assert.equal(initial.funding, undefined);
  assert.throws(() => setFunding(initial, 'you', 'you', true));
  assert.throws(() => setFunding(createLegacyGame(0), 'you', 'vesper', true));
});

test('funding expires at the mining event that closes the lead and never revives without a new order', () => {
  let game = createGame(0);
  game.cargo.you = 20;
  game.rocks.find(r => r.id === 'f')!.drones = 50;
  game = drillMine(game, 'f', 'vesper');
  game = setFunding(game, 'you', 'vesper', true);
  const next = game.rocks.find(r => r.id === 'f')!.miningAt!;
  assert.equal(advance(game, next - 0.001, { rivals: false }).funding!.length, 1);
  const ended = advance(game, next, { rivals: false });
  assert.deepEqual(ended.funding, []);
  assert.equal(powerCapacity(ended, 'vesper'), 250);
  ended.cargo.you = 100;
  assert.deepEqual(advance(ended, ended.hour + 0.1, { rivals: false }).funding, []);
  let split = game;
  for (let hour = 0.137; hour < next; hour += 0.137) split = advance(split, hour, { rivals: false });
  assert.deepEqual(advance(split, next, { rivals: false }), advance(game, next, { rivals: false }));
});

test('elimination cancels incoming and outgoing funding while preserving assets and valid saves', () => {
  let game = createGame(0);
  game.cargo.you = 20; game.cargo.null = 40;
  game = setFunding(game, 'you', 'vesper', true);
  game = setFunding(game, 'null', 'you', true);
  game.rocks.find(r => r.id === 'f')!.drones = 100;
  game = dispatch(game, 'f', 'a', 100, 'vesper');
  const end = advance(game, game.fleets[0]!.arrives, { rivals: false });
  assert.ok(end.eliminated.includes('you'));
  assert.deepEqual(end.funding, []);
  assert.equal(powerCapacity(end, 'you'), 100);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: end })).game, end);
  for (const edge of [{ from: 'you', to: 'you' }, { from: 'bogus', to: 'vesper' }]) {
    const broken = { ...createGame(0), funding: [edge] };
    assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game: broken })));
  }
});

test('observers see public cargo standings and funding counts, while sponsor identities stay with the parties', () => {
  let game = createGame(0); game.cargo.you = 40; game.cargo.vesper = 20;
  game = setFunding(game, 'you', 'vesper', true);
  const stranger = observe(game, 'null');
  assert.deepEqual(stranger.funding, []);
  assert.equal(stranger.standings!.vesper.funders, 1);
  assert.equal(stranger.standings!.you.cargo, 40);
  const anonymousForecast = forecastObservation(stranger, 'null', 8);
  assert.equal(anonymousForecast.fundingUncertain, true);
  assert.equal(anonymousForecast.standings!.vesper.funders, 1);
  assert.deepEqual(observe(game, 'vesper').funding, [{ from: 'you', to: 'vesper' }]);
  assert.deepEqual(observe(game, 'you').funding, [{ from: 'you', to: 'vesper' }]);
  const predicted = forecastObservation(observe(game, 'vesper'), 'vesper', 8);
  assert.equal(predicted.rocks.find(r => r.id === 'f')!.drones, 48);
  assert.deepEqual(game.funding, [{ from: 'you', to: 'vesper' }]);
});
