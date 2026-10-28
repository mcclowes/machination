import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRecoveryCode, parseRecoveryCode } from './recovery';
test('offline recovery codes tolerate copied line wrapping and preserve the exact secret', () => {
  const id = 'a'.repeat(24), secret = 'b'.repeat(64);
  const code = formatRecoveryCode(id, secret);
  assert.deepEqual(parseRecoveryCode(` \n${code.slice(0, 40)}\n${code.slice(40)} `), { id, secret });
  for (const invalid of [secret, code + '.extra', code.toUpperCase(), 'https://host/' + code]) assert.throws(() => parseRecoveryCode(invalid));
});
