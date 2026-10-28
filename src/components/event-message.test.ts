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
