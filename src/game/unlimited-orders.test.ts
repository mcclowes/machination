import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfiguredGame } from './world';
import { advance } from './simulation';
import { scheduleTransfer, cancelTransfer } from './orders';
import { scheduleAction } from './future-actions';
import { observe, forecastObservation } from './visibility';
import { decodeSave } from './save-format';

test('a private mixed queue beyond twenty orders persists, forecasts, and executes without reserving resources', () => {
  let game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 123);
  const [from, to] = game.rocks.filter(r => r.owner === 'you' && r.drones > 0);
  const inventory = from!.drones;
  for (let i = 0; i < 25; i++) {
    game = scheduleTransfer(game, { id: `unlimited-transfer-${String(i).padStart(4, '0')}`, owner: 'you', from: from!.id, to: to!.id, drones: 1, executeAt: 1 });
    game = scheduleAction(game, { id: `unlimited-shields-${String(i).padStart(4, '0')}`, owner: 'you', executeAt: 1, action: { type: 'shields', rock: from!.id, disabled: i % 2 === 0 } });
  }
  assert.equal(game.scheduled!.length, 50);
  assert.equal(game.rocks.find(r => r.id === from!.id)!.drones, inventory);
  assert.equal(observe(game, 'vesper').scheduled.length, 0);
  const loaded = decodeSave(JSON.stringify({ savedAt: 0, game })).game;
  assert.deepEqual(loaded, game);
  const live = observe(loaded, 'you', id => id + 1000);
  const forecast = forecastObservation(live, 'you', 1);
  const result = advance(loaded, 1, { rivals: false });
  assert.equal(result.scheduled!.length, 0);
  assert.equal(result.fleets.length, 25);
  assert.equal(result.rocks.find(r => r.id === from!.id)!.drones, inventory - 25);
  assert.equal(result.rocks.find(r => r.id === from!.id)!.shieldsDisabled, true);
  assert.deepEqual(forecast.fleets.map(f => f.id).sort((a, b) => a - b), observe(result, 'you', id => id + 1000).fleets.map(f => f.id).sort((a, b) => a - b));
  assert.equal(cancelTransfer(game, game.scheduled![0]!.id, 'you').scheduled!.length, 49);
});
