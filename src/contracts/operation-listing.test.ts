import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operationListingResponse } from './operation-listing';

const row = { id: 'a'.repeat(24), faction: 'you', mode: 'mining', players: 4, seated: 2, started: false, hour: 0, status: 'active' };

test('operation listings accept well-formed rows and reject anything else', () => {
  assert.deepEqual(operationListingResponse({ operations: [row] }), [row]);
  assert.deepEqual(operationListingResponse({ operations: [] }), []);
  for (const damaged of [
    null,
    { operations: {} },
    { operations: [{ ...row, id: 'nope' }] },
    { operations: [{ ...row, faction: 'nobody' }] },
    { operations: [{ ...row, mode: 'chess' }] },
    { operations: [{ ...row, seated: 5 }] },
    { operations: [{ ...row, hour: -1 }] },
    { operations: [{ ...row, status: 'paused' }] },
    { operations: [{ ...row, extra: true }] },
  ])
    assert.throws(() => operationListingResponse(damaged), /operation list/);
});
