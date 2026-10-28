import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createLegacyGame } from '../src/game/legacy';
import { GameService } from './service';
import { createApi } from './http';
import type { Snapshot } from '../src/online/protocol';
import { api as clientApi, historicalApi } from '../src/online/network';
import { encodeObjectReference, parseObjectReference } from '../src/online/object-references';
import { copyableReference, resolveReference } from '../src/online/reference-inspection';

const secret = () => randomBytes(32).toString('hex');
async function setup(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'machination-references-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'state', 'world.json'); let now = 0;
  let service = await GameService.open(file, () => now, createLegacyGame);
  let api = createApi(service);
  async function listen() { await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve)); }
  await listen();
  const close = async () => { api.closeAllConnections(); await new Promise<void>((resolve, reject) => api.close(e => e ? reject(e) : resolve())); };
  t.after(close);
  async function request(path: string, token: string, payload?: unknown, status = 200) {
    const response = await fetch(`http://127.0.0.1:${(api.address() as AddressInfo).port}/v1/${path}`, {
      method: payload === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result as Snapshot;
  }
  const tokens = [secret(), secret(), secret()];
  const created = await request('games', tokens[0]!, {});
  await request('join', tokens[1]!, { invite: created.invite }); await request('join', tokens[2]!, { invite: created.invite });
  const path = `games/${created.id}`;
  await request(`${path}/start`, tokens[0]!, {});
  return { dir, file, tokens, path, request, get url() { return `http://127.0.0.1:${(api.address() as AddressInfo).port}`; }, setHour(hour: number) { now = hour * 3_600_000; },
    async restart() { await close(); service = await GameService.open(file, () => now, createLegacyGame); api = createApi(service); await listen(); } };
}
function references(frame: Snapshot) {
  assert.ok(frame.references); assert.equal(frame.references.version, 1);
  assert.deepEqual(frame.references.outposts.map(r => r.id), frame.game.rocks.map(r => r.id));
  assert.deepEqual(frame.references.haulers.map(r => r.id), frame.game.fleets.map(f => f.id));
  for (const r of [...frame.references.outposts, ...frame.references.haulers]) assert.match(r.ref, /^[a-f0-9]{64}$/);
  return frame.references;
}

test('real chat copy and recipient inspection use filtered history rather than sender aliases', async t => {
  const h = await setup(t);
  const host = { url: h.url, id: h.path.slice(6), token: h.tokens[0]! };
  const rival = { ...host, token: h.tokens[1]! };
  let owner = await clientApi(rival, h.path);
  owner = await clientApi(rival, `${h.path}/orders`, { requestId: randomUUID(), revision: owner.revision, from: 'e', to: 'a', drones: 30 });
  const copied = copyableReference({ ...owner, at: owner.game.hour }, 'hauler', owner.game.fleets[0]!.id)!;
  const text = encodeObjectReference(copied);
  await clientApi(rival, `${h.path}/messages`, { requestId: randomUUID(), to: 'you', text });
  let recipient = await clientApi(host, h.path);
  const received = parseObjectReference(recipient.messages.at(-1)!.text)!;
  assert.deepEqual(received, copied);
  assert.equal(resolveReference({ ...recipient, at: recipient.game.hour }, received, 'now'), undefined);
  recipient = await clientApi(host, `${h.path}/orders`, { requestId: randomUUID(), revision: recipient.revision, from: 'a', to: 'e', drones: 1 });
  h.setHour(3);
  recipient = await clientApi(host, h.path);
  const target = resolveReference({ ...recipient, at: 3 }, received, 'now')!;
  assert.equal(target.kind, 'hauler');
  assert.notEqual(target.id, owner.game.fleets[0]!.id);
  const hiddenPast = await historicalApi(host, copied.hour);
  assert.equal(resolveReference({ ...hiddenPast, at: hiddenPast.history.at }, received, 'observed'), undefined);
  const copiedAtThree = copyableReference({ ...recipient, at: 3 }, 'hauler', target.id)!;
  assert.equal(copiedAtThree.ref, copied.ref);
  const tokenAtThree = encodeObjectReference(copiedAtThree);
  h.setHour(8);
  const current = await clientApi(host, h.path);
  assert.equal(resolveReference({ ...current, at: current.game.hour }, copiedAtThree, 'now'), undefined);
  const historical = await historicalApi(host, 3);
  assert.deepEqual(resolveReference({ ...historical, at: historical.history.at }, parseObjectReference(tokenAtThree)!, 'observed'), target);
  await h.restart();
  const restored = await historicalApi({ ...host, url: h.url }, 3);
  assert.deepEqual(resolveReference({ ...restored, at: restored.history.at }, copiedAtThree, 'observed'), target);
});

test('HTTP references follow the exact recipient observation and copied historical hour', async t => {
  const h = await setup(t); const [host, rival] = h.tokens as [string, string];
  let enemy = await h.request(h.path, rival);
  enemy = await h.request(`${h.path}/orders`, rival, { requestId: randomUUID(), revision: enemy.revision, from: 'e', to: 'a', drones: 30 });
  const hidden = await h.request(h.path, host);
  assert.equal(references(hidden).haulers.length, 0);
  assert.equal(references(enemy).haulers.length, 1);
  assert.ok(!JSON.stringify(hidden).includes(references(enemy).haulers[0]!.ref), 'hidden contact references never enter the response');
  assert.ok(hidden.game.rocks.some(r => !r.known), 'public outposts include unknown territory');
  const queued = await h.request(`${h.path}/schedules`, host, { requestId: randomUUID(), revision: hidden.revision, from: 'a', to: 'c', drones: 5, executeAt: 20 });
  assert.ok(queued.game.scheduled.length); assert.equal(references(queued).haulers.length, 0);
  await h.request(`${h.path}/orders`, host, { requestId: randomUUID(), revision: queued.revision, from: 'a', to: 'e', drones: 1 });
  h.setHour(3);
  const seen = await h.request(h.path, host); const owner = await h.request(h.path, rival);
  const contact = references(seen).haulers.find(r => r.id === seen.game.fleets.find(f => f.owner === 'vesper')?.id)!; const own = references(owner).haulers.find(r => r.id === owner.game.fleets.find(f => f.owner === 'vesper')?.id)!;
  assert.ok(contact); assert.notEqual(contact.id, own.id); assert.equal(contact.ref, own.ref);
  assert.deepEqual(references(seen).outposts, references(owner).outposts);
  const disk = JSON.parse(await readFile(h.file, 'utf8')); const room = disk.rooms[0];
  assert.match(room.referenceKey, /^[a-f0-9]{64}$/);
  const expected = createHmac('sha256', Buffer.from(room.referenceKey, 'hex')).update(JSON.stringify(['machination.object-reference', 1, room.id, 'hauler', room.game.fleets[0].id])).digest('hex');
  assert.equal(contact.ref, expected);
  for (const tuple of [
    ['machination.object-reference', 2, room.id, 'hauler', room.game.fleets[0].id],
    ['machination.object-reference', 1, '0'.repeat(24), 'hauler', room.game.fleets[0].id],
    ['machination.object-reference', 1, room.id, 'outpost', room.game.fleets[0].id],
    ['machination.object-reference', 1, room.id, 'hauler', String(room.game.fleets[0].id)],
  ]) assert.notEqual(contact.ref, createHmac('sha256', Buffer.from(room.referenceKey, 'hex')).update(JSON.stringify(tuple)).digest('hex'));
  await h.request(`${h.path}/haulers`, host, { requestId: randomUUID(), revision: seen.revision, action: 'recall', fleet: own.id }, 409);
  await h.request(`${h.path}/haulers`, host, { requestId: randomUUID(), revision: seen.revision, action: 'recall', fleet: contact.ref }, 409); assert.ok(!JSON.stringify(seen).includes(room.referenceKey));
  assert.deepEqual(Object.keys(seen.references!).sort(), ['haulers', 'outposts', 'version']);
  const past = await h.request(`${h.path}/history?hour=0.125`, host);
  assert.equal(past.game.hour, 0.125); assert.equal(references(past).haulers.length, 1); assert.ok(!references(past).haulers.some(r => r.ref === contact.ref));
  const contactPast = await h.request(`${h.path}/history?hour=3`, host);
  assert.deepEqual(references(contactPast), references(seen));
  h.setHour(8);
  const gone = await h.request(h.path, host); assert.equal(references(gone).haulers.length, 0);
  assert.deepEqual(references(await h.request(`${h.path}/history?hour=3`, host)), references(seen));
  await h.restart();
  assert.deepEqual(references(await h.request(`${h.path}/history?hour=3`, host)), references(seen));
  await h.request(`${h.path}/history?hour=9`, host, undefined, 400);
  await h.request(`${h.path}/references`, host, undefined, 404);
  await h.request(h.path, contact.ref, undefined, 401);
});

test('legacy rooms migrate durably before serving references and malformed keys fail closed', async t => {
  const h = await setup(t); const host = h.tokens[0]!;
  const original = JSON.parse(await readFile(h.file, 'utf8')); delete original.rooms[0].referenceKey;
  await writeFile(h.file, JSON.stringify(original));
  await h.restart();
  const migrated = JSON.parse(await readFile(h.file, 'utf8'));
  assert.match(migrated.rooms[0].referenceKey, /^[a-f0-9]{64}$/);
  assert.deepEqual(migrated.rooms[0].game, original.rooms[0].game, 'migration does not change game saves');
  assert.deepEqual(migrated.rooms[0].replay, original.rooms[0].replay, 'migration does not change replay archives');
  const frame = await h.request(h.path, host); references(frame);
  await h.restart(); assert.deepEqual(references(await h.request(h.path, host)), references(frame));
  for (const key of [null, '', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64), 123, ['a'.repeat(64)], { key: 'a'.repeat(64) }]) {
    const damaged = structuredClone(migrated); damaged.rooms[0].referenceKey = key;
    await writeFile(h.file, JSON.stringify(damaged));
    await assert.rejects(() => GameService.open(h.file), /Damaged object reference key/);
    assert.deepEqual(JSON.parse(await readFile(h.file, 'utf8')), damaged, 'invalid data is never repaired or overwritten');
  }
  await writeFile(h.file, JSON.stringify(original));
  // A directory at the temporary path prevents an atomic migration write.
  const { mkdir } = await import('node:fs/promises'); await mkdir(`${h.file}.tmp`);
  await assert.rejects(() => GameService.open(h.file), /EISDIR/);
  assert.deepEqual(JSON.parse(await readFile(h.file, 'utf8')), original);
  await rm(`${h.file}.tmp`, { recursive: true });
  const retried = await GameService.open(h.file, () => 0, createLegacyGame);
  const durable = JSON.parse(await readFile(h.file, 'utf8')); assert.match(durable.rooms[0].referenceKey, /^[a-f0-9]{64}$/);
  const retry = await retried.snapshot(frame.id, host); references(retry);
  assert.equal(retry.references!.outposts[0]!.ref, createHmac('sha256', Buffer.from(durable.rooms[0].referenceKey, 'hex')).update(JSON.stringify(['machination.object-reference', 1, frame.id, 'outpost', retry.game.rocks[0]!.id])).digest('hex'));
});

