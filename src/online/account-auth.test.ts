import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorization } from './account-auth';

test('account requests refresh the Clerk token and fail closed after sign-out', async () => {
  let token: string | null = 'jwt-one';
  const session = { url: 'https://belt.example', token: 'legacy-token', accountId: 'user_alice', getToken: async () => token };
  assert.equal(await authorization(session), 'Bearer jwt-one');
  token = 'jwt-two';
  assert.equal(await authorization(session), 'Bearer jwt-two');
  token = null;
  await assert.rejects(authorization(session), /Sign in/);
  await assert.rejects(authorization({ ...session, getToken: undefined }), /Sign in/);
  assert.equal(await authorization({ url: session.url, token: session.token }), 'Bearer legacy-token');
});
