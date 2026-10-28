import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame, dispatch } from './simulation';
import { drillMine } from './economy';
import { decodeSave } from './save-format';
import { observe } from './visibility';

function mined() { const game = createGame(0); game.rocks.find(r => r.id === 'c')!.drones = 50; return drillMine(game, 'c', 'you'); }
test('mines pay one cargo at a time across the day instead of one daily lump', () => {
  const game = mined();
  assert.equal(advance(game, 4.799, { rivals: false }).cargo.you, 0);
  assert.equal(advance(game, 4.8, { rivals: false }).cargo.you, 1);
  assert.equal(advance(game, 23.99, { rivals: false }).cargo.you, 4);
  assert.equal(advance(game, 24, { rivals: false }).cargo.you, 5);
});
test('territorial expansion changes mining rate while preserving progress toward the next cargo unit', () => {
  const game = dispatch(mined(), 'm', 'b', 10, 'you');
  const arrival = game.fleets[0]!.arrives;
  const expanded = advance(game, arrival, { rivals: false });
  const next = arrival + (4.8 - arrival) / 4.8 * 4;
  assert.equal(expanded.rocks.find(r => r.id === 'c')!.miningAt, next);
  assert.equal(advance(expanded, next - 0.001, { rivals: false }).cargo.you, 0);
  assert.equal(advance(expanded, next, { rivals: false }).cargo.you, 1);
});
test('mine clocks are independent, deterministic across polling, and persisted without losing partial progress', () => {
  let game = advance(mined(), 1, { rivals: false }); game.rocks.find(r => r.id === 'n')!.drones = 100;
  game = drillMine(game, 'n', 'you');
  assert.equal(advance(game, 4.8, { rivals: false }).cargo.you, 1);
  assert.equal(advance(game, 5.8, { rivals: false }).cargo.you, 2);
  let polled = game;
  for (let hour = 1.137; hour < 48; hour += 0.137) polled = advance(polled, hour, { rivals: false });
  const direct = advance(game, 48, { rivals: false });
  assert.deepEqual(advance(polled, 48, { rivals: false }), direct);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: direct })).game, direct);
});
test('old daily mine clocks migrate their remaining progress without inventing historical cargo', () => {
  const game = mined(); game.hour = 12;
  for (const rock of game.rocks) { rock.productionAt = 16; rock.shieldAt = 16; }
  const mine = game.rocks.find(r => r.id === 'c')!; mine.miningAt = 24; delete mine.miningInterval;
  const migrated = advance(game, 12, { rivals: false });
  assert.equal(migrated.cargo.you, 0);
  assert.equal(migrated.rocks.find(r => r.id === 'c')!.miningAt, 14.4);
  assert.equal(mine.miningAt, 24);
});

test('a destroyed mine no longer advertises active mining outside sonar', () => {
  const game = createGame(0); const mine = game.rocks.find(r => r.id === 'j')!;
  mine.kind = 'mine'; mine.destroyed = true;
  assert.equal(observe(game, 'you').rocks.find(r => r.id === 'j')!.kind, 'unknown');
});

test('territorial loss slows remaining mines without discarding partial progress', () => {
  const base = mined(); base.rocks.find(r => r.id === 'f')!.drones = 100;
  const game = dispatch(base, 'f', 'n', 100, 'vesper');
  const arrival = game.fleets[0]!.arrives;
  const before = advance(game, arrival - 0.000001, { rivals: false });
  const oldNext = before.rocks.find(r => r.id === 'c')!.miningAt!;
  const captured = advance(game, arrival, { rivals: false });
  const mine = captured.rocks.find(r => r.id === 'c')!;
  assert.equal(mine.miningInterval, 6);
  assert.equal(mine.miningAt, arrival + (oldNext - arrival) / 4.8 * 6);
});

test('the quota ends the operation at the next unit payout rather than the end of the day', () => {
  const game = mined(); game.cargo.you = 199;
  const end = advance(game, 100, { rivals: false });
  assert.equal(end.hour, 4.8);
  assert.equal(end.cargo.you, 200);
  assert.equal(end.winner, 'you');
  assert.deepEqual(advance(advance(game, 4.7, { rivals: false }), 100, { rivals: false }), end);
});

test('saved mine intervals reject impossible or non-advancing clock values', () => {
  for (const interval of [0, 1e-100, 25, NaN]) {
    const game = mined(); game.rocks.find(r => r.id === 'c')!.miningInterval = interval;
    assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game })));
  }
});
