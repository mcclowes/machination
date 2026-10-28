import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame } from './simulation';
import { scheduleTransfer } from './orders';
import { orderHour, inspectionOffset } from './time-machine';

test('an order issued in the Time Machine launches at the inspected minute using future inventory', () => {
  const live = createGame(0);
  const inspectedHour = 6 + 17 / 60;
  const forecast = advance(live, inspectedHour, { rivals: false });
  const drones = Math.floor(forecast.rocks[0]!.drones);
  const queued = scheduleTransfer(live, { id: 'time-machine-order-01', owner: 'you', from: 'a', to: 'b', drones, executeAt: orderHour(live.hour, inspectedHour, 0) });
  assert.equal(live.fleets.length, 0);
  assert.equal(queued.rocks[0]!.drones, 90);
  assert.equal(advance(queued, inspectedHour - 1 / 60, { rivals: false }).fleets.length, 0);
  const launched = advance(queued, inspectedHour, { rivals: false });
  assert.equal(launched.fleets[0]!.departed, inspectedHour);
  assert.equal(launched.fleets[0]!.drones, drones);
});

test('inspection stays at an absolute time across polling and scheduling never exceeds its horizon', () => {
  assert.equal(inspectionOffset(2, 8.5), 6.5);
  assert.equal(inspectionOffset(3, 8.5), 5.5);
  assert.equal(inspectionOffset(9, 8.5), 0);
  assert.equal(orderHour(2, null, 0), 2);
  assert.equal(orderHour(2, 8.5, 1), 9.5);
  assert.equal(orderHour(9, 8.5, 0), 9);
  assert.equal(orderHour(2, 170, 0), 170);
  for (const delay of [1, -1, NaN, Infinity]) assert.throws(() => orderHour(2, 170, delay));
});
