/** @format */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import type { Snapshot } from '../src/contracts/protocol';
import { GameService } from './service';
import { createApi } from './http';
import type { AccountAuthentication } from './auth';
import { api as currentApi } from '../src/online/network';
import { snapshotResponse as currentSnapshotResponse } from '../src/contracts/snapshot';

type ReleasedValidators = {
  snapshotResponse(id: string | undefined, value: unknown): unknown;
  historicalResponse(id: string, hour: number, value: unknown): unknown;
  decodeSharedReplay(source: string): unknown;
  releasedApi(
    session: { url: string; token: string; id?: string },
    path: string,
    payload?: unknown,
  ): Promise<unknown>;
  ReleasedRejectedCommand: new (
    status: number,
    message: string,
    issue?: string,
  ) => Error & { status: number; issue?: string };
};
async function releasedValidators(): Promise<ReleasedValidators> {
  const directory = join(process.cwd(), 'server/fixtures/released-client');
  const file = join(directory, 'build-2.mjs');
  const manifest = JSON.parse(await readFile(join(directory, 'build-2.json'), 'utf8'));
  assert.equal(manifest.commit, 'e93faf68e9696f3218538d642440c9df29ad8bee');
  assert.equal(
    createHash('sha256')
      .update(await readFile(file))
      .digest('hex'),
    manifest.sha256,
  );
  return import(pathToFileURL(file).href);
}

async function fixture(t: TestContext, now = () => 1000000) {
  const directory = await mkdtemp(join(tmpdir(), 'machination-released-client-'));
  const file = join(directory, 'games.json');
  let service = await GameService.open(file, now);
  let server = createApi(service);
  t.after(async () => {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    service,
    file,
    url,
    async restart(authenticate?: AccountAuthentication) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      service = await GameService.open(file, now);
      server = createApi(service, undefined, authenticate);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
  };
}

test('released TestFlight build 2 can decode a default HTTP creation response', async (t) => {
  const { url, file } = await fixture(t);
  const response = await fetch(`${url}/v1/games`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${'a'.repeat(64)}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 200);
  const snapshot = (await response.json()) as Snapshot;
  (await releasedValidators()).snapshotResponse(undefined, snapshot);
  assert.equal(snapshot.game.rules?.mechanicsVersion, 18);
  const stored = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(stored.rooms[0].game.rules.mechanicsVersion, 18);
  assert.ok(stored.rooms[0].game.rules.colors, 'the response projection retains canonical colors');
});

test('a capable client receives current mechanics and its canonical preferred color', async (t) => {
  const { url, file } = await fixture(t);
  const response = await fetch(`${url}/v1/games`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${'b'.repeat(64)}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.machination.v2+json, application/json',
    },
    body: JSON.stringify({
      preferredColor: 'lime',
      options: { playerCount: 3, mode: 'pulse', gravity: true },
    }),
  });
  assert.equal(response.status, 200);
  const snapshot = (await response.json()) as Snapshot;
  currentSnapshotResponse(undefined, snapshot);
  assert.equal(snapshot.game.rules?.mechanicsVersion, 19);
  assert.ok(snapshot.game.rules?.gravity?.wells.length);
  assert.equal(snapshot.game.rules?.colors?.[0], 'lime');
  assert.match(response.headers.get('content-type')!, /^application\/vnd\.machination\.v2\+json/);
  assert.match(response.headers.get('vary')!, /Accept/);
  const stored = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(stored.rooms[0].game.rules.colors, snapshot.game.rules?.colors);
});

test('requesting gravity without a capable decoder refuses before an operation is created', async (t) => {
  const { file, url } = await fixture(t);
  const response = await fetch(`${url}/v1/games`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${'a'.repeat(64)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ options: { playerCount: 3, mode: 'pulse', gravity: true } }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).issues[0].issue, 'client.unavailable.upgrade');
  await assert.rejects(readFile(file), { code: 'ENOENT' });
});

test('an older client cannot accept a command in an operation with newer recorded rules', async (t) => {
  const { service, file, url } = await fixture(t);
  const token = 'a'.repeat(64);
  const room = await service.create(token);
  await service.join(room.invite!, 'b'.repeat(64));
  const before = await readFile(file, 'utf8');
  const response = await fetch(`${url}/v1/games/${room.id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: 'released-newer-rules-command',
      to: 'vesper',
      text: 'Pending upgrade.',
    }),
  });
  assert.equal(response.status, 503);
  const failure = await response.json();
  assert.equal(failure.issues[0].issue, 'client.unavailable.upgrade');
  assert.match(failure.issues[0].message.detail, /Update Machination/);
  assert.equal(
    await readFile(file, 'utf8'),
    before,
    'refusal cannot write a message or retry receipt',
  );
});

test('newer operations require an upgrade before legacy snapshots, history, or replay are served', async (t) => {
  const { service, file, url } = await fixture(t);
  const token = 'a'.repeat(64);
  const room = await service.create(token);
  await service.join(room.invite!, 'b'.repeat(64));
  await service.join(room.invite!, 'c'.repeat(64));
  await service.start(room.id, token);
  const before = await readFile(file, 'utf8');
  for (const suffix of ['', '/history?hour=0', '/replay?from=0&through=0']) {
    const response = await fetch(`${url}/v1/games/${room.id}${suffix}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 503, suffix);
    assert.equal((await response.json()).issues[0].issue, 'client.unavailable.upgrade');
    assert.equal(await readFile(file, 'utf8'), before);
  }
  const foreign = await fetch(`${url}/v1/games/${room.id}`, {
    headers: { Authorization: `Bearer ${'f'.repeat(64)}` },
  });
  assert.equal(foreign.status, 401, 'a foreign credential cannot discover the required rules');
  await foreign.arrayBuffer();
});