test('HTTP failed recovery writes roll back, retry, and preserve room references across replacement and restart', async t => {
  const h = await setup(t); const host = h.tokens[0]!, replacement = secret(), recovery = secret();
  const start = await h.request(h.path, host);
  const launched = await h.request(`${h.path}/orders`, host, { requestId: randomUUID(), revision: start.revision, from: 'a', to: 'b', drones: 10 });
  await h.request(`${h.path}/recovery`, host, { requestId: randomUUID(), secret: recovery });
  const before = await readFile(h.file, 'utf8');
  const state = join(h.dir, 'state'), parked = join(h.dir, 'parked');
  await rename(state, parked); await writeFile(state, 'blocked');
  await h.request(`${h.path}/recover`, replacement, { secret: recovery }, 500);
  await rm(state); await rename(parked, state);
  assert.equal(await readFile(h.file, 'utf8'), before);
  assert.deepEqual(references(await h.request(h.path, host)), references(launched));
  await h.request(h.path, replacement, undefined, 401);
  const restored = await h.request(`${h.path}/recover`, replacement, { secret: recovery });
  assert.deepEqual(restored.game, launched.game); assert.deepEqual(references(restored), references(launched));
  await h.request(h.path, host, undefined, 401);
  await h.restart();
  assert.deepEqual(references(await h.request(`${h.path}/recover`, replacement, { secret: recovery })), references(launched));
  assert.deepEqual(references(await h.request(`${h.path}/history?hour=0`, replacement)), references(launched));
});

