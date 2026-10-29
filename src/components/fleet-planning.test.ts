import { test } from 'node:test';
import assert from 'node:assert/strict';
import { futureCommandFleets, observedInterceptionIds } from './fleet-planning';
import { createConfiguredGame } from '../game/world';
import { scheduleTransfer } from '../game/orders';
import { observe, forecastObservation } from '../game/visibility';
import type { Fleet } from '../game/simulation';

const fleet = (id: number, owner: Fleet['owner'] = 'you'): Fleet => ({ id, owner, from: 'a', to: 'b', drones: 5, departed: 0, arrives: 10 });

test('future commands include only owned live or stable queued IDs still present in the forecast', () => {
  const live = { fleets: [fleet(101), fleet(102, 'vesper'), fleet(103)], scheduled: [
    { id: 'stable-plan', owner: 'you' as const, from: 'a', to: 'b', drones: 5, executeAt: 1, fleetId: 201 },
    { id: 'legacy-plan', owner: 'you' as const, from: 'a', to: 'b', drones: 5, executeAt: 1 },
    { id: 'rival-plan', owner: 'vesper' as const, from: 'a', to: 'b', drones: 5, executeAt: 1, fleetId: 202 },
  ] };
  const forecast = { fleets: [fleet(101), fleet(102), fleet(201), fleet(202), fleet(999)] };
  assert.deepEqual(futureCommandFleets(forecast, live, 'you').map(f => f.id), [101, 201]);
  assert.deepEqual(observedInterceptionIds(live, 'you'), [102]);
});

test('stable queued aliases are commandable before departure in a real forecast', () => {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 123);
  const [from, to] = game.rocks.filter(r => r.owner === 'you');
  const queued = scheduleTransfer(game, { id: 'ui-stable-launch001', owner: 'you', from: from!.id, to: to!.id, drones: 5, executeAt: 1 });
  const live = observe(queued, 'you', id => id + 1000);
  const forecast = forecastObservation(live, 'you', 1.02);
  const commandable = futureCommandFleets(forecast, live, 'you');
  assert.equal(commandable.length, 1);
  assert.equal(commandable[0]!.preparing, true);
  assert.equal(commandable[0]!.id, live.scheduled[0]!.fleetId);
});

test('legacy forecasts never expose synthetic queued fleet IDs as command targets', () => {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 123);
  game.rules!.mechanicsVersion = 3;
  delete game.rules!.driftingBases;
  const [from, to] = game.rocks.filter(r => r.owner === 'you');
  const queued = scheduleTransfer(game, { id: 'ui-legacy-launch001', owner: 'you', from: from!.id, to: to!.id, drones: 5, executeAt: 1 });
  const live = observe(queued, 'you');
  const forecast = forecastObservation(live, 'you', 1.02);
  assert.equal(forecast.fleets.length, 1);
  assert.deepEqual(futureCommandFleets(forecast, live, 'you'), []);
});
