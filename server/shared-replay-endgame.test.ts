import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { GameService } from './service';
import { createApi } from './http';
import { api } from '../src/online/network';
import { exportSharedReplay } from '../src/online/shared-replay';
import { encodeReplayArtifact, seekReplayArtifact } from '../src/replay/artifact';
import type { Snapshot } from '../src/contracts/protocol';

// Real HTTP/file persistence, ordinary default rules and resources; only wall time is injected.
test('a fresh ten-seat HTTP pulse operation exports its natural ending and restores it after restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-packed-http-ending-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let now = 0, requests = 0;
  const file = join(directory, 'rooms.json');
  let service = await GameService.open(file, () => now);
  let server = createApi(service, undefined, undefined, { clock: () => now });
  async function listen() {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    return `http://127.0.0.1:${address.port}`;
  }
  let url = await listen();
  t.after(() => { server.closeAllConnections(); server.close(); });
  const seats = Array.from({ length: 10 }, () => ({ url, token: randomBytes(32).toString('hex'), id: undefined as string | undefined }));
  async function call(index: number, path: string, payload?: unknown) {
    assert.ok(++requests <= 1000, 'bounded HTTP acceptance request budget');
    return api(seats[index]!, path, payload);
  }
  const created = await call(0, 'games', { options: { playerCount: 10, mode: 'pulse' } });
  for (let i = 1; i < seats.length; i++) await call(i, 'join', { invite: created.invite });
  seats.forEach(seat => { seat.id = created.id; });
  const path = `games/${created.id}`;
  const started = await call(0, `${path}/start`, {});
  const rules = structuredClone(started.game.rules);
  assert.equal(rules!.mechanicsVersion, 19); assert.equal(rules!.mode, 'pulse');
  const snapshots: Snapshot[] = [];
  for (let hour = 8; hour <= 384; hour += 8) {
    now = hour * 3600000;
    for (let i = 0; i < seats.length; i++) {
      snapshots[i] = await call(i, `${path}/activity`, {});
      assert.equal(snapshots[i]!.status, 'game.active');
      assert.deepEqual(snapshots[i]!.game.rules, rules);
    }
  }
  for (let i = 0; i < seats.length; i++) {
    const view = await call(i, `${path}/activity`, {});
    assert.ok(view.game.cargo[view.faction]! >= 100);
    const charged = await call(i, `${path}/pulse`, { requestId: randomUUID(), revision: view.revision, action: 'START_CHARGE' });
    assert.equal(charged.game.cargo[view.faction], view.game.cargo[view.faction]! - 100);
  }
  now = 392 * 3600000;
  let retry: { requestId: string; revision: number; action: 'FIRE_PULSE' } | undefined;
  for (let i = 0; i < seats.length; i++) {
    const view = await call(i, `${path}/activity`, {});
    assert.equal(view.game.pulse!.kings.find(k => k.factionId === view.faction)!.state, 'ready');
    const command = { requestId: randomUUID(), revision: view.revision, action: 'FIRE_PULSE' as const };
    if (i === 0) retry = command;
    await call(i, `${path}/pulse`, command);
  }
  for (let hour = 393; hour <= 416; hour++) {
    now = hour * 3600000;
    for (let i = 0; i < seats.length; i++) snapshots[i] = await call(i, `${path}/activity`, {});
    if (snapshots.every(view => view.status === 'game.finished')) break;
  }
  assert.ok(snapshots.every(view => view.status === 'game.finished'), 'natural ending within the declared time budget');
  const final = snapshots[0]!;
  assert.ok(final.game.winner || final.game.draw);
  assert.ok(final.game.eliminated.length >= 9);
  const through = final.game.hour, from = through - 8;
  const replay = await exportSharedReplay(seats[0]!, from, through);
  assert.equal(replay.schemaVersion, 3);
  assert.equal(replay.from, from); assert.equal(replay.through, through);
  const end = seekReplayArtifact(replay, through);
  assert.equal(end.winner, final.game.winner); assert.deepEqual(end.eliminated, final.game.eliminated);
  assert.deepEqual(end.cargo, final.game.cargo); assert.deepEqual(end.rules, rules);
  const raw = encodeReplayArtifact(replay);
  for (const privateValue of [created.id, created.invite, ...seats.map(seat => seat.token)]) assert.ok(!raw.includes(privateValue));
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  service = await GameService.open(file, () => now);
  server = createApi(service, undefined, undefined, { clock: () => now });
  url = await listen(); seats.forEach(seat => { seat.url = url; });
  assert.equal((await call(0, `${path}/pulse`, retry)).status, 'game.finished');
  assert.equal(encodeReplayArtifact(await exportSharedReplay(seats[0]!, from, through)), raw);
});