test('literal references retain bilateral/public/group retry semantics without adding audience or action rights', async t => {
  const h = await setup(t); const [host, rival, third] = h.tokens as [string, string, string];
  const initial = await h.request(h.path, host);
  const ref = references(initial).outposts[0]!.ref;
  const text = `Inspect [[machination:v1:${initial.id}:outpost:${ref}:0.125]] please.`;
  const bilateral = { requestId: randomUUID(), to: 'vesper', text };
  const once = await h.request(`${h.path}/messages`, host, bilateral);
  assert.equal(once.messages.length, 1); assert.equal(once.messages[0]!.text, text);
  assert.deepEqual((await h.request(`${h.path}/messages`, host, bilateral)).messages, once.messages);
  assert.equal((await h.request(h.path, third)).messages.length, 0);
  const group = await h.request(`${h.path}/groups`, host, { requestId: randomUUID(), name: 'Only us', members: ['you', 'vesper'] });
  const groupId = group.groups![0]!.id;
  const publicPost = { requestId: randomUUID(), channelId: 'public', text };
  const privatePost = { requestId: randomUUID(), channelId: groupId, text };
  await h.request(`${h.path}/channel-messages`, host, publicPost);
  await h.request(`${h.path}/channel-messages`, host, privatePost);
  await h.restart();
  assert.equal((await h.request(`${h.path}/messages`, host, bilateral)).messages.length, 1);
  for (const payload of [publicPost, privatePost]) {
    const retry = await h.request(`${h.path}/channel-messages`, host, payload);
    assert.deepEqual(retry.channels!.find(c => c.id === payload.channelId)!.messages.map(m => m.text), [text]);
    await h.request(`${h.path}/channel-messages`, host, { ...payload, text: text + ' changed' }, 409);
  }
  await h.request(`${h.path}/messages`, host, { ...bilateral, text: text + ' changed' }, 409);
  const outsider = await h.request(h.path, third);
  assert.equal(outsider.channels!.length, 1); assert.equal(outsider.channels![0]!.messages[0]!.text, text);
  assert.equal((await h.request(h.path, rival)).channels!.find(c => c.id === groupId)!.messages[0]!.text, text);
  await h.request(`${h.path}/channel-messages`, third, { requestId: randomUUID(), channelId: groupId, text }, 404);
  await h.request(`${h.path}/haulers`, host, { requestId: randomUUID(), revision: initial.revision, action: 'recall', fleet: ref }, 409);
  assert.deepEqual(references(await h.request(h.path, host)), references(initial));
});

