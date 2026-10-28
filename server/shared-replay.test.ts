import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { GameService, Failure } from './service';
import { createApi } from './http';
import { createGame } from '../src/game/simulation';
import { decodeSharedReplay } from '../src/replay/codec';
import { SHARED_REPLAY_LIMITS } from '../src/replay/timeline';
import { exportSharedReplay } from '../src/online/shared-replay';

test('authenticated exports preserve canonical order, private archives, presence, and restart output', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-shared-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'rooms.json'); let now = 0;
  let service = await GameService.open(file, () => now, createGame);
  const tokens = Array.from({ length: 4 }, () => randomBytes(32).toString('hex'));
  const room = await service.create(tokens[0]!);
  await assert.rejects(service.sharedReplay(room.id, tokens[0]!, 0, 0), (e: unknown) => e instanceof Failure && e.code === 'replay.conflict.lobby');
  await service.join(room.invite, tokens[1]!); await service.join(room.invite, tokens[2]!);
  await service.start(room.id, tokens[0]!);
  await service.message(room.id, tokens[0]!, { requestId: randomUUID(), to: 'vesper', text: 'PRIVATE_CHAT_SENTINEL' });
  let snapshot = await service.snapshot(room.id, tokens[0]!);
  await service.order(room.id, tokens[0]!, { requestId: randomUUID(), revision: snapshot.revision, from: 'c', to: 'b', drones: 10 });
  snapshot = await service.snapshot(room.id, tokens[1]!);
  await service.order(room.id, tokens[1]!, { requestId: randomUUID(), revision: snapshot.revision, from: 'f', to: 'c', drones: 10 });
  const before = JSON.parse(await readFile(file, 'utf8')).rooms[0];
  const own = await service.sharedReplay(room.id, tokens[0]!, 0, 0);
  const foreign = await service.sharedReplay(room.id, tokens[1]!, 0, 0);
  assert.equal(own.perspective, 'you'); assert.equal(foreign.perspective, 'vesper');
  assert.notDeepEqual(own, foreign);
  assert.ok(own.groups[0]!.states.length >= 2, 'same-hour commands remain ordered');
  assert.equal(own.spans.length, 0);
  assert.ok(own.groups[0]!.states.at(-1)!.fleets.some(f => f.owner === 'you' && f.preparing));
  assert.ok(own.groups[0]!.states.every(s => !s.fleets.some(f => f.owner === 'vesper' && f.preparing)));
  const raw = JSON.stringify(own); decodeSharedReplay(raw);
  for (const secret of [room.id, room.invite, ...tokens, 'PRIVATE_CHAT_SENTINEL', 'requestId', 'receipts', 'baseline', 'entries']) assert.ok(!raw.includes(secret));
  const after = JSON.parse(await readFile(file, 'utf8')).rooms[0];
  assert.deepEqual(after.replay, before.replay);
  assert.deepEqual(after.seats, before.seats);
  assert.deepEqual(after.receipts, before.receipts);
  now = 3_600_000;
  await assert.rejects(service.sharedReplay(room.id, tokens[0]!, 0, 2), (e: unknown) => e instanceof Failure && e.status === 400);
  const settled = JSON.parse(await readFile(file, 'utf8')).rooms[0];
  assert.equal(settled.game.hour, 1, 'ordinary settling persists even when bounds are refused');
  assert.deepEqual(settled.seats, before.seats, 'export does not renew presence');
  const replay = await service.sharedReplay(room.id, tokens[0]!, 0, 1);
  service = await GameService.open(file, () => now, createGame);
  assert.deepEqual(await service.sharedReplay(room.id, tokens[0]!, 0, 1), replay);
  const server = createApi(service); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const endpoint = `${url}/v1/games/${room.id}/replay`;
  const get = (query: string, token = tokens[0]!) => fetch(`${endpoint}?${query}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await get('from=0&through=0', tokens[3]!)).status, 401);
  assert.equal((await get('from=0&through=0', '')).status, 401);
  assert.equal((await get('from=0&through=0', tokens[1]!)).status, 200);
  const unchanged = await readFile(file, 'utf8');
  for (const query of ['from=0', 'from=0&through=0&from=1', 'from=0&through=0&perspective=vesper', 'from=0&through=0&command=launch', 'from=NaN&through=0', 'from=0&through=Infinity', 'from=&through=0', 'from=1&through=0', 'from=-1&through=0', 'from=0&through=2']) {
    const response = await get(query); assert.equal(response.status, 400, query);
    const body = await response.json(); assert.equal(body.issues[0].issue, 'replay.validation.bounds');
  }
  assert.equal(await readFile(file, 'utf8'), unchanged, 'malformed queries never issue commands or alter history');
  assert.deepEqual(await exportSharedReplay({ url, id: room.id, token: tokens[0]! }, 0, 1), replay);
  const post = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${tokens[0]}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'launch', from: 'c', to: 'b', drones: 10 }) });
  assert.equal(post.status, 405);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).rooms[0].replay, settled.replay);
  const records = SHARED_REPLAY_LIMITS.records;
  try {
    Object.defineProperty(SHARED_REPLAY_LIMITS, 'records', { value: 1 });
    const capacity = await get('from=0&through=1');
    assert.equal(capacity.status, 413);
    assert.equal((await capacity.json()).issues[0].issue, 'replay-capacity');
  } finally { Object.defineProperty(SHARED_REPLAY_LIMITS, 'records', { value: records }); }
  const nativeHypot = Math.hypot;
  try {
    Math.hypot = (...values) => nativeHypot(...values);
    const unsupported = await get('from=0&through=1');
    assert.equal(unsupported.status, 422);
    const failure = await unsupported.json();
    assert.equal(failure.issues[0].issue, 'unsupported-visibility-numeric');
    assert.ok(!JSON.stringify(failure).includes('numeric-support.ts'));
  } finally { Math.hypot = nativeHypot; }

});
