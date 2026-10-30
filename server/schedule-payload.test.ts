import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalSchedule, canonicalScheduleEdit } from './schedule-payload';
import { Failure } from './failure';

const base = { requestId: '01234567-89ab-cdef', revision: 0, executeAt: 2 };

test('schedule payloads canonicalize reordered action fields for identical retry receipts', () => {
  const actions = [
    { type: 'gift', from: 'a', to: 'b', drones: 1, recipient: 'vesper', carryModule: false, specialists: [] },
    { type: 'intercept', from: 'a', target: 1, drones: 1, specialists: ['unit-1'] },
    ...['cancel-launch', 'gift', 'cancel-gift', 'cancel-course'].map(action => ({ type: 'hauler', change: { action, fleet: 1 } })),
    { type: 'hauler', change: { action: 'edit-launch', fleet: 1, drones: 2, specialists: ['unit-1'] } },
    { type: 'hauler', change: { action: 'course', fleet: 1, to: 'b' } },
    { type: 'hire', kind: 'helmsman' },
    { type: 'promote', id: 'unit-1' },
    { type: 'release', id: 'unit-1' },
    { type: 'drill-mine', rock: 'a' },
    { type: 'shields', rock: 'a', disabled: true },
    { type: 'funding', to: 'vesper', enabled: true },
  ];
  for (const action of actions) {
    const reversed = Object.fromEntries(Object.entries(action).reverse());
    if ('change' in reversed) reversed.change = Object.fromEntries(Object.entries(reversed.change).reverse());
    assert.equal(JSON.stringify(canonicalSchedule({ ...base, action: reversed })), JSON.stringify(canonicalSchedule({ ...base, action })));
  }
});

test('schedule decoding detaches manifests and preserves omitted versus empty launch edits', () => {
  const launch = { ...base, from: 'a', to: 'b', drones: 1, specialists: ['unit-1'] };
  const gift = { ...base, action: { type: 'gift', from: 'a', to: 'b', drones: 1, recipient: 'vesper', specialists: ['unit-1'] } };
  const hauler = { ...base, action: { type: 'hauler', change: { action: 'edit-launch', fleet: 1, drones: 1, specialists: ['unit-1'] } } };
  const edit = { requestId: base.requestId, revision: 0, planId: base.requestId, drones: 1, specialists: ['unit-1'] };
  for (const [input, decode] of [[launch, canonicalSchedule], [gift, canonicalSchedule], [hauler, canonicalSchedule], [edit, canonicalScheduleEdit]] as const) {
    const decoded = decode(input);
    const before = structuredClone(decoded);
    if ('specialists' in input) input.specialists[0] = 'forged';
    else if ('change' in input.action) input.action.change.specialists[0] = 'forged';
    else input.action.specialists[0] = 'forged';
    assert.deepEqual(decoded, before);
  }
  const { specialists, ...omitted } = edit;
  assert.equal(Object.hasOwn(canonicalScheduleEdit(omitted), 'specialists'), false);
  assert.deepEqual(canonicalScheduleEdit({ ...omitted, specialists: [] }).specialists, []);
});

test('schedule decoders reject malformed envelopes and injected fields with the existing failure identity', () => {
  const launch = { ...base, from: 'a', to: 'b', drones: 1 };
  const edit = { requestId: base.requestId, revision: 0, planId: base.requestId, drones: 1 };
  const rejects = (decode: (value: unknown) => unknown, value: unknown, message: string) => {
    assert.throws(() => decode(value), error => error instanceof Failure && error.status === 400
      && error.code === 'schedule.validation.payload' && error.message === message);
  };
  for (const [decode, valid, message] of [
    [canonicalSchedule, launch, 'Provide a supported future order.'],
    [canonicalScheduleEdit, edit, 'Provide a queued launch manifest edit.'],
  ] as const) {
    for (const value of [null, [], {}, { ...valid, owner: 'you' }, { ...valid, revision: -1 }, { ...valid, requestId: 'short' },
      { ...valid, specialists: null }, { ...valid, specialists: ['unit-1', 'unit-1'] }]) rejects(decode, value, message);
  }
  for (const value of [
    { ...base, action: { type: 'gift', from: 'a', to: 'b', drones: 1, recipient: 'vesper', owner: 'you' } },
    { ...base, action: { type: 'hauler', change: { action: 'course', fleet: 1, to: 'b', drones: 1 } } },
    { ...launch, action: { type: 'shields', rock: 'a', disabled: true } },
    { ...launch, executeAt: Infinity },
  ]) rejects(canonicalSchedule, value, 'Provide a supported future order.');
});