test('HTTP failed launches expose no sidecar and consume neither identity nor retry receipt', async t => {
  const h = await setup(t); const host = h.tokens[0]!;
  const initial = await h.request(h.path, host);
  const order = { requestId: randomUUID(), revision: initial.revision, from: 'a', to: 'b', drones: 10 };
  const before = await readFile(h.file, 'utf8');
  const { mkdir } = await import('node:fs/promises'); await mkdir(`${h.file}.tmp`);
  const failed = await h.request(`${h.path}/orders`, host, order, 500);
  assert.equal(failed.references, undefined); assert.equal(failed.game, undefined);
  assert.equal(await readFile(h.file, 'utf8'), before);
  await rm(`${h.file}.tmp`, { recursive: true });
  const unchanged = await h.request(h.path, host);
  assert.deepEqual(unchanged.game, initial.game); assert.equal(unchanged.revision, initial.revision);
  assert.deepEqual(references(unchanged), references(initial));
  const accepted = await h.request(`${h.path}/orders`, host, order);
  assert.equal(references(accepted).haulers.length, 1);
  const room = JSON.parse(await readFile(h.file, 'utf8')).rooms[0];
  assert.equal(room.game.fleets[0].id, 1);
  await h.restart();
  const retry = await h.request(`${h.path}/orders`, host, order);
  assert.deepEqual(retry.game, accepted.game); assert.equal(retry.revision, accepted.revision);
  assert.deepEqual(references(retry), references(accepted));
});
