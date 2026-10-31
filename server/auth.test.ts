import { CURRENT_CLIENT_ACCEPT } from '../src/contracts/representation';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { clerkAuthentication } from './auth';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwtKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const issuer = 'https://clerk.marginalutility.dev';
const origin = 'https://machination.marginalutility.dev';
function token(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: issuer, sub: 'user_alice', sid: 'sess_one', azp: origin, iat: now, nbf: now - 1, exp: now + 60, ...overrides })).toString('base64url');
  const data = `${header}.${payload}`;
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`;
}

test('Clerk verification enforces signature, issuer, expiry, session, and browser party', async () => {
  const authenticate = clerkAuthentication({ CLERK_JWT_KEY: jwtKey, CLERK_ISSUER: issuer }, [origin])!;
  assert.deepEqual(await authenticate(token(), origin), { accountId: 'user_alice' });
  assert.deepEqual(await authenticate(token({ azp: undefined })), { accountId: 'user_alice' }, 'native sessions may omit azp');
  for (const jwt of [token({ iss: 'https://other.clerk.accounts.dev' }), token({ exp: 1 }), token({ azp: 'https://evil.example' }), token({ sid: undefined }), token({ sts: 'pending' }), token({ sub: 'org_alice' }), `${token().slice(0, -10)}tampered`]) {
    await assert.rejects(authenticate(jwt, origin), { status: 401 });
  }
  await assert.rejects(authenticate(token({ azp: undefined }), origin), { status: 401 });
});

test('partial Clerk configuration fails startup instead of enabling anonymous creation', () => {
  assert.equal(clerkAuthentication({}, [origin]), undefined);
  assert.throws(() => clerkAuthentication({ CLERK_ISSUER: issuer }, [origin]));
  assert.throws(() => clerkAuthentication({ CLERK_JWT_KEY: jwtKey }, [origin]));
  assert.throws(() => clerkAuthentication({ CLERK_JWT_KEY: jwtKey, CLERK_ISSUER: issuer }, []));
});

test('HTTP login restores an account seat with a new session and migrates a legacy seat without takeover', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { GameService } = await import('./service');
  const { createApi } = await import('./http');
  const directory = await mkdtemp(join(tmpdir(), 'machination-clerk-http-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const service = await GameService.open(join(directory, 'games.json'));
  const legacyToken = 'a'.repeat(64);
  const legacy = await service.create(legacyToken);
  const server = createApi(service, [origin], clerkAuthentication({ CLERK_JWT_KEY: jwtKey, CLERK_ISSUER: issuer }, [origin]));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
  const address = server.address() as import('node:net').AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  async function request(path: string, bearer: string, payload?: unknown) {
    const response = await fetch(`${base}/v1/${path}`, { method: payload === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${bearer}`, Origin: origin, 'Content-Type': 'application/json', Accept: CURRENT_CLIENT_ACCEPT }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    return { status: response.status, data: await response.json() as any };
  }
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await request('games', legacyToken, {})).status, 401, 'configured server requires accounts for new seats');
  assert.equal((await request('account/session', 'invalid')).status, 401);
  const alice = token();
  assert.equal((await request('account/session', alice)).data.snapshot, null);
  assert.equal((await request('account/link', alice, { id: legacy.id, token: 'b'.repeat(64) })).status, 401);
  const linked = await request('account/link', alice, { id: legacy.id, token: legacyToken });
  assert.equal(linked.status, 200);
  assert.equal(linked.data.id, legacy.id);
  const nextSession = token({ sid: 'sess_two' });
  assert.equal((await request('account/session', nextSession)).data.snapshot.id, legacy.id);
  assert.equal((await request(`games/${legacy.id}`, nextSession)).status, 200);
  assert.equal((await request(`games/${legacy.id}`, legacyToken)).status, 401);
  const bob = token({ sub: 'user_bob' });
  assert.equal((await request(`games/${legacy.id}`, bob)).status, 401);
  assert.equal((await request('account/link', bob, { id: legacy.id, token: legacyToken })).status, 409);
  assert.equal((await request('join', bob, { invite: legacy.invite })).status, 200);
  assert.equal((await request(`games/${legacy.id}/start`, bob, {})).status, 403);
  const charlie = token({ sub: 'user_charlie' });
  const created = await request('games', charlie, {});
  assert.equal(created.status, 200);
  assert.equal((await request('games', token({ sub: 'user_charlie', sid: 'sess_other' }), {})).data.id, created.data.id);
  assert.equal(JSON.stringify(created.data).includes('user_charlie'), false, 'account IDs stay out of game snapshots');
  const another = await request('games', charlie, { requestId: 'charlie-second-game' });
  assert.notEqual(another.data.id, created.data.id);
  const listed = await request('account/operations', charlie);
  assert.deepEqual(listed.data.operations.map((o: { id: string }) => o.id), [another.data.id, created.data.id]);
  assert.equal(JSON.stringify(listed.data).includes('user_charlie'), false, 'account IDs stay out of listings');
  assert.equal((await request('account/operations', legacyToken)).status, 401);
});
