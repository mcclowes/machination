import assert from 'node:assert/strict';
import test from 'node:test';
import { inactivityRemaining, presenceDue } from './presence';

const due = (now: number, lastActivity: number) => presenceDue({ now, lastActivity, active: true, eligible: true });

test('periodic presence waits a full minute after the last activity', () => {
  assert.equal(due(159_999, 100_000), false);
  assert.equal(due(160_000, 100_000), true);
  assert.equal(due(200_000, 100_000), true);
  assert.equal(due(90_000, 100_000), false);
});
test('remaining inactivity uses the server clock, rounds minutes up, and never goes negative', () => {
  assert.equal(inactivityRemaining(172_801_000, 1_000), '48h 0m');
  assert.equal(inactivityRemaining(3_601_001, 1_000), '1h 1m');
  assert.equal(inactivityRemaining(1_000, 2_000), '0h 0m');
});

test('background and ineligible seats never refresh, even on a foreground event', () => {
  const request = { now: 200_000, lastActivity: 100_000, active: true, eligible: true, foregroundEvent: true };
  assert.equal(presenceDue({ ...request, active: false }), false);
  assert.equal(presenceDue({ ...request, eligible: false }), false);
  assert.equal(presenceDue({ ...request, now: 100_001 }), true);
});
