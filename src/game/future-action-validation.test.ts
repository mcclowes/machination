import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFutureAction, type FutureAction } from './future-actions';

const actions: FutureAction[] = [
  { type: 'gift', from: 'a', to: 'b', drones: 0, recipient: 'vesper', carryModule: false, specialists: ['unit-1'] },
  { type: 'intercept', from: 'a', target: 1, drones: 1, specialists: [] },
  { type: 'hauler', change: { action: 'edit-launch', fleet: 1, drones: 0, specialists: ['unit-1'] } },
  { type: 'hauler', change: { action: 'course', fleet: 1, to: 'b' } },
  ...(['cancel-launch', 'gift', 'cancel-gift', 'cancel-course'] as const).map(action => ({ type: 'hauler' as const, change: { action, fleet: 1 } })),
  { type: 'hire', kind: 'helmsman' },
  { type: 'promote', id: 'unit-1' },
  { type: 'release', id: 'unit-1' },
  { type: 'drill-mine', rock: 'a' },
  { type: 'shields', rock: 'a', disabled: false },
  { type: 'funding', to: 'vesper', enabled: true },
];

test('future action decoding retains supported payloads and rejects missing or injected fields', () => {
  for (const action of actions) {
    assert.deepEqual(validateFutureAction(action), action);
    assert.throws(() => validateFutureAction({ ...action, owner: 'you' }), /supported future action/);
    for (const key of Object.keys(action).filter(key => !['specialists', 'carryModule'].includes(key))) {
      const missing = { ...action } as Record<string, unknown>;
      delete missing[key];
      assert.throws(() => validateFutureAction(missing), /supported future action/);
    }
    if (action.type === 'hauler') {
      assert.throws(() => validateFutureAction({ ...action, change: { ...action.change, owner: 'you' } }), /supported future action/);
    }
  }
});

test('future action decoding rejects invalid manifests, identifiers, counts, and toggles', () => {
  const invalid = [null, [], {}, { type: 'unknown' },
    { type: 'gift', from: 'a', to: 'b', drones: -1, recipient: 'vesper' },
    { type: 'gift', from: 'a', to: 'b', drones: 1, recipient: 'vesper', carryModule: 'false' },
    { type: 'intercept', from: 'a', target: 0, drones: 1 },
    { type: 'intercept', from: 'a', target: 1, drones: 1, specialists: ['unit-1', 'unit-1'] },
    { type: 'hauler', change: { action: 'edit-launch', fleet: 1, drones: 1.5 } },
    { type: 'hauler', change: { action: 'course', fleet: 1, to: '' } },
    { type: 'hauler', change: { action: 'unknown', fleet: 1 } },
    { type: 'hire', kind: 'unknown' }, { type: 'promote', id: '' },
    { type: 'shields', rock: 'a', disabled: 'false' },
    { type: 'funding', to: 'unknown', enabled: true },
  ];
  for (const value of invalid) assert.throws(() => validateFutureAction(value), /supported future action/);
});

test('decoded future manifests do not share arrays with their input', () => {
  const gift = { type: 'gift' as const, from: 'a', to: 'b', drones: 0, recipient: 'vesper' as const, specialists: ['unit-1'] };
  const edit = { type: 'hauler' as const, change: { action: 'edit-launch' as const, fleet: 1, drones: 0, specialists: ['unit-1'] } };
  const decodedGift = validateFutureAction(gift), decodedEdit = validateFutureAction(edit);
  gift.specialists.push('unit-2'); edit.change.specialists.push('unit-2');
  assert.deepEqual(decodedGift, { ...gift, specialists: ['unit-1'] });
  assert.deepEqual(decodedEdit, { ...edit, change: { ...edit.change, specialists: ['unit-1'] } });
});
