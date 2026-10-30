import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeListing, describeSolo } from './operation-labels';

const listing = { id: 'a'.repeat(24), faction: 'you' as const, mode: 'mining' as const, players: 4, seated: 2, started: false, hour: 0, status: 'active' as const };

test('listings describe recruitment, progress, and results in a short line', () => {
  assert.equal(describeListing(listing), 'Mining · Waiting for players 2/4');
  assert.equal(describeListing({ ...listing, mode: 'pulse', seated: 4, started: true, hour: 30.7 }), 'King’s Pulse · Hour 30 · 4 players');
  assert.equal(describeListing({ ...listing, started: true, seated: 4, hour: 90, status: 'victory' }), 'Mining · Victory at hour 90');
});

test('solo summaries name the hour, rivals, and mode', () => {
  assert.equal(describeSolo({ hour: 12.9, rivals: 1, mode: 'domination', status: 'active' }), 'Hour 12 · 1 rival · Domination');
  assert.equal(describeSolo({ hour: 0, rivals: 3, status: 'active' }), 'Hour 0 · 3 rivals');
});
