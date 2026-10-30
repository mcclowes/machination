import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { GameService } from './service';
import { snapshotResponse } from '../src/contracts/snapshot';
import { createApi } from './http';
import { once } from 'node:events';

test('HTTP create and join accept preferences and reject unknown colors', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-colors-http-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const service = await GameService.open(join(dir, 'games.json'), () => 1000);
  const server = createApi(service);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  async function post(path: string, preferredColor: unknown, invite?: string) {
    const response = await fetch(`http://127.0.0.1:${port}/v1/${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${randomBytes(32).toString('hex')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferredColor, ...(invite ? { invite } : {}) }),
    });
    return { status: response.status, data: await response.json() };
  }
  const host = await post('games', 'gold');
  assert.equal(host.status, 200);
  assert.equal(host.data.game.rules.colors[0], 'gold');
  const guest = await post('join', 'violet', host.data.invite);
  assert.equal(guest.status, 200);
  assert.deepEqual(guest.data.game.rules.colors.slice(0, 2), ['gold', 'violet']);
  assert.equal((await post('games', 'invalid')).status, 400);
  const invalid = await post('join', {}, host.data.invite);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.issues[0].issue, 'player.validation.color');
});

test('multiplayer preferences survive collisions, retries, start, history, and restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-colors-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'games.json');
  let service = await GameService.open(file, () => 1000);
  const [host, guest, third] = Array.from({ length: 3 }, () => randomBytes(32).toString('hex'));
  const created = await service.create(host!, undefined, undefined, 'gold');
  assert.equal(created.game.rules!.colors![0], 'gold');
  const joined = await service.join(created.invite, guest!, 'gold');
  assert.equal(joined.game.rules!.colors![0], 'gold');
  assert.notEqual(joined.game.rules!.colors![1], 'gold');
  assert.deepEqual((await service.join(created.invite, guest!, 'violet')).game.rules!.colors, joined.game.rules!.colors);
  assert.deepEqual((await service.create(host!, undefined, undefined, 'violet')).game.rules!.colors, joined.game.rules!.colors);
  const last = await service.join(created.invite, third!, 'violet');
  assert.equal(last.game.rules!.colors![2], 'violet');
  assert.deepEqual(last.game.rules!.colors!.slice(0, 2), joined.game.rules!.colors!.slice(0, 2));
  snapshotResponse(created.id, last);
  const started = await service.start(created.id, host!);
  service = await GameService.open(file, () => 1000);
  assert.deepEqual((await service.snapshot(created.id, guest!)).game.rules!.colors, started.game.rules!.colors);
  assert.deepEqual((await service.history(created.id, guest!, 0)).game.rules!.colors, started.game.rules!.colors);
  await assert.rejects(() => service.join(created.invite, randomBytes(32).toString('hex'), 'invalid'), /known player color/);
  await assert.rejects(() => service.create(randomBytes(32).toString('hex'), undefined, undefined, '#bad'), /known player color/);
});
