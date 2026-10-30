import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { GameService } from './service';
import { createApi } from './http';
import { NOTIFICATION_LIMITS } from './notifications';
import type { Database } from './database';
import type { MessageNotificationSettings } from '../src/contracts/notifications';

const secret = () => randomBytes(32).toString('hex');
const device = () => randomBytes(32).toString('hex');
const pushToken = () => `ExponentPushToken[${randomBytes(11).toString('hex')}]`;
const enable = (deviceId: string, revision: number, expoPushToken = pushToken(), requestId = randomUUID()) => ({ requestId, deviceId, revision, enabled: true, expoPushToken });
const disable = (deviceId: string, revision: number, requestId = randomUUID()) => ({ requestId, deviceId, revision, enabled: false });

async function fixture(t: TestContext, notifications = true) {
  const dir = await mkdtemp(join(tmpdir(), 'machination-notifications-'));
  t.after(async () => { await chmod(dir, 0o700).catch(() => undefined); await rm(dir, { recursive: true, force: true }); });
  const file = join(dir, 'games.json');
  const clock = { now: 1_000_000 };
  const open = (enabled = notifications) => GameService.open(file, () => clock.now, undefined, { notifications: enabled });
  const service = await open();
  const tokens = [secret(), secret(), secret()];
  const room = await service.create(tokens[0]!);
  await service.join(room.invite, tokens[1]!); await service.join(room.invite, tokens[2]!);
  await service.start(room.id, tokens[0]!);
  const stored = async () => JSON.parse(await readFile(file, 'utf8')) as Database;
  return { dir, file, clock, open, service, tokens, room, stored };
}
async function listen(t: TestContext, service: GameService) {
  const server = createApi(service); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return async (path: string, token: string, payload?: unknown) => {
    const response = await fetch(`${base}${path}`, { method: payload === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const text = await response.text();
    return { status: response.status, text, data: JSON.parse(text) as MessageNotificationSettings & { issues?: { issue: string }[] } };
  };
}

test('HTTP preferences are seat-scoped, revisioned, retry-safe, strict, and never touch game state', async t => {
  const { service, tokens: [a, b], room, clock, stored } = await fixture(t);
  const request = await listen(t, service);
  const path = `/v1/games/${room.id}/notifications`;
  const id = device(); const token = pushToken();
  const initial = await request(`${path}?deviceId=${id}`, a!);
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.data, { gameId: room.id, deviceId: id, revision: 0, available: true, enabled: false });
  const before = await stored();
  clock.now += 5 * 3_600_000;
  const first = enable(id, 0, token);
  const on = await request(path, a!, first);
  assert.equal(on.status, 200);
  assert.equal(on.data.enabled, true); assert.equal(on.data.revision, 1); assert.match(on.data.bindingId!, /^[a-f0-9]{32}$/);
  assert.ok(!on.text.includes(token) && !on.text.includes('generation'), 'responses expose no push token or credential material');
  const after = await stored();
  assert.deepEqual(after.rooms, before.rooms, 'preferences do not settle time, renew activity, revise orders, or enter replay');
  assert.deepEqual((await request(path, a!, first)).data, on.data, 'identical retry returns the current view');
  assert.equal((await request(path, a!, { ...first, revision: 1 })).data.issues![0]!.issue, 'command.conflict.reused_id');
  const off = await request(path, a!, disable(id, 1));
  assert.deepEqual(off.data, { gameId: room.id, deviceId: id, revision: 2, available: true, enabled: false });
  assert.deepEqual((await request(path, a!, first)).data, off.data, 'an old enable retry does not reapply');
  assert.equal((await request(path, a!, enable(id, 1))).data.issues![0]!.issue, 'notification.conflict.stale');
  assert.deepEqual((await request(`${path}?deviceId=${id}`, b!)).data, { gameId: room.id, deviceId: id, revision: 0, available: true, enabled: false }, 'another seat never sees this binding');
  for (const [payload, issue] of [
    [{ ...enable(id, 2), extra: true }, 'notification.validation.payload'],
    [{ ...disable(id, 2), expoPushToken: token }, 'notification.validation.payload'],
    [{ requestId: randomUUID(), deviceId: id, revision: 2, enabled: true }, 'notification.validation.payload'],
    [enable(id, 2, 'not-a-token'), 'notification.validation.payload'],
    [enable('A'.repeat(64), 2), 'notification.validation.payload'],
    [{ ...enable(id, 2), revision: -1 }, 'notification.validation.payload'],
  ] as const) assert.equal((await request(path, a!, payload)).data.issues![0]!.issue, issue);
  assert.equal((await request(`${path}?deviceId=short`, a!)).status, 400);
  assert.equal((await request(`${path}?deviceId=${id}&deviceId=${id}`, a!)).status, 400);
  assert.equal((await request(`${path}?deviceId=${id}&x=1`, a!)).status, 400);
  assert.equal((await request(`${path}?deviceId=${id}`, secret())).status, 401);
  assert.equal((await request(path, secret(), enable(id, 2))).status, 401);
});

test('new messages enqueue one generic, audience-scoped job per enabled binding inside the message transaction', async t => {
  const { service, tokens: [a, b, c], room, stored, open } = await fixture(t);
  const ids = [device(), device(), device()];
  const bindings = await Promise.all([a, b, c].map((token, i) => service.setNotifications(room.id, token!, enable(ids[i]!, 0))));
  const bindingOf = (i: number) => bindings[i]!.bindingId!;
  const queued = async () => (await stored()).notifications!.jobs.map(job => job.bindingId).sort();

  await service.channelMessage(room.id, b!, { requestId: randomUUID(), channelId: 'public', text: 'Opening' });
  assert.deepEqual(await queued(), [bindingOf(0), bindingOf(2)].sort(), 'public: the sender is excluded');
  const drained = await service.notificationQueue().claimSends('drain');
  await service.notificationQueue().finishSends(drained.lease, new Map(drained.items.map(item => [item.jobId, { kind: 'drop' as const }])));
  assert.deepEqual(await queued(), []);
  const bilateral = { requestId: randomUUID(), to: 'vesper' as const, text: 'Secret plan at Ceto' };
  await service.message(room.id, a!, bilateral);
  assert.deepEqual(await queued(), [bindingOf(1)], 'bilateral: only the recipient');
  await service.message(room.id, a!, bilateral);
  assert.deepEqual(await queued(), [bindingOf(1)], 'request retries add no job');
  await service.message(room.id, c!, { requestId: randomUUID(), to: 'vesper', text: 'Second while queued' });
  assert.equal((await queued()).length, 1, 'a queued notification coalesces later messages for the same binding');

  const group = (await service.createGroup(room.id, b!, { requestId: randomUUID(), name: 'Pact', members: ['you', 'vesper'] })).groups![0]!.id;
  await service.channelMessage(room.id, b!, { requestId: randomUUID(), channelId: group, text: 'Group only' });
  assert.deepEqual(await queued(), [bindingOf(0), bindingOf(1)].sort(), 'group: members except the sender');
  await service.setNotifications(room.id, a!, disable(ids[0]!, 1));
  assert.deepEqual(await queued(), [bindingOf(1)], 'disabling removes queued work');
  await service.channelMessage(room.id, b!, { requestId: randomUUID(), channelId: 'public', text: 'Everyone' });
  assert.deepEqual(await queued(), [bindingOf(1), bindingOf(2)].sort(), 'public: every enabled seat except the sender; disabled seats get nothing');

  const db = await stored();
  assert.ok(!JSON.stringify(db.notifications!.jobs).match(/Secret|Group only|Everyone|Pact/));
  const claim = await service.notificationQueue().claimSends('test');
  assert.equal(claim.items.length, 2);
  for (const { message } of claim.items) {
    assert.deepEqual(Object.keys(message.data).sort(), ['bindingId', 'gameId', 'kind', 'notificationId', 'version']);
    assert.deepEqual([message.title, message.body, message.channelId, message.data.kind, message.data.version, message.data.gameId], ['Machination', 'New transmission received.', 'machination-messages', 'machination.message', 1, room.id]);
    assert.equal(message.collapseId, message.data.notificationId); assert.equal(message.tag, message.data.notificationId);
    assert.ok(!JSON.stringify(message).match(/Secret|Group|Everyone|Pact|vesper|null/));
  }
  const restarted = await open();
  assert.deepEqual((await stored()).notifications!.jobs.length, 2, 'jobs survive restart');
  await restarted.message(room.id, a!, bilateral);
  assert.equal((await stored()).notifications!.jobs.length, 2, 'restart plus retry creates no duplicate job');
});

test('a failed message write rolls back its job, and the next accepted message still enqueues', async t => {
  const { dir, service, tokens: [a, b], room, stored } = await fixture(t);
  await service.setNotifications(room.id, b!, enable(device(), 0));
  const message = { requestId: randomUUID(), to: 'vesper' as const, text: 'Write fails' };
  await chmod(dir, 0o500);
  await assert.rejects(service.message(room.id, a!, message));
  await chmod(dir, 0o700);
  assert.equal((await stored()).notifications!.jobs.length, 0);
  assert.equal((await service.snapshot(room.id, b!)).messages.length, 0);
  await service.message(room.id, a!, message);
  assert.equal((await stored()).notifications!.jobs.length, 1);
  assert.equal((await service.snapshot(room.id, b!)).messages.length, 1);
});

test('servers without delivery report unavailable, reject enable, permit disable, and never enqueue', async t => {
  const { service, open, tokens: [a, b], room, stored } = await fixture(t);
  const id = device();
  await service.setNotifications(room.id, b!, enable(id, 0));
  const off = await open(false);
  assert.deepEqual(await off.notificationSettings(room.id, b!, id), { gameId: room.id, deviceId: id, revision: 1, available: false, enabled: true, bindingId: (await service.notificationSettings(room.id, b!, id)).bindingId });
  await off.message(room.id, a!, { requestId: randomUUID(), to: 'vesper', text: 'No push' });
  assert.equal((await stored()).notifications!.jobs.length, 0);
  await assert.rejects(off.setNotifications(room.id, a!, enable(device(), 0)), { status: 503, code: 'notification.unavailable.delivery' });
  assert.equal((await off.setNotifications(room.id, b!, disable(id, 1))).enabled, false);
});

test('recovery and account linking invalidate old bindings; a new enable gets a new binding ID', async t => {
  const { service, tokens: [a, b], room, stored } = await fixture(t);
  const id = device();
  const before = await service.setNotifications(room.id, a!, enable(id, 0));
  await service.message(room.id, b!, { requestId: randomUUID(), to: 'you', text: 'Queued' });
  assert.equal((await stored()).notifications!.jobs.length, 1);
  const recovery = secret(), replacement = secret();
  await service.setRecovery(room.id, a!, { requestId: randomUUID(), secret: recovery });
  await service.recover(room.id, replacement, { secret: recovery });
  assert.equal((await stored()).notifications!.jobs.length, 0, 'recovery removes the old generation\'s queued work');
  assert.ok(!(await stored()).notifications!.bindings[0]!.token);
  assert.deepEqual(await service.notificationSettings(room.id, replacement, id), { gameId: room.id, deviceId: id, revision: 1, available: true, enabled: false });
  await service.message(room.id, b!, { requestId: randomUUID(), to: 'you', text: 'Not delivered to the old binding' });
  assert.equal((await stored()).notifications!.jobs.length, 0);
  const after = await service.setNotifications(room.id, replacement, enable(id, 1));
  assert.notEqual(after.bindingId, before.bindingId);

  const linked = await service.setNotifications(room.id, b!, enable(device(), 0));
  await service.linkAccount(room.id, b!, { accountId: 'user_vesper' });
  const [bound] = (await stored()).notifications!.bindings.filter(binding => binding.faction === 'vesper');
  assert.equal(bound!.enabled, false); assert.equal(bound!.token, undefined);
  assert.equal((await service.notificationSettings(room.id, { accountId: 'user_vesper' }, bound!.deviceId)).enabled, false);
  assert.ok(linked.bindingId);
});

test('one push token has one current binding across rooms, and device records are bounded per seat', async t => {
  const { service, tokens: [a], room, stored } = await fixture(t);
  const id = device(); const token = pushToken();
  await service.setNotifications(room.id, a!, enable(id, 0, token));
  const other = secret();
  const second = await service.create(other);
  const moved = await service.setNotifications(second.id, other, enable(id, 0, token));
  assert.equal(moved.enabled, true);
  assert.equal((await service.notificationSettings(room.id, a!, id)).enabled, false, 'the former binding is detached');
  assert.equal((await stored()).notifications!.bindings.filter(binding => binding.token === token).length, 1);

  const devices = Array.from({ length: NOTIFICATION_LIMITS.devicesPerSeat - 1 }, device);
  for (const d of devices) await service.setNotifications(room.id, a!, enable(d, 0));
  await service.setNotifications(room.id, a!, enable(device(), 0));
  assert.equal((await stored()).notifications!.bindings.filter(b => b.roomId === room.id && b.faction === 'you').length, NOTIFICATION_LIMITS.devicesPerSeat, 'the oldest disabled record is replaced');
  const extra = device();
  const floor = (await service.notificationSettings(room.id, a!, extra)).revision;
  assert.ok(floor > 0, 'unknown devices read the seat floor after an eviction');
  await assert.rejects(service.setNotifications(room.id, a!, enable(extra, floor)), { status: 409, code: 'notification.capacity.devices' });
});

test('older databases load unchanged, ordinary flows add no notification state, and damaged state is refused', async t => {
  const { file, open, tokens: [a], room, stored } = await fixture(t);
  const legacy = await stored();
  assert.equal(legacy.notifications, undefined);
  const reopened = await open();
  await reopened.message(room.id, a!, { requestId: randomUUID(), to: 'vesper', text: 'Plain' });
  assert.equal((await stored()).notifications, undefined);
  await reopened.setNotifications(room.id, a!, enable(device(), 0));
  const db = await stored();
  db.notifications!.bindings[0]!.faction = 'zenith';
  await writeFile(file, JSON.stringify(db));
  await assert.rejects(open(), /Damaged notification metadata/);
});

test('restart rejects inconsistent notification bindings, ledgers, and delivery metadata without rewriting the file', async t => {
  const { service, file, open, tokens: [a, b], room, stored, clock } = await fixture(t);
  await service.setNotifications(room.id, b!, enable(device(), 0));
  await service.message(room.id, a!, { requestId: randomUUID(), to: 'vesper', text: 'Restart validation' });
  const database = await stored();
  const state = database.notifications!;
  const binding = state.bindings[0]!;
  const job = state.jobs[0]!;
  const bindingState = (change: object) => ({ ...state, bindings: [{ ...binding, ...change }] });
  const jobState = (change: object) => ({ ...state, jobs: [{ ...job, ...change }] });
  const lease = { owner: 'worker', token: 'a'.repeat(32), until: clock.now + 60_000 };
  const ticket = { ticketId: 'provider-ticket', ticketAt: clock.now };
  const ledger = { roomId: room.id, faction: binding.faction, keys: ['1|incoming-threat'] };
  const floor = { roomId: room.id, faction: binding.faction, revision: 2 };
  const invalid: [string, unknown][] = [
    ['missing bindings', { jobs: [] }], ['missing jobs', { bindings: [] }],
    ['duplicate binding', { ...state, bindings: [binding, binding] }],
    ['unknown room', bindingState({ roomId: 'unknown' })], ['unknown seat', bindingState({ faction: 'zenith' })],
    ['bad device', bindingState({ deviceId: 'not-hex' })], ['bad generation', bindingState({ generation: 'not-hex' })],
    ['bad revision', bindingState({ revision: -1 })], ['enabled without token', bindingState({ token: undefined })],
    ['disabled with token', bindingState({ enabled: false })], ['invalid token', bindingState({ token: 'not-a-token' })],
    ['invalid consent', bindingState({ incoming: false })], ['invalid requests', bindingState({ requests: [{ id: 'short', payload: '' }] })],
    ['duplicate floor', { ...state, floors: [floor, floor] }],
    ['invalid floor', { ...state, floors: [{ ...floor, revision: 0 }] }],
    ['duplicate ledger', { ...state, incoming: [ledger, ledger] }],
    ['unknown ledger seat', { ...state, incoming: [{ ...ledger, faction: 'zenith' }] }],
    ['duplicate threat', { ...state, incoming: [{ ...ledger, keys: ['threat', 'threat'] }] }],
    ['invalid threat', { ...state, incoming: [{ ...ledger, keys: [''] }] }],
    ['duplicate job', { ...state, jobs: [job, job] }], ['unknown binding', jobState({ bindingId: 'f'.repeat(32) })],
    ['mismatched room', jobState({ roomId: 'unknown' })], ['invalid attempts', jobState({ attempts: -1 })],
    ['invalid state', jobState({ state: 'unknown' })], ['queued lease', jobState({ lease })],
    ['sending without lease', jobState({ state: 'sending' })],
    ['invalid lease', jobState({ state: 'sending', lease: { ...lease, token: 'short' } })],
    ['queued ticket', jobState(ticket)], ['ticketed without ticket', jobState({ state: 'ticketed' })],
    ['checking without lease', jobState({ state: 'checking', ...ticket })], ['bad token hash', jobState({ tokenHash: 'short' })],
    ['message with alert', jobState({ alert: { faction: binding.faction, fleet: 1, key: '1|threat' } })],
    ['incoming without alert', jobState({ kind: 'incoming' })],
    ['incoming wrong faction', jobState({ kind: 'incoming', alert: { faction: 'you', fleet: 1, key: '1|threat' } })],
    ['incoming wrong key', jobState({ kind: 'incoming', alert: { faction: binding.faction, fleet: 1, key: '2|threat' } })],
  ];
  for (const [name, notifications] of invalid) {
    const bytes = JSON.stringify({ ...database, notifications });
    await writeFile(file, bytes);
    await assert.rejects(open(), /Damaged notification metadata/, name);
    assert.equal(await readFile(file, 'utf8'), bytes, `${name}: damaged data stays recoverable`);
  }
  for (const notifications of [
    state, jobState({ state: 'sending', lease }), jobState({ state: 'ticketed', ...ticket }),
    jobState({ state: 'checking', lease, ...ticket }),
    { ...state, floors: [floor], incoming: [ledger] },
    jobState({ kind: 'incoming', alert: { faction: binding.faction, fleet: 1, key: '1|threat' } }),
  ]) {
    const bytes = JSON.stringify({ ...database, notifications });
    await writeFile(file, bytes);
    await open();
    assert.equal(await readFile(file, 'utf8'), bytes, 'valid restarts preserve pending work');
  }
});

test('an evicted device record cannot be resurrected by an old enable, its retry, or an outstanding request', async t => {
  const { service, tokens: [a], room, stored } = await fixture(t);
  const evicted = device();
  const firstEnable = enable(evicted, 0);
  await service.setNotifications(room.id, a!, firstEnable);
  const outstanding = disable(evicted, 1);
  await service.setNotifications(room.id, a!, outstanding);
  const lateEnable = enable(evicted, 2);
  for (let i = 0; i < NOTIFICATION_LIMITS.devicesPerSeat; i++) await service.setNotifications(room.id, a!, enable(device(), 0));
  const seat = () => stored().then(db => db.notifications!.bindings.filter(b => b.roomId === room.id && b.faction === 'you'));
  assert.ok(!(await seat()).some(b => b.deviceId === evicted), 'the disabled record was evicted');
  const freed = (await seat())[0]!;
  await service.setNotifications(room.id, a!, disable(freed.deviceId, freed.revision));

  for (const replay of [firstEnable, outstanding, lateEnable, enable(evicted, 0), enable(evicted, 1)]) {
    await assert.rejects(service.setNotifications(room.id, a!, replay), { status: 409, code: 'notification.conflict.stale' }, JSON.stringify([replay.revision, replay.enabled]));
  }
  assert.ok(!(await seat()).some(b => b.deviceId === evicted), 'no rejected replay recreated the record');
  const fresh = await service.notificationSettings(room.id, a!, evicted);
  assert.ok(fresh.revision > lateEnable.revision, 'unknown devices read the seat floor, above every evicted revision');
  assert.equal(fresh.enabled, false);
  const again = await service.setNotifications(room.id, a!, enable(evicted, fresh.revision));
  assert.equal(again.enabled, true, 'an explicit enable after a fresh read still works');
  assert.equal(again.revision, fresh.revision + 1);
  const unrelated = await service.notificationSettings(room.id, a!, device());
  assert.equal(unrelated.revision, fresh.revision, 'the floor is per seat and only rises');
});

test('tokens accept any non-whitespace bracket content, and seat floors persist and are validated', async t => {
  const { service, open, file, tokens: [a], room, stored } = await fixture(t);
  const opaque = 'ExponentPushToken[ab+/=.:~_-9]';
  assert.equal((await service.setNotifications(room.id, a!, enable(device(), 0, opaque))).enabled, true);
  assert.equal((await service.setNotifications(room.id, a!, enable(device(), 0, 'ExpoPushToken[x]'))).enabled, true);
  for (const bad of ['ExponentPushToken[]', 'ExponentPushToken[a b]', 'ExponentPushToken[a]b]', 'ExponentPushToken[a\n]', 'PushToken[a]', `ExponentPushToken[${'a'.repeat(201)}]`]) {
    await assert.rejects(service.setNotifications(room.id, a!, enable(device(), 0, bad)), { status: 400 }, bad);
  }
  for (let i = 0; i < NOTIFICATION_LIMITS.devicesPerSeat; i++) {
    const d = device(); const on = await service.setNotifications(room.id, a!, enable(d, (await service.notificationSettings(room.id, a!, d)).revision));
    await service.setNotifications(room.id, a!, disable(d, on.revision));
  }
  const floor = (await stored()).notifications!.floors!;
  assert.equal(floor.length, 1); assert.ok(floor[0]!.revision >= 2);
  const restarted = await open();
  assert.equal((await restarted.notificationSettings(room.id, a!, device())).revision, floor[0]!.revision, 'the floor survives restart');
  const db = await stored();
  db.notifications!.floors!.push({ ...db.notifications!.floors![0]! });
  await writeFile(file, JSON.stringify(db));
  await assert.rejects(open(), /Damaged notification metadata/);
});

test('a second eviction raises an existing floor above the newly evicted record', async t => {
  const { service, tokens: [a], room, stored } = await fixture(t);
  const register = async (d: string) => service.setNotifications(room.id, a!, enable(d, (await service.notificationSettings(room.id, a!, d)).revision));
  const cycle = async (d: string) => { const on = await register(d); return service.setNotifications(room.id, a!, disable(d, on.revision)); };
  const first = device(); await cycle(first);
  for (let i = 0; i < NOTIFICATION_LIMITS.devicesPerSeat; i++) await cycle(device());
  const floor = () => stored().then(db => db.notifications!.floors![0]!.revision);
  const before = await floor();
  const [oldest] = (await stored()).notifications!.bindings.filter(b => b.faction === 'you').sort((x, y) => x.updatedAt - y.updatedAt);
  for (let i = 0; i < 6; i++) await cycle(oldest!.deviceId);
  const victim = (await stored()).notifications!.bindings.find(b => b.deviceId === oldest!.deviceId)!;
  assert.ok(victim.revision >= before, 'the victim is at or above the existing floor');
  for (const other of (await stored()).notifications!.bindings.filter(b => b.faction === 'you' && b.deviceId !== victim.deviceId)) await cycle(other.deviceId);
  await cycle(device());
  assert.ok(!(await stored()).notifications!.bindings.some(b => b.deviceId === victim.deviceId), 'the high-revision record was evicted');
  assert.ok(await floor() > victim.revision);
  await assert.rejects(service.setNotifications(room.id, a!, enable(victim.deviceId, victim.revision)), { status: 409, code: 'notification.conflict.stale' });
});
