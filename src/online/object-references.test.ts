import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ObjectReference } from '../contracts/protocol';
import { encodeObjectReference, parseObjectReference, splitObjectReferences } from './object-references';

const reference: ObjectReference = { version: 1, gameId: 'a'.repeat(24), kind: 'hauler', ref: 'b'.repeat(64), hour: 0 };
test('copied hours round-trip exactly across the finite nonnegative number range', () => {
  for (const hour of [0, Number.MIN_VALUE, 1e-300, 1e-7, 0.1, 42.125, 1e21, Number.MAX_VALUE]) {
    const value = { ...reference, hour };
    assert.deepEqual(parseObjectReference(encodeObjectReference(value)), value);
  }
});

test('rejects noncanonical hours, unknown fields, and anything beyond one exact token', () => {
  const token = encodeObjectReference(reference);
  for (const hour of ['-0', '-1', '01', '0.0', '+1', '1e-07', '1E-7', '1e21', 'NaN', 'Infinity', ' 1', '0x10', '1\n']) {
    assert.equal(parseObjectReference(token.replace(':0]]', `:${hour}]]`)), undefined, hour);
  }
  for (const value of [token + '\n', ' ' + token, token + token, token.replace(':v1:', ':v2:'), token.replace(':hauler:', ':fleet:'), token.replace('a'.repeat(24), 'A'.repeat(24)), token.replace('b'.repeat(64), 'b'.repeat(63))]) {
    assert.equal(parseObjectReference(value), undefined, value);
  }
  for (const invalid of [{ ...reference, hour: -0 }, { ...reference, hour: NaN }, { ...reference, hour: Infinity }, { ...reference, hour: -1 }, { ...reference, version: 2 }, { ...reference, gameId: 'bad' }, { ...reference, ref: 'B'.repeat(64) }, { ...reference, kind: 'fleet' }]) {
    assert.throws(() => encodeObjectReference(invalid as ObjectReference));
  }
});

test('splits mixed text without losing malformed, hostile, or adjacent content', () => {
  const first = encodeObjectReference(reference);
  const second = encodeObjectReference({ ...reference, kind: 'outpost', hour: Number.MIN_VALUE });
  const malformed = first.replace(':v1:', ':v99:');
  const prefix = '<script>alert(1)</script> https://example.com ' + malformed + ' ';
  const text = prefix + first + second + ' [[unfinished';
  const parts = splitObjectReferences(text);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.deepEqual(parts, [{ text: prefix }, { text: first, reference }, { text: second, reference: { ...reference, kind: 'outpost', hour: Number.MIN_VALUE } }, { text: ' [[unfinished' }]);
  for (const raw of ['', '[['.repeat(500), 'x'.repeat(1001) + first, '[[unknown:' + first]) {
    assert.deepEqual(splitObjectReferences(raw), [{ text: raw }]);
  }
});

test('recovers after malformed tokens and honors the message boundary without truncation', () => {
  const token = encodeObjectReference(reference);
  const malformed = token.replace(':0]]', ':' + '9'.repeat(200) + ']]');
  const mixed = malformed + token;
  assert.deepEqual(splitObjectReferences(mixed), [{ text: malformed }, { text: token, reference }]);
  const atLimit = 'x'.repeat(1000 - token.length) + token;
  assert.equal(splitObjectReferences(atLimit).at(-1)?.reference?.ref, reference.ref);
  assert.deepEqual(splitObjectReferences(atLimit + 'x'), [{ text: atLimit + 'x' }]);
  const hostile = '[['.repeat(100_000) + token;
  assert.deepEqual(splitObjectReferences(hostile), [{ text: hostile }]);
  assert.equal(parseObjectReference('['.repeat(100_000)), undefined);
});
