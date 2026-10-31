import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import { operatorAuthentication } from './operator-auth';
import { clerkAuthentication } from './auth';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwtKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const issuer = 'https://operator.clerk.accounts.dev';
const origin = 'https://review.example.test';
const configuration = {
  MACHINATION_OPERATOR_CLERK_ISSUER: issuer,
  MACHINATION_OPERATOR_CLERK_JWT_KEY: jwtKey,
  MACHINATION_OPERATOR_ACCOUNTS: 'user_reviewer,user_second',
};

function session(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'fixture' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: issuer, sub: 'user_reviewer', sid: 'sess_review', azp: origin, iat: now, nbf: now - 1, exp: now + 60, ...overrides })).toString('base64url');
  const content = `${header}.${payload}`;
  return `${content}.${sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64url')}`;
}

test('operator authority requires a verified session and an exact configured account', async () => {
  const authenticate = operatorAuthentication(configuration, [origin])!;
  assert.deepEqual(await authenticate(session(), origin), { accountId: 'user_reviewer' });
  assert.deepEqual(await authenticate(session({ sub: 'user_second', azp: undefined })), { accountId: 'user_second' });
  for (const sub of ['user_other', 'user_reviewerExtra', 'user_review']) {
    await assert.rejects(authenticate(session({ sub, role: 'admin', host: true, faction: 'you' }), origin), { status: 403, code: 'operator.forbidden.account' });
  }
});

test('operator configuration is optional only when all separate fields are absent', () => {
  assert.equal(operatorAuthentication({}, [origin]), undefined);
  const playerOnly = { MACHINATION_OPERATOR_ACCOUNTS: undefined, CLERK_ISSUER: issuer, CLERK_JWT_KEY: jwtKey, CLERK_SECRET_KEY: 'private-player-secret' };
  assert.equal(operatorAuthentication(playerOnly, [origin]), undefined);
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  for (const invalid of [
    { MACHINATION_OPERATOR_CLERK_ISSUER: issuer },
    { MACHINATION_OPERATOR_CLERK_JWT_KEY: jwtKey },
    { MACHINATION_OPERATOR_ACCOUNTS: 'user_reviewer' },
    { ...configuration, MACHINATION_OPERATOR_CLERK_ISSUER: '' },
    { ...configuration, MACHINATION_OPERATOR_CLERK_JWT_KEY: ' ' },
    { ...configuration, MACHINATION_OPERATOR_ACCOUNTS: '' },
    { ...configuration, MACHINATION_OPERATOR_CLERK_ISSUER: 'http://operator.example.test' },
    { ...configuration, MACHINATION_OPERATOR_CLERK_ISSUER: issuer + '/unexpected' },
    { ...configuration, MACHINATION_OPERATOR_CLERK_JWT_KEY: 'private-malformed-key' },
    { ...configuration, MACHINATION_OPERATOR_CLERK_JWT_KEY: privatePem },
    { ...configuration, MACHINATION_OPERATOR_ACCOUNTS: 'user_reviewer,' },
    { ...configuration, MACHINATION_OPERATOR_ACCOUNTS: 'user_reviewer,user_reviewer' },
    { ...configuration, MACHINATION_OPERATOR_ACCOUNTS: 'user_reviewer,org_admin' },
  ]) assert.throws(() => operatorAuthentication(invalid, [origin]), error => {
    assert.match((error as Error).message, /Operator/);
    assert.ok(!(error as Error).message.includes('private-'));
    assert.ok(!(error as Error).message.includes('user_reviewer'));
    return true;
  });
  assert.throws(() => operatorAuthentication(configuration, []));
  assert.ok(operatorAuthentication({ ...configuration, MACHINATION_OPERATOR_CLERK_JWT_KEY: jwtKey.replace(/\n/g, '\\n'), MACHINATION_OPERATOR_ACCOUNTS: ' user_reviewer , user_second ' }, [origin]));
});

test('operator verification enforces signature, issuer, expiry, session, and authorized party without exposing token content', async () => {
  const authenticate = operatorAuthentication(configuration, [origin])!;
  for (const jwt of [
    '',
    'a'.repeat(64),
    session({ iss: 'https://wrong.clerk.accounts.dev' }),
    session({ exp: 1 }),
    session({ sid: undefined }),
    session({ sts: 'pending' }),
    session({ azp: 'https://untrusted.example.test' }),
    session({ azp: undefined }),
    session().slice(0, -10) + 'tampered',
  ]) {
    await assert.rejects(authenticate(jwt, origin), error => {
      const failure = error as Error & { status: number; code: string };
      assert.equal(failure.status, 401);
      assert.equal(failure.code, 'operator.unauthorized.session');
      assert.ok(!failure.message.includes('user_reviewer'));
      if (jwt) assert.ok(!failure.message.includes(jwt));
      return true;
    });
  }
  await assert.rejects(authenticate(session(), 'https://untrusted.example.test'), { code: 'operator.unauthorized.session' });
});

test('operator configuration never enables or mutates player login configuration', () => {
  const env = { ...configuration, CLERK_ISSUER: undefined };
  const before = structuredClone(env);
  assert.ok(operatorAuthentication(env, [origin]));
  assert.deepEqual(env, before);
  assert.equal(clerkAuthentication(env, [origin]), undefined);
});
