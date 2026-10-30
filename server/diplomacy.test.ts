import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { GameService } from './service';
import { createApi } from './http';
import { DIPLOMACY_LIMITS } from '../src/contracts/protocol';
import { createLegacyGame } from '../src/game/legacy';
const secret = () => randomBytes(32).toString('hex');
async function fixture(t: import('node:test').TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'machination-diplomacy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'rooms.json');
  const service = await GameService.open(file, () => 1000, createLegacyGame);
  const tokens = [secret(), secret(), secret()];
  const room = await service.create(tokens[0]!);
  await service.join(room.invite, tokens[1]!); await service.join(room.invite, tokens[2]!);
  const group = { requestId: randomUUID(), name: 'Quiet agreement', members: ['you', 'vesper'] as ('you' | 'vesper')[] };
  return { file, service, tokens, room, group };
}
test('fixed private membership, separate public and bilateral history, retries, restart, and recovery', async t => {
  const { service, file, tokens: [a, b, c], room, group } = await fixture(t);
  const first = await service.createGroup(room.id, a!, group); const id = first.groups![0]!.id;
  assert.match(id, /^[a-f0-9]{32}$/);
  assert.equal((await service.createGroup(room.id, a!, { ...group, members: ['vesper', 'you'] })).groups!.length, 1);
  await assert.rejects(service.createGroup(room.id, a!, { ...group, name: 'changed' }), /different content/);
  await assert.rejects(service.createGroup(room.id, a!, { ...group, requestId: randomUUID(), members: ['vesper', 'null'] as never }), /fixed members/);
  const message = { requestId: randomUUID(), channelId: id, text: 'Private' };
  const sent = await service.channelMessage(room.id, b!, message);
  const messageId = sent.channels!.find(ch => ch.id === id)!.messages[0]!.id;
  assert.match(messageId, /^[a-f0-9]{32}$/);
  assert.deepEqual((await service.channelMessage(room.id, b!, message)).channels, sent.channels);
  await assert.rejects(service.channelMessage(room.id, b!, { ...message, text: 'changed' }), /different content/);
  await service.channelMessage(room.id, c!, { requestId: randomUUID(), channelId: 'public', text: 'Public' });
  await service.message(room.id, a!, { requestId: randomUUID(), to: 'vesper', text: 'Bilateral' });
  const outsider = await service.snapshot(room.id, c!);
  assert.deepEqual(outsider.groups, []); assert.equal(outsider.channels!.length, 1); assert.deepEqual(outsider.messages, []);
  assert.equal(outsider.channels![0]!.messages[0]!.text, 'Public');
  assert.ok(!JSON.stringify(outsider).includes(id)); assert.ok(!JSON.stringify(outsider).includes(messageId));
  const restarted = await GameService.open(file, () => 1000, createLegacyGame);
  const restored = await restarted.snapshot(room.id, a!);
  assert.equal(restored.messages[0]!.text, 'Bilateral');
  assert.deepEqual(restored.channels!.find(ch => ch.id === id)!.messages.map(m => m.text), ['Private']);
  const recovery = secret(), replacement = secret();
  await restarted.setRecovery(room.id, a!, { requestId: randomUUID(), secret: recovery });
  const recovered = await restarted.recover(room.id, replacement, { secret: recovery });
  assert.deepEqual(recovered.channels, restored.channels);
  assert.deepEqual(recovered.groups, restored.groups);
  await assert.rejects(restarted.snapshot(room.id, a!), /does not control/);
  assert.equal((await restarted.createGroup(room.id, replacement, group)).groups!.length, 1);
});
test('HTTP authentication and indistinguishable unknown/nonmember channel failures', async t => {
  const { service, tokens: [a, , c], room, group } = await fixture(t);
  const server = createApi(service); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/v1/games/${room.id}`;
  const post = async (action: string, token: string, payload: unknown) => {
    const res = await fetch(`${base}/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return { status: res.status, data: await res.json() };
  };
  const made = await post('groups', a!, group); assert.equal(made.status, 200);
  const id = made.data.groups[0].id;
  assert.equal((await post('groups', secret(), group)).status, 401);
  for (const channelId of [id, 'absent']) {
    const res = await post('channel-messages', c!, { requestId: randomUUID(), channelId, text: 'spy' });
    assert.equal(res.status, 404); assert.equal(res.data.issues[0].issue, 'channel.not_found');
  }
  assert.equal((await post('channel-messages', secret(), { requestId: randomUUID(), channelId: 'public', text: 'spy' })).status, 401);
  const retry = { requestId: randomUUID(), channelId: id, text: 'allowed later' };
  assert.equal((await post('channel-messages', c!, retry)).status, 404);
  assert.equal((await post('channel-messages', c!, { ...retry, channelId: 'public' })).status, 200, 'refusal does not consume a receipt');
  assert.equal((await post('groups', a!, { ...group, requestId: randomUUID(), name: 'x'.repeat(61) })).status, 400);
  assert.equal((await post('channel-messages', a!, { ...retry, requestId: randomUUID(), text: 'x'.repeat(1001) })).status, 400);
});
test('failed durable writes consume neither group/message IDs nor receipts', async t => {
  const { service, file, tokens: [a], room, group } = await fixture(t);
  const before = await readFile(file, 'utf8');
  await mkdir(`${file}.tmp`);
  await assert.rejects(service.createGroup(room.id, a!, group));
  assert.equal(await readFile(file, 'utf8'), before);
  await rm(`${file}.tmp`, { recursive: true });
  const made = await service.createGroup(room.id, a!, { ...group, name: 'Retry with new content' });
  assert.equal(made.groups!.length, 1);
  const message = { requestId: randomUUID(), channelId: made.groups![0]!.id, text: 'failed' };
  const persisted = await readFile(file, 'utf8'); await mkdir(`${file}.tmp`);
  await assert.rejects(service.channelMessage(room.id, a!, message));
  assert.equal(await readFile(file, 'utf8'), persisted); await rm(`${file}.tmp`, { recursive: true });
  const retried = await service.channelMessage(room.id, a!, { ...message, text: 'successful' });
  assert.deepEqual(retried.channels!.find(ch => ch.id === message.channelId)!.messages.map(m => m.text), ['successful']);
});
test('old rooms migrate additively, and eliminated seats retain all chat permissions', async t => {
  const { service, file, tokens: [a, b], room, group } = await fixture(t);
  await service.message(room.id, a!, { requestId: randomUUID(), to: 'vesper', text: 'Old history' });
  const db = JSON.parse(await readFile(file, 'utf8')); delete db.rooms[0].diplomacy; delete db.rooms[0].replay;
  for (const rock of db.rooms[0].game.rocks) if (rock.owner === 'vesper') rock.owner = 'you';
  await writeFile(file, JSON.stringify(db));
  const migrated = await GameService.open(file, () => 1000, createLegacyGame);
  assert.equal((await migrated.snapshot(room.id, b!)).messages[0]!.text, 'Old history');
  const made = await migrated.createGroup(room.id, b!, group);
  for (const channelId of ['public', made.groups![0]!.id]) await migrated.channelMessage(room.id, b!, { requestId: randomUUID(), channelId, text: 'Still here' });
  await migrated.message(room.id, b!, { requestId: randomUUID(), to: 'you', text: 'Still here too' });
  assert.equal((await migrated.snapshot(room.id, a!)).messages.length, 2);
});
test('participant group caps and independent channel retention protect unrelated history', async t => {
  const { service, file, tokens: [a, b, c], room, group } = await fixture(t);
  const made = await service.createGroup(room.id, a!, group); const privateId = made.groups![0]!.id;
  await service.channelMessage(room.id, a!, { requestId: randomUUID(), channelId: privateId, text: 'Protected' });
  const other = await service.createGroup(room.id, b!, { ...group, requestId: randomUUID(), members: ['vesper', 'null'] });
  const otherId = other.groups!.find(g => g.id !== privateId)!.id;
  for (let i = 0; i < DIPLOMACY_LIMITS.messagesPerChannel + 2; i++) {
    await service.channelMessage(room.id, c!, { requestId: randomUUID(), channelId: otherId, text: String(i) });
    await service.channelMessage(room.id, c!, { requestId: randomUUID(), channelId: 'public', text: String(i) });
  }
  const view = await service.snapshot(room.id, a!);
  assert.deepEqual(view.channels!.find(ch => ch.id === privateId)!.messages.map(m => m.text), ['Protected']);
  assert.equal(view.channels![0]!.messages.length, 100); assert.equal(view.channels![0]!.messages[0]!.text, '2');
  assert.equal((await service.snapshot(room.id, c!)).channels!.find(ch => ch.id === otherId)!.messages.length, 100);
  for (let i = 2; i < DIPLOMACY_LIMITS.groupsPerParticipant; i++) await service.createGroup(room.id, b!, { ...group, requestId: randomUUID() });
  const capped = { ...group, requestId: randomUUID() };
  await assert.rejects(service.createGroup(room.id, a!, capped), /participant.*limit/);
  const db = JSON.parse(await readFile(file, 'utf8'));
  assert.ok(!Object.keys(db.rooms[0].receipts).some(key => key.endsWith(capped.requestId)));
  const restarted = await GameService.open(file, () => 1000, createLegacyGame);
  assert.equal((await restarted.snapshot(room.id, b!)).groups!.length, 16);
});
