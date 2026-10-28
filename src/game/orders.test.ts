import { createLegacyGame as createGame } from './legacy';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, dispatch, installModule } from './simulation';
import { cancelTransfer, scheduleTransfer } from './orders';

test('a queued transfer uses future production and launches exactly at its scheduled hour', () => {
  const start = createGame(0);
  const queued = scheduleTransfer(start, { id: 'future-transfer-0001', owner: 'you', from: 'a', to: 'b', drones: 100, executeAt: 3 });
  assert.equal(queued.rocks[0]!.drones, 90);
  assert.equal(queued.fleets.length, 0);
  const before = advance(queued, 2.99, { rivals: false });
  assert.equal(before.fleets.length, 0);
  const launched = advance(queued, 3, { rivals: false });
  assert.equal(launched.fleets[0]!.departed, 3);
  assert.equal(launched.fleets[0]!.arrives, 6);
  assert.equal(launched.rocks[0]!.drones, 2);
  assert.equal(launched.scheduled!.length, 0);
  assert.equal(advance(launched, 6, { rivals: false }).rocks[1]!.owner, 'you');
});

test('competing plans execute in submission order without partial launches or retries', () => {
  let game = createGame(0);
  for (let i = 0; i < 2; i++) game = scheduleTransfer(game, { id: `competing-order-000${i}`, owner: 'you', from: 'a', to: 'b', drones: 60, executeAt: 1 });
  const end = advance(game, 2, { rivals: false });
  assert.equal(end.fleets.length, 1);
  assert.equal(end.fleets[0]!.drones, 60);
  assert.equal(end.rocks[0]!.drones, 38);
  assert.equal(end.scheduled!.length, 0);
  assert.ok(end.events.some(e => e.message.includes('aborted') && e.message.includes('inventory')));
});

test('arrivals reinforce or capture departure rocks before plans at the same time', () => {
  const base = createGame(0);
  base.rocks[2]!.drones = 10;
  const reinforced = dispatch(base, 'a', 'c', 60, 'you');
  const planned = scheduleTransfer(reinforced, { id: 'reinforced-launch-01', owner: 'you', from: 'c', to: 'b', drones: 50, executeAt: 4 });
  const end = advance(planned, 4, { rivals: false });
  assert.equal(end.fleets[0]!.from, 'c');
  assert.equal(end.fleets[0]!.departed, 4);
  assert.equal(end.rocks[2]!.drones, 36);
  const attacked = createGame(0);
  attacked.rocks[2]!.drones = 0;
  attacked.rocks[6]!.drones = 500;
  const lost = scheduleTransfer(dispatch(attacked, 'g', 'c', 100, 'null'), { id: 'captured-launch-0001', owner: 'you', from: 'c', to: 'b', drones: 1, executeAt: 5 });
  const resolved = advance(lost, 5, { rivals: false });
  assert.equal(resolved.rocks[2]!.owner, 'null');
  assert.equal(resolved.fleets.length, 0);
  assert.ok(resolved.events.some(e => e.message.includes('aborted')));
});

test('a pinned module cannot be silently substituted and cancellation is owner-only', () => {
  const equipped = installModule(createGame(0), 'a', 'routing', 'you');
  const queued = scheduleTransfer(equipped, { id: 'module-transfer-0001', owner: 'you', from: 'a', to: 'b', drones: 30, executeAt: 2, carryModule: true });
  const plan = queued.scheduled![0]!; assert.ok(!('action' in plan));
  assert.equal(plan.module, 'routing');
  assert.throws(() => cancelTransfer(queued, 'module-transfer-0001', 'vesper'));
  const canceled = cancelTransfer(queued, 'module-transfer-0001', 'you');
  assert.equal(advance(canceled, 3, { rivals: false }).fleets.length, 0);
  const moved = dispatch(queued, 'a', 'c', 1, 'you', true);
  const aborted = advance(moved, 2, { rivals: false });
  assert.equal(aborted.fleets.length, 1);
  assert.equal(aborted.fleets[0]!.to, 'c');
  assert.ok(aborted.events.some(e => e.message.includes('planned module')));
});

test('core elimination and quota victory remove future plans before they can launch', () => {
  const game = createGame(0);
  game.rocks[0]!.drones = 0;
  game.rocks[4]!.drones = 1000;
  const attacked = dispatch(game, 'e', 'a', 100, 'vesper');
  const queued = scheduleTransfer(attacked, { id: 'eliminated-plan-0001', owner: 'you', from: 'c', to: 'b', drones: 1, executeAt: 12 });
  const lost = advance(queued, 8, { rivals: false });
  assert.ok(lost.eliminated.includes('you'));
  assert.equal(lost.scheduled!.length, 0);
  const winning = createGame(0); winning.rocks[1]!.owner = 'you'; winning.cargo.you = 299;
  const atQuota = scheduleTransfer(winning, { id: 'quota-priority-0001', owner: 'you', from: 'a', to: 'b', drones: 1, executeAt: 0.5 });
  const won = advance(atQuota, 1, { rivals: false });
  assert.equal(won.winner, 'you');
  assert.equal(won.fleets.length, 0);
  assert.equal(won.scheduled!.length, 0);
});

test('plans validate horizons, counts, ownership, capacity, and scoped IDs', () => {
  const game = createGame(0);
  const valid = { id: 'validated-order-0001', owner: 'you' as const, from: 'a', to: 'b', drones: 1, executeAt: 1 };
  for (const executeAt of [-1, 0, 169, NaN, Infinity]) assert.throws(() => scheduleTransfer(game, { ...valid, executeAt }));
  for (const drones of [0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => scheduleTransfer(game, { ...valid, drones }));
  assert.throws(() => scheduleTransfer(game, { ...valid, from: 'e' }));
  let full = game;
  for (let i = 0; i < 20; i++) full = scheduleTransfer(full, { ...valid, id: `capacity-order-${i.toString().padStart(4, '0')}` });
  assert.throws(() => scheduleTransfer(full, valid));
  const yours = scheduleTransfer(game, valid);
  const both = scheduleTransfer(yours, { ...valid, owner: 'vesper', from: 'e' });
  assert.equal(both.scheduled!.length, 2, 'another seat cannot probe a private ID collision');
  let stepped = yours;
  for (let hour = 0.25; hour <= 6; hour += 0.25) stepped = advance(stepped, hour, { rivals: false });
  assert.deepEqual(stepped, advance(yours, 6, { rivals: false }));
});

test('polling at fractional hours cannot prevent a launch funded by exactly one hour of production', () => {
  for (const step of [0.01, 0.03, 0.07, 0.1, 0.11, 0.13, 0.137]) {
    let game = scheduleTransfer(createGame(0), { id: 'exact-production-0001', owner: 'you', from: 'a', to: 'b', drones: 94, executeAt: 1 });
    for (let hour = step; hour < 1; hour += step) game = advance(game, hour, { rivals: false });
    const end = advance(game, 1, { rivals: false });
    assert.equal(end.fleets.length, 1, `poll step ${step}`);
    assert.equal(end.fleets[0]!.drones, 94);
    assert.equal(end.rocks[0]!.drones, 0);
  }
});
