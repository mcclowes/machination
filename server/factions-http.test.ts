import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { GameService } from './service';
import { createApi } from './http';
import { api, factionsApi, creationPayload } from '../src/online/network';

test('HTTP faction progression uses authenticated selection, validates variants, and returns decodable rooms and standings', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-factions-http-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const service = await GameService.open(join(dir, 'games.json'), () => 1000);
  const server = createApi(service);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const host = { url, token: 'a'.repeat(64) }, guest = { url, token: 'b'.repeat(64) };
  const options = { playerCount: 2, mode: 'domination' as const };
  const first = await api(host, 'games', creationPayload(options));
  await assert.rejects(factionsApi(host, 'mnemosyne'), { issue: 'faction.conflict.locked' });
  await api(guest, 'join', { invite: first.invite }); await api(host, `games/${first.id}/start`, {});
  const joined = await api(guest, `games/${first.id}`);
  await api(guest, `games/${first.id}/resign`, { requestId: randomUUID(), revision: joined.revision });
  await factionsApi(host, 'mnemosyne'); await factionsApi(guest, 'null');
  const room = await api(host, 'games', creationPayload(options, 'faction'));
  await api(guest, 'join', { invite: room.invite });
  const started = await api(host, `games/${room.id}/start`, {});
  assert.equal(started.variant, 'faction');
  assert.equal(started.allegiances?.length, 2);
  assert.equal((await factionsApi(host)).leaderboard.length, 3);
  assert.equal(JSON.stringify(started).includes('profileId'), false);
  for (const [method, path, payload, token, expected] of [
    ['GET', 'factions', undefined, '', 401],
    ['POST', 'factions', { faction: 'unknown' }, host.token, 400],
    ['POST', 'factions', { faction: 'null' }, host.token, 409],
    ['POST', 'factions', { faction: 'mnemosyne', wins: 10 }, host.token, 400],
    ['POST', 'games', { options, variant: 'unknown' }, host.token, 400],
    ['PUT', 'factions', {}, host.token, 405],
  ] as const) {
    const response = await fetch(`${url}/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    assert.equal(response.status, expected);
    const data = await response.json();
    assert.equal(data.issues[0].severity, 'error');
    assert.equal(data.issues[0].correlationId, response.headers.get('x-correlation-id'));
  }
});
