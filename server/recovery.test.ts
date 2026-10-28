import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { GameService, Failure } from './service';
const secret = () => randomBytes(32).toString('hex');
const unauthorized = (e: unknown) => e instanceof Failure && e.status === 401;
test('single-use recovery preserves the seat, revokes old credentials, and safely retries after restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-recovery-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'world.json'); let now = 1_000_000;
  let service = await GameService.open(file, () => now);
  const [host, rival, third, replacement, thief] = Array.from({ length: 5 }, secret) as [string,string,string,string,string];
  let view = await service.create(host);
  await service.join(view.invite, rival); await service.join(view.invite, third);
  view = await service.start(view.id, host);
  const launched = { requestId: randomUUID(), revision: view.revision, from: 'a', to: 'b', drones: 10 };
  view = await service.order(view.id, host, launched);
  view = await service.schedule(view.id, host, { requestId: randomUUID(), revision: view.revision, from: 'a', to: 'c', drones: 5, executeAt: 5 });
  view = await service.message(view.id, host, { requestId: randomUUID(), to: 'vesper', text: 'The agreement survives reconnect.' });
  const key = secret(); const setup = { requestId: randomUUID(), secret: key };
  view = await service.setRecovery(view.id, host, setup);
  assert.equal(view.recoveryEnabled, true);
  const recovered = await service.recover(view.id, replacement, { secret: key });
  assert.equal(recovered.faction, 'you'); assert.equal(recovered.recoveryEnabled, false);
  assert.equal(recovered.revision, view.revision);
  assert.deepEqual(recovered.game.fleets.map(f => f.id), view.game.fleets.map(f => f.id));
  assert.deepEqual(recovered.messages, view.messages);
  assert.deepEqual(recovered.game.scheduled, view.game.scheduled);
  const replay = await service.order(view.id, replacement, launched);
  assert.deepEqual(replay.game.fleets, recovered.game.fleets, 'accepted orders remain idempotent after recovery');
  assert.equal(replay.revision, recovered.revision);
  await assert.rejects(() => service.snapshot(view.id, host), unauthorized);
  await assert.rejects(() => service.recover(view.id, thief, { secret: key }), unauthorized);
  const disk = await readFile(file, 'utf8');
  for (const raw of [host, replacement, key]) assert.ok(!disk.includes(raw), 'raw credentials must not be persisted');
  assert.ok(!JSON.stringify(recovered).includes(key));
  service = await GameService.open(file, () => now); now += 2 * 3_600_000;
  const retry = await service.recover(view.id, replacement, { secret: key });
  assert.equal(retry.faction, 'you'); assert.equal(retry.game.hour, 2);
  assert.equal((await service.snapshot(view.id, replacement)).faction, 'you');
  assert.equal((await service.snapshot(view.id, third)).messages.length, 0);
});
test('replacement codes supersede previous codes and rejected recovery cannot consume a valid code', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-recovery-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const service = await GameService.open(join(dir, 'world.json'));
  const host = secret(), rival = secret(), outsider = secret(), replacement = secret();
  const view = await service.create(host); await service.join(view.invite, rival);
  const first = { requestId: randomUUID(), secret: secret() }; const second = { requestId: randomUUID(), secret: secret() };
  await service.setRecovery(view.id, host, first); await service.setRecovery(view.id, host, second);
  await assert.rejects(() => service.setRecovery(view.id, host, first), e => e instanceof Failure && e.status === 409);
  await assert.rejects(() => service.setRecovery(view.id, outsider, second), unauthorized);
  await assert.rejects(() => service.recover(view.id, replacement, { secret: first.secret }), unauthorized);
  await assert.rejects(() => service.recover(view.id, rival, { secret: second.secret }), e => e instanceof Failure && e.status === 409);
  assert.equal((await service.recover(view.id, replacement, { secret: second.secret })).faction, 'you');
  await assert.rejects(() => service.setRecovery(view.id, replacement, { requestId: randomUUID(), secret: second.secret }), e => e instanceof Failure && e.status === 409);
});
test('damaged recovery metadata is rejected at startup', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-recovery-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'world.json'); const service = await GameService.open(file);
  await service.create(secret()); const db = JSON.parse(await readFile(file, 'utf8'));
  for (const metadata of [{ recoveryHash: 'broken' }, { identityHash: ['a'.repeat(64)] }, { recoveryReceipt: { secretHash: ['a'.repeat(64)], credentialHash: db.rooms[0].seats[0].hash } }]) {
    const damaged = structuredClone(db); Object.assign(damaged.rooms[0].seats[0], metadata);
    await writeFile(file, JSON.stringify(damaged));
    await assert.rejects(() => GameService.open(file), /Damaged recovery/);
  }
});

test('HTTP recovery keeps credentials out of snapshots and returns structured failures', async t => {
  const { createApi } = await import('./http');
  const dir = await mkdtemp(join(tmpdir(), 'machination-recovery-http-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'world.json');
  const server = createApi(await GameService.open(file));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const request = async (path: string, token: string, body?: unknown) => {
    const response = await fetch(`${origin}/v1/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const host = secret(), next = secret(), key = secret();
  const created = await request('games', host, {}); const path = `games/${created.data.id}`;
  assert.equal((await request(`${path}/recovery`, host, { requestId: randomUUID(), secret: key })).status, 200);
  const wrong = await request(`${path}/recover`, next, { secret: secret() });
  assert.equal(wrong.status, 401); assert.equal(wrong.data.issues[0].issue, 'recovery.unauthorized.code');
  assert.ok(wrong.data.issues[0].correlationId);
  const restored = await request(`${path}/recover`, next, { secret: key });
  assert.equal(restored.status, 200); assert.equal(restored.data.faction, 'you');
  assert.ok(!JSON.stringify(restored.data).includes(key));
  assert.equal((await request(path, host)).status, 401);
  assert.equal((await request(`${path}/recover`, next, { secret: key })).status, 200);
  assert.equal((await request(`${path}/recover`, secret(), { secret: key })).status, 401);
});

test('a failed durable write neither consumes recovery nor revokes the existing connection', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-recovery-rollback-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const stateDir = join(dir, 'state'); const parked = join(dir, 'parked');
  const service = await GameService.open(join(stateDir, 'world.json'));
  const host = secret(), replacement = secret(), key = secret();
  const view = await service.create(host);
  await service.setRecovery(view.id, host, { requestId: randomUUID(), secret: key });
  await rename(stateDir, parked); await writeFile(stateDir, 'blocked directory');
  await assert.rejects(() => service.recover(view.id, replacement, { secret: key }));
  await rm(stateDir); await rename(parked, stateDir);
  assert.equal((await service.snapshot(view.id, host)).faction, 'you');
  assert.equal((await service.recover(view.id, replacement, { secret: key })).faction, 'you');
});