test('joining newer rules refuses an older client before assigning a seat', async (t) => {
  const { service, file, url } = await fixture(t);
  const room = await service.create('a'.repeat(64));
  const before = await readFile(file, 'utf8');
  const response = await fetch(`${url}/v1/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${'b'.repeat(64)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ invite: room.invite }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).issues[0].issue, 'client.unavailable.upgrade');
  assert.equal(await readFile(file, 'utf8'), before);
});

test('a bootstrap retry cannot return an unsupported operation or replace its recorded rules', async (t) => {
  const { service, file, url } = await fixture(t);
  const token = 'a'.repeat(64);
  await service.create(token);
  const before = await readFile(file, 'utf8');
  const response = await fetch(`${url}/v1/games`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).issues[0].issue, 'client.unavailable.upgrade');
  assert.equal(await readFile(file, 'utf8'), before);
});

test('explicit creation retries preserve multiple operations and their negotiated rules', async (t) => {
  const { file, url } = await fixture(t);
  const token = 'a'.repeat(64);
  const session = { url, token };
  const first = await currentApi(session, 'games', { requestId: 'compatible-creation-0001' });
  const second = await currentApi(session, 'games', { requestId: 'compatible-creation-0002' });
  assert.notEqual(first.id, second.id);
  assert.equal(first.game.rules?.mechanicsVersion, 19);
  assert.equal(second.game.rules?.mechanicsVersion, 19);
  assert.equal(
    (await currentApi(session, 'games', { requestId: 'compatible-creation-0001' })).id,
    first.id,
  );
  const before = await readFile(file, 'utf8');
  const response = await fetch(`${url}/v1/games`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: 'compatible-creation-0001' }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).issues[0].issue, 'client.unavailable.upgrade');
  assert.equal(await readFile(file, 'utf8'), before);
  const legacy = await fetch(`${url}/v1/games`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: 'compatible-creation-0003' }),
  });
  assert.equal(legacy.status, 200);
  const snapshot = (await legacy.json()) as Snapshot;
  (await releasedValidators()).snapshotResponse(undefined, snapshot);
  assert.equal(snapshot.game.rules?.mechanicsVersion, 18);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).rooms.length, 3);
});

test('an unsupported bootstrap cannot settle an offline match and silently create a replacement', async (t) => {
  let now = 1000000;
  const { service, file, url } = await fixture(t, () => now);
  const token = 'a'.repeat(64);
  const room = await service.create(token);
  await service.join(room.invite!, 'b'.repeat(64));
  await service.join(room.invite!, 'c'.repeat(64));
  await service.start(room.id, token);
  const before = await readFile(file, 'utf8');
  now += 30 * 24 * 3_600_000;
  const response = await fetch(`${url}/v1/games`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).issues[0].issue, 'client.unavailable.upgrade');
  assert.equal(await readFile(file, 'utf8'), before);
});

test('an older recovery attempt cannot rotate credentials for newer recorded rules', async (t) => {
  const { service, file, url } = await fixture(t);
  const original = 'a'.repeat(64),
    fresh = 'b'.repeat(64),
    secret = 'c'.repeat(64);
  const room = await service.create(original);
  await service.setRecovery(room.id, original, { requestId: 'released-recovery-setup', secret });
  const before = await readFile(file, 'utf8');
  const response = await fetch(`${url}/v1/games/${room.id}/recover`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fresh}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).issues[0].issue, 'client.unavailable.upgrade');
  assert.equal(await readFile(file, 'utf8'), before);
  assert.equal((await service.snapshot(room.id, original)).id, room.id);
});

test('the released request code keeps an upgrade retryable instead of invalidating its pending recovery', async (t) => {
  const { service, url } = await fixture(t);
  const original = 'a'.repeat(64),
    fresh = 'b'.repeat(64),
    secret = 'c'.repeat(64);
  const room = await service.create(original);
  await service.setRecovery(room.id, original, {
    requestId: 'released-retryable-recovery',
    secret,
  });
  const released = await releasedValidators();
  await assert.rejects(
    released.releasedApi({ url, token: fresh, id: room.id }, `games/${room.id}/recover`, {
      secret,
    }),
    (error) =>
      error instanceof Error &&
      !(error instanceof released.ReleasedRejectedCommand) &&
      /Update Machination/.test(error.message),
  );
  const session = { url, token: fresh, id: room.id };
  const restored = await currentApi(session, `games/${room.id}/recover`, { secret });
  assert.deepEqual(await currentApi(session, `games/${room.id}/recover`, { secret }), restored);
  assert.equal((await currentApi(session, `games/${room.id}`)).id, room.id);
  await assert.rejects(service.snapshot(room.id, original));
});

test('account linking cannot revoke an older client seat before an upgrade is accepted', async (t) => {
  const runtime = await fixture(t);
  const token = 'a'.repeat(64);
  const room = await runtime.service.create(token);
  const account = { accountId: 'user_releasedclient' };
  const url = await runtime.restart(async () => account);
  const before = await readFile(runtime.file, 'utf8');
  const response = await fetch(`${url}/v1/account/link`, {
    method: 'POST',
    headers: { Authorization: 'Bearer released-account', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: room.id, token }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).issues[0].issue, 'client.unavailable.upgrade');
  assert.equal(await readFile(runtime.file, 'utf8'), before);
});

test('account restoration reports an upgrade without settling or replacing a newer match', async (t) => {
  const runtime = await fixture(t);
  const account = { accountId: 'user_releasedclient' };
  await runtime.service.create(account);
  const url = await runtime.restart(async () => account);
  const before = await readFile(runtime.file, 'utf8');
  const response = await fetch(`${url}/v1/account/session`, {
    headers: { Authorization: 'Bearer released-account' },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).issues[0].issue, 'client.unavailable.upgrade');
  assert.equal(await readFile(runtime.file, 'utf8'), before);
});

test('released account linking and restoration decode compatible recorded rules', async (t) => {
  const runtime = await fixture(t);
  const token = 'a'.repeat(64);
  const room = await runtime.service.create(token, undefined, undefined, undefined, undefined, 18);
  const account = { accountId: 'user_releasedclient' };
  const url = await runtime.restart(async () => account);
  const headers = { Authorization: 'Bearer released-account', 'Content-Type': 'application/json' };
  const linked = await fetch(`${url}/v1/account/link`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: room.id, token }),
  });
  assert.equal(linked.status, 200);
  const released = await releasedValidators();
  released.snapshotResponse(room.id, await linked.json());
  const restored = await fetch(`${url}/v1/account/session`, { headers });
  assert.equal(restored.status, 200);
  released.snapshotResponse(room.id, (await restored.json()).snapshot);
  const stored = JSON.parse(await readFile(runtime.file, 'utf8'));
  assert.equal(stored.rooms[0].game.rules.mechanicsVersion, 18);
  assert.equal(stored.rooms[0].seats[0].accountId, account.accountId);
  assert.ok(stored.rooms[0].game.rules.colors);
});

test('mixed clients retain released decoding, private retries, history, and replay across restart', async (t) => {
  const runtime = await fixture(t);
  let url = runtime.url;
  const released = await releasedValidators();
  const tokens = ['a', 'b', 'c'].map((value) => value.repeat(64));
  const snapshot = async (path: string, seat: number, body?: unknown, current = false) => {
    const response = await fetch(`${url}/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${tokens[seat]}`,
        'Content-Type': 'application/json',
        ...(current ? { Accept: 'application/vnd.machination.v2+json, application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = (await response.json()) as Snapshot;
    assert.equal(response.status, 200, JSON.stringify(value));
    if (!current) released.snapshotResponse(undefined, value);
    return value;
  };
  const created = await snapshot('games', 0, {});
  const joined = await snapshot(
    'join',
    1,
    { invite: created.invite, preferredColor: 'lime' },
    true,
  );
  assert.equal(joined.game.rules?.colors?.[1], 'lime');
  await snapshot('join', 2, { invite: created.invite });
  const path = `games/${created.id}`;
  await snapshot(`${path}/start`, 0, {});
  const message = {
    requestId: 'mixed-released-client-message',
    to: 'vesper',
    text: 'Only the invited recipient.',
  };
  await snapshot(`${path}/messages`, 0, message);
  assert.equal((await snapshot(`${path}/messages`, 0, message)).messages.length, 1);
  assert.equal(
    (await snapshot(path, 1)).messages.length,
    1,
    'representation follows the request, not the stored seat',
  );
  assert.equal((await snapshot(path, 2)).messages.length, 0);
  const headers = { Authorization: `Bearer ${tokens[0]}` };
  const historical = await fetch(`${url}/v1/${path}/history?hour=0`, { headers });
  assert.equal(historical.status, 200);
  released.historicalResponse(created.id, 0, await historical.json());
  const replay = await fetch(`${url}/v1/${path}/replay?from=0&through=0`, { headers });
  assert.equal(replay.status, 200);
  released.decodeSharedReplay(await replay.text());
  url = await runtime.restart();
  assert.equal((await snapshot(`${path}/messages`, 0, message)).messages.length, 1);
  const current = await snapshot(path, 1, undefined, true);
  assert.equal(current.game.rules?.colors?.[1], 'lime');
  assert.equal(current.game.rules?.mechanicsVersion, 18);
});
