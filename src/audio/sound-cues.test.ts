import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cueForUpdate, type CueView } from './sound-cues';

function view(overrides: Partial<CueView> = {}): CueView {
  return { epoch: 1, rocks: [{ owner: 'you' }, { owner: 'vesper' }], fleets: [], scheduled: [], events: [], eliminated: [], winner: null, ...overrides };
}
const event = (message: string, hour = 1) => ({ hour, message });

test('stays silent without a comparable previous view', () => {
  assert.equal(cueForUpdate(undefined, view(), 'you'), null);
  assert.equal(cueForUpdate(view(), view({ epoch: 2, events: [event('x')] }), 'you'), null);
  assert.equal(cueForUpdate(view(), view(), 'you'), null);
});

test('outcomes outrank everything else', () => {
  const busy: Partial<CueView> = { events: [event('Vesper: core destroyed. Operations terminated.')], rocks: [{ owner: 'you' }, { owner: 'you' }] };
  assert.equal(cueForUpdate(view(), view({ ...busy, winner: 'you' }), 'you'), 'victory');
  assert.equal(cueForUpdate(view(), view({ ...busy, winner: 'vesper' }), 'you'), 'defeat');
  assert.equal(cueForUpdate(view(), view({ eliminated: ['you'] }), 'you'), 'defeat');
  assert.equal(cueForUpdate(view({ winner: 'you' }), view({ winner: 'you', events: [event('x')] }), 'you'), 'signal');
});

test('territory changes follow outcomes', () => {
  assert.equal(cueForUpdate(view(), view({ rocks: [{ owner: 'you' }, { owner: 'you' }] }), 'you'), 'capture');
  assert.equal(cueForUpdate(view(), view({ rocks: [{ owner: 'vesper' }, { owner: 'vesper' }] }), 'you'), 'loss');
});

test('new telemetry is classified by severity', () => {
  assert.equal(cueForUpdate(view(), view({ events: [event('Mnemosyne: core lost. Orders and extraction terminated.')] }), 'you'), 'alarm');
  assert.equal(cueForUpdate(view(), view({ events: [event('Ceres: Vesper transfer neutralized.'), event('Ceres: mine drilled for 50 drones.')] }), 'you'), 'combat');
  assert.equal(cueForUpdate(view(), view({ events: [event('Ceres: mine drilled for 50 drones.')] }), 'you'), 'signal');
});

test('only events newer than the previous head count', () => {
  const old = event('Ceres: Vesper transfer neutralized.');
  assert.equal(cueForUpdate(view({ events: [old] }), view({ events: [event('Ceres: mine drilled.', 2), { ...old }] }), 'you'), 'signal');
});

test('your launches and plans are acknowledged', () => {
  const fleet = { owner: 'you' as const };
  assert.equal(cueForUpdate(view(), view({ fleets: [fleet], events: [event('Mnemosyne: 5 drones dispatched to Ceres.')] }), 'you'), 'launch');
  assert.equal(cueForUpdate(view(), view({ fleets: [{ owner: 'vesper' }] }), 'you'), null);
  assert.equal(cueForUpdate(view(), view({ scheduled: [{ owner: 'you' }] }), 'you'), 'schedule');
});
