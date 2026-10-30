import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventMessage } from './event-message';
import type { GameView } from '../game/visibility';

const ended: Pick<GameView, 'hour' | 'winner' | 'eliminated' | 'rules'> = {
  hour: 6, winner: 'you', eliminated: ['vesper', 'null'],
};

test('last-survivor announcements preserve stored telemetry and correct both mode claims', () => {
  for (const claim of ['corporate quota secured', 'domination target secured']) {
    const event = { hour: 6, message: `Mnemosyne: ${claim}. Contract complete.` };
    const before = { ...event };
    assert.equal(eventMessage(ended, event), 'Mnemosyne: last intelligence active. Contract complete.');
    assert.deepEqual(event, before);
  }
});

test('real target victories and unrelated telemetry retain their messages', () => {
  const event = { hour: 6, message: 'Mnemosyne: corporate quota secured. Contract complete.' };
  assert.equal(eventMessage({ ...ended, eliminated: [] }, event), event.message);
  assert.equal(eventMessage({ ...ended, winner: null }, event), event.message);
  assert.equal(eventMessage(ended, { ...event, hour: 5 }), event.message);
  assert.equal(eventMessage(ended, { hour: 6, message: 'Haulers fought in transit.' }), 'Haulers fought in transit.');
});

test('specialist signals show current names without changing canonical replay messages', () => {
  const view = { ...ended, winner: null };
  for (const [stored, displayed] of [
    ['1 Combat daemon recruited at the core.', '1 Striker recruited at the core.'],
    ['Foundry: Shield servitor promoted to Defense controller.', 'Foundry: Custodian promoted to Bulwark.'],
    ['Recruit Routing daemon planned for hour 23.00.', 'Recruit Thruster planned for hour 23.00.'],
    ['Foundry: sentry fire destroyed 5 drones.', 'Foundry: watchdog fire destroyed 5 drones.'],
    ['Scavenger rig: target lost or redirected; returning without combat.', 'Interceptor: target lost or redirected; returning without combat.'],
    ['Self-destruct detonation destroyed 2 sites.', 'Meltdown detonation destroyed 2 sites.'],
    ['An interception manifest needs a scavenger rig.', 'An interception manifest needs an interceptor.'],
  ] as const) {
    const event = { hour: 4, message: stored };
    assert.equal(eventMessage(view, event), displayed);
    assert.equal(event.message, stored);
  }
});
