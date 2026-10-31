import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { GameService } from './service';
import { createApi } from './http';
import { NotificationWorker } from './push-worker';
import { hostileIncoming, threatKey } from './incoming';
import type { PushProvider, Receipt, Ticket } from './expo-push';
import type { PushMessage } from './notifications';
import { NOTIFICATION_LIMITS, type Job } from './notifications';
import { createConfiguredGame } from '../src/game/world';
import type { Database } from './database';
import { advance, dispatch, type Game } from '../src/game/simulation';
import type { Snapshot } from '../src/contracts/protocol';
import { INCOMING_NOTIFICATION_CHANNEL, INCOMING_NOTIFICATION_KIND } from '../src/contracts/notifications';

const HOUR = 3_600_000;
const secret = () => randomBytes(32).toString('hex');
const device = () => randomBytes(32).toString('hex');
const pushToken = () => `ExponentPushToken[${randomBytes(11).toString('hex')}]`;
const ids = { home: '', near: '', far: '', enemy: '' };

/** Two seats on a wide map: the host's site "home", a nearby neutral "near", a distant neutral "far", and Vesper's "enemy" site with a navigator and pirate. */
function world(epoch = 0): Game {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, epoch, 73);
  game.rules!.map.width = 400; game.rules!.map.height = 400;
  game.rocks.forEach((rock, i) => Object.assign(rock, { productionAt: 1000, shieldAt: 1000, x: 260 + (i % 6) * 22, y: 260 + Math.floor(i / 6) * 22 }));
  const home = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const enemy = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  const [near, far] = game.rocks.filter(r => r.owner === null);
  Object.assign(home, { x: 20, y: 20, drones: 60 }); Object.assign(near!, { x: 20, y: 34, drones: 1 });
  Object.assign(far!, { x: 20, y: 200, drones: 1 }); Object.assign(enemy, { x: 48, y: 27, drones: 60 });
  enemy.specialists!.push({ id: 'enemy-navigator', owner: 'vesper', kind: 'navigator' }, { id: 'enemy-pirate', owner: 'vesper', kind: 'pirate' });
  Object.assign(ids, { home: home.id, near: near!.id, far: far!.id, enemy: enemy.id });
  return game;
}

async function fixture(t: TestContext, initial: () => Game = world) {
  const dir = await mkdtemp(join(tmpdir(), 'machination-incoming-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'games.json');
  const clock = { now: 0 };
  const open = () => GameService.open(file, () => clock.now, initial, { notifications: true });
  let service = await open();
  const host = secret(), guest = secret();
  const room = await service.create(host); await service.join(room.invite, guest); await service.start(room.id, host);
  const stored = async () => JSON.parse(await readFile(file, 'utf8')) as Database;
  const subscribe = async (token: string, incoming = true, deviceId = device()) => {
    const view = await service.setNotifications(room.id, token, { requestId: randomUUID(), deviceId, revision: 0, enabled: true, expoPushToken: pushToken(), incoming }, 2);
    return { deviceId, view };
  };
  const snap = (token: string) => service.snapshot(room.id, token);
  const launch = async (token: string, from: string, to: string, drones: number, extra: object = {}) => {
    const s = await snap(token);
    return service.order(room.id, token, { requestId: randomUUID(), revision: s.revision, from, to, drones, ...extra });
  };
  const jobs = async () => (await stored()).notifications?.jobs ?? [];
  /** Claims and acknowledges, as the worker does, so claimed jobs are not reclaimed after their lease. */
  const claim = async () => {
    const queue = service.notificationQueue(); const result = await queue.claimSends('test-worker');
    await queue.finishSends(result.lease, new Map(result.items.map(item => [item.jobId, { kind: 'ticket' as const, id: `ticket-${item.jobId}` }])));
    return result;
  };
  const tick = () => service.notificationQueue().settleIncoming!();
  return { dir, file, clock, open, get service() { return service; }, reopen: async () => { service = await open(); }, host, guest, room, stored, subscribe, snap, launch, jobs, claim, tick };
}
const incomingJobs = (jobs: Job[]) => jobs.filter(j => j.kind === 'incoming');

test('blocking an attacker clears generic message alerts but preserves observed attacks and their consent', async t => {
  const f = await fixture(t);
  const subscription = await f.subscribe(f.host);
  f.clock.now = 0.05 * HOUR;
  await f.launch(f.guest, ids.enemy, ids.home, 25);
  f.clock.now = 0.3 * HOUR;
  await f.tick();
  await f.service.channelMessage(f.room.id, f.guest, { requestId: randomUUID(), channelId: 'public', text: 'An unwanted message' });
  assert.equal((await f.jobs()).length, 2);
  const before = await f.snap(f.host);
  await f.service.setMessageBlock(f.room.id, f.host, { requestId: randomUUID(), revision: 0, player: 'vesper', blocked: true });
  assert.equal((await f.jobs()).length, 1);
  assert.equal(incomingJobs(await f.jobs()).length, 1);
  assert.equal((await f.service.notificationSettings(f.room.id, f.host, subscription.deviceId, 2)).incoming, true);
  const after = await f.snap(f.host);
  assert.deepEqual(after.game, before.game);
  const claim = await f.claim();
  assert.equal(claim.items.length, 1);
  assert.equal(claim.items[0]!.message.data.kind, INCOMING_NOTIFICATION_KIND);
  assert.match(claim.items[0]!.message.body, /Incoming attack from Vesper: 25 drones/);
});

test('a launch at a consenting seat notifies after departure with zero clients, never during preparation or for the sender', async t => {
  const f = await fixture(t);
  const hostSub = await f.subscribe(f.host); await f.subscribe(f.guest);
  f.clock.now = 0.05 * HOUR;
  await f.launch(f.guest, ids.enemy, ids.home, 25);
  const before = (await f.stored()).rooms[0]!;
  f.clock.now = 0.12 * HOUR; assert.equal(await f.tick(), 1);
  assert.equal(incomingJobs(await f.jobs()).length, 0, 'a preparing launch is private');
  f.clock.now = 0.3 * HOUR; await f.tick();
  const queued = incomingJobs(await f.jobs());
  assert.equal(queued.length, 1, 'departure is observed by the background loop alone');
  assert.equal((await f.stored()).notifications!.bindings.find(b => b.id === queued[0]!.bindingId)!.deviceId, hostSub.deviceId, 'only the target seat is notified');
  const after = (await f.stored()).rooms[0]!;
  assert.deepEqual(after.seats, before.seats, 'background settlement renews no activity and revises no orders');
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.replay, before.replay, 'background settlement adds no commands');
  const { items } = await f.claim();
  assert.equal(items.length, 1);
  const message = items[0]!.message;
  assert.match(message.body, /^Incoming attack from Vesper: 25 drones arriving in \d+h \d+m\.$/);
  assert.equal(message.channelId, INCOMING_NOTIFICATION_CHANNEL);
  assert.deepEqual(Object.keys(message.data).sort(), ['bindingId', 'gameId', 'kind', 'notificationId', 'version']);
  assert.equal(message.data.kind, INCOMING_NOTIFICATION_KIND);
  assert.equal(message.collapseId, message.data.notificationId);
  const fleet = (await f.stored()).rooms[0]!.game.fleets[0]!;
  assert.ok(message.ttl * 1000 <= fleet.arrives * HOUR - f.clock.now + 1000, 'the provider TTL ends by arrival');
  f.clock.now = 0.5 * HOUR; await f.tick();
  assert.equal(incomingJobs(await f.jobs()).length, 1, 'one threat notifies once');
});

test('scheduled launches notify at their actual departure, and a request that settles past departure records it', async t => {
  const f = await fixture(t);
  await f.subscribe(f.host);
  const s = await f.snap(f.guest);
  await f.service.schedule(f.room.id, f.guest, { requestId: randomUUID(), revision: s.revision, executeAt: 2, from: ids.enemy, to: ids.home, drones: 12 });
  f.clock.now = 2.1 * HOUR; await f.tick();
  assert.equal(incomingJobs(await f.jobs()).length, 0, 'the scheduled plan and its preparation stay private');
  f.clock.now = 2.5 * HOUR;
  await f.snap(f.guest);
  assert.equal(incomingJobs(await f.jobs()).length, 1, 'the attacker\'s own request cannot swallow the first observation');
});

test('gifts, own launches, nearby traffic, and message-only consent produce no incoming alerts', async t => {
  const f = await fixture(t);
  await f.subscribe(f.host);
  const other = await f.subscribe(f.guest, false);
  const s = await f.snap(f.guest);
  await f.service.gift(f.room.id, f.guest, { requestId: randomUUID(), revision: s.revision, from: ids.enemy, to: ids.home, drones: 5, recipient: 'you' });
  await f.launch(f.guest, ids.enemy, ids.far, 5);
  await f.launch(f.host, ids.home, ids.enemy, 5);
  f.clock.now = 1 * HOUR; await f.tick(); await f.snap(f.host);
  const jobs = incomingJobs(await f.jobs());
  assert.equal(jobs.length, 0, 'gift, unrelated, and own haulers never alert; a message-only guest is not alerted about the host attack');
  assert.equal(other.view.incoming, false);
});

test('interception, an executed redirect, and capture of a targeted site each become new threats; a pending redirect stays private', async t => {
  const f = await fixture(t);
  await f.subscribe(f.host);
  // Vesper heads for the distant neutral site with its navigator aboard.
  const enemy = (await f.snap(f.guest)).game.rocks.find(r => r.id === ids.enemy)!;
  const navigator = enemy.specialists!.find(u => u.kind === 'navigator')!;
  const pirate = enemy.specialists!.find(u => u.kind === 'pirate')!;
  const redirected = await f.launch(f.guest, ids.enemy, ids.far, 9, { specialists: [navigator.id] });
  // The host heads for the nearby neutral site, which Vesper then also targets.
  await f.launch(f.host, ids.home, ids.near, 30);
  await f.launch(f.host, ids.home, ids.far, 10);
  await f.launch(f.guest, ids.enemy, ids.near, 7);
  f.clock.now = 0.5 * HOUR; await f.tick();
  assert.equal(incomingJobs(await f.jobs()).length, 0);
  const host = await f.snap(f.host);
  const target = host.game.fleets.find(fl => fl.owner === 'you')!;
  const g = await f.snap(f.guest);
  const visibleTarget = g.game.fleets.find(fl => fl.owner === 'you' && fl.to === ids.far);
  assert.ok(visibleTarget, 'the host hauler is within Vesper sensors for interception');
  await f.service.intercept(f.room.id, f.guest, { requestId: randomUUID(), revision: g.revision, from: ids.enemy, target: visibleTarget!.id, drones: 6, specialists: [pirate.id] });
  f.clock.now = 0.8 * HOUR; await f.tick();
  const intercepts = (await f.claim()).items.map(i => i.message.body);
  assert.deepEqual(intercepts.length, 1);
  assert.match(intercepts[0]!, /^Interception from Vesper: 6 drones closing on your hauler in \d+h \d+m\.$/);
  // Course change: ordered privately, executed ten minutes later.
  const g2 = await f.snap(f.guest);
  const own = g2.game.fleets.find(fl => fl.owner === 'vesper' && fl.to === ids.far)!;
  await f.service.hauler(f.room.id, f.guest, { requestId: randomUUID(), revision: g2.revision, fleet: own.id, action: 'course', to: ids.home });
  f.clock.now = 0.85 * HOUR; await f.tick();
  assert.equal(incomingJobs(await f.jobs()).filter(j => j.state === 'queued').length, 0, 'a pending course change is not observable');
  f.clock.now = 1.1 * HOUR; await f.tick();
  const bodies = (await f.claim()).items.map(i => i.message.body);
  assert.equal(bodies.filter(b => /^Incoming attack from Vesper: 9 drones/.test(b)).length, 1, 'the executed redirect is a newly hostile threat');
  // Capture: once the host owns the nearby site, Vesper's hauler bound there becomes incoming.
  const capture = (await f.stored()).rooms[0]!.game.fleets.find(fl => fl.owner === 'you' && fl.to === ids.near)!;
  f.clock.now = capture.arrives * HOUR + 60_000; await f.tick();
  const state = (await f.stored()).rooms[0]!.game;
  assert.equal(state.rocks.find(r => r.id === ids.near)!.owner, 'you', 'the host captured the nearby site first');
  assert.ok(state.fleets.some(fl => fl.owner === 'vesper' && fl.to === ids.near), 'Vesper is still inbound to it');
  const captured = (await f.claim()).items.map(i => i.message.body);
  assert.deepEqual(captured.filter(b => /^Incoming attack from Vesper: 7 drones/.test(b)).length, 1, 'capture makes the existing hauler a new threat');
  void redirected; void target;
});

test('single catch-up and minute ticks give identical rooms, including an offline inactivity resignation', async t => {
  const run = async (step: number) => {
    const f = await fixture(t);
    await f.subscribe(f.host);
    await f.launch(f.guest, ids.enemy, ids.home, 25);
    await f.launch(f.guest, ids.enemy, ids.far, 5);
    const end = 49 * HOUR;
    if (step) for (f.clock.now = step; f.clock.now < end; f.clock.now += step) await f.tick();
    f.clock.now = end; await f.tick();
    const { rooms, notifications } = await f.stored();
    return { rooms: rooms.map(r => ({ ...r, id: '', invite: '', referenceKey: '', receipts: {}, seats: r.seats.map(s => ({ ...s, hash: '', profileId: '' })) })), incoming: notifications!.incoming };
  };
  const once = await run(0);
  const ticked = await run(15 * 60_000);
  assert.ok(once.rooms[0]!.game.eliminated.length > 0, 'the 48-hour inactivity deadline passed with no client');
  assert.deepEqual(ticked.rooms.map(r => ({ ...r, game: { ...r.game, epoch: 0 } })), once.rooms.map(r => ({ ...r, game: { ...r.game, epoch: 0 } })), 'cadence changes persistence timing only');
});

test('opting in seeds current threats silently from the present instant without changing stored rooms', async t => {
  const f = await fixture(t);
  await f.launch(f.guest, ids.enemy, ids.home, 25);
  f.clock.now = 0.5 * HOUR;
  const before = (await f.stored()).rooms;
  const { view } = await f.subscribe(f.host);
  assert.equal(view.incoming, true);
  assert.deepEqual((await f.stored()).rooms, before, 'consent does not settle time, renew activity, or revise orders');
  assert.equal((await f.stored()).notifications!.incoming![0]!.keys.length, 1, 'the threat that departed before opt-in is seeded');
  await f.tick(); await f.snap(f.host);
  assert.equal(incomingJobs(await f.jobs()).length, 0, 'an existing threat is not replayed as new');
  await f.launch(f.guest, ids.enemy, ids.home, 4);
  f.clock.now = 0.8 * HOUR; await f.tick();
  assert.equal(incomingJobs(await f.jobs()).length, 1);
});

test('older files seed silently, the ledger survives restart, and retries never duplicate jobs', async t => {
  const f = await fixture(t);
  await f.subscribe(f.host);
  await f.launch(f.guest, ids.enemy, ids.home, 25);
  const db = await f.stored(); delete db.notifications!.incoming; await writeFile(f.file, JSON.stringify(db));
  await f.reopen();
  f.clock.now = 1 * HOUR; await f.tick();
  assert.equal(incomingJobs(await f.jobs()).length, 0, 'a missing ledger seeds without alerting');
  await f.launch(f.guest, ids.enemy, ids.home, 3);
  f.clock.now = 1.5 * HOUR; await f.tick();
  await f.reopen(); await f.tick(); await f.snap(f.host);
  assert.equal(incomingJobs(await f.jobs()).length, 1, 'restart neither loses nor repeats the first observation');
});

test('version negotiation keeps legacy shapes, preserves consent on v1 enable and rotation, and clears it on disable', async t => {
  const f = await fixture(t);
  const server = createApi(f.service); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise<void>(r => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/games/${f.room.id}/notifications`;
  const call = async (query: string, payload?: unknown) => {
    const response = await fetch(`${base}${query}`, { method: payload ? 'POST' : 'GET', headers: { Authorization: `Bearer ${f.host}`, 'Content-Type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined });
    return { status: response.status, data: await response.json() as Record<string, unknown> & { issues?: { issue: string }[] } };
  };
  const id = device();
  assert.deepEqual(Object.keys((await call(`?deviceId=${id}`)).data).sort(), ['available', 'deviceId', 'enabled', 'gameId', 'revision']);
  assert.equal((await call(`?deviceId=${id}&version=2`)).data.incoming, false);
  for (const query of [`?deviceId=${id}&version=3`, `?deviceId=${id}&version=2&version=2`, `?deviceId=${id}&version=1`]) assert.equal((await call(query)).status, 400);
  const v2 = { requestId: randomUUID(), deviceId: id, revision: 0, enabled: true, expoPushToken: pushToken(), incoming: true };
  assert.equal((await call('', v2)).data.issues![0]!.issue, 'notification.validation.payload', 'version 1 rejects the incoming field');
  assert.equal((await call('?x=1', v2)).status, 400);
  const { incoming: _omit, ...withoutFlag } = v2; void _omit;
  assert.equal((await call('?version=2', { ...withoutFlag, requestId: randomUUID() })).status, 400, 'version 2 requires the explicit flag');
  assert.equal((await call('?version=2', { requestId: randomUUID(), deviceId: id, revision: 0, enabled: false, incoming: true })).status, 400, 'incoming requires an enabled binding');
  const on = await call('?version=2', v2);
  assert.equal(on.status, 200); assert.equal(on.data.incoming, true); assert.equal(on.data.revision, 1);
  assert.deepEqual((await call('?version=2', v2)).data, on.data, 'identical version-2 retry');
  assert.equal((await call('?version=2', { ...v2, incoming: false })).data.issues![0]!.issue, 'command.conflict.reused_id');
  const rotated = await call('', { requestId: randomUUID(), deviceId: id, revision: 1, enabled: true, expoPushToken: pushToken() });
  assert.equal(rotated.status, 200); assert.equal(Object.hasOwn(rotated.data, 'incoming'), false, 'legacy response shape');
  assert.equal((await call(`?deviceId=${id}&version=2`)).data.incoming, true, 'v1 token rotation preserves consent');
  await f.launch(f.guest, ids.enemy, ids.home, 8);
  f.clock.now = 0.5 * HOUR; await f.tick();
  assert.equal(incomingJobs(await f.jobs()).length, 1);
  const off = await call('', { requestId: randomUUID(), deviceId: id, revision: 2, enabled: false });
  assert.equal(off.data.revision, 3);
  assert.equal((await call(`?deviceId=${id}&version=2`)).data.incoming, false, 'disable clears consent');
  assert.equal(incomingJobs(await f.jobs()).length, 0, 'disable clears pending incoming jobs');
  assert.equal((await f.stored()).notifications!.incoming?.length ?? 0, 0, 'and the seat ledger');
  const reenabled = await call('', { requestId: randomUUID(), deviceId: id, revision: 3, enabled: true, expoPushToken: pushToken() });
  assert.equal(reenabled.status, 200);
  assert.equal((await call(`?deviceId=${id}&version=2`)).data.incoming, false, 'a legacy re-enable cannot grant incoming consent');
  const explicitOff = await call('?version=2', { requestId: randomUUID(), deviceId: id, revision: 4, enabled: true, expoPushToken: pushToken(), incoming: false });
  assert.equal(explicitOff.data.incoming, false); assert.equal(explicitOff.data.enabled, true);
});

test('account linking invalidates incoming consent, jobs, and the seat ledger', async t => {
  const f = await fixture(t);
  const { deviceId } = await f.subscribe(f.host);
  await f.launch(f.guest, ids.enemy, ids.home, 8);
  f.clock.now = 0.5 * HOUR; await f.tick();
  assert.equal(incomingJobs(await f.jobs()).length, 1);
  await f.service.linkAccount(f.room.id, f.host, { accountId: 'user_incoming' });
  const view = await f.service.notificationSettings(f.room.id, { accountId: 'user_incoming' }, deviceId, 2);
  assert.equal(view.enabled, false); assert.equal(view.incoming, false);
  assert.equal(incomingJobs(await f.jobs()).length, 0);
  assert.equal((await f.stored()).notifications!.incoming?.length ?? 0, 0);
  assert.equal((await f.claim()).items.length, 0);
});

test('incoming jobs coexist with message coalescing and keep their own caps', async t => {
  const f = await fixture(t);
  await f.subscribe(f.host);
  for (let i = 0; i < 2; i++) await f.service.message(f.room.id, f.guest, { requestId: randomUUID(), to: 'you', text: `hello ${i}` });
  for (let i = 0; i < NOTIFICATION_LIMITS.incomingJobsPerBinding + 2; i++) await f.launch(f.guest, ids.enemy, ids.home, 1);
  f.clock.now = 0.5 * HOUR; await f.tick();
  const jobs = await f.jobs();
  assert.equal(jobs.filter(j => j.kind === undefined).length, 1, 'messages still coalesce to one queued job');
  assert.equal(incomingJobs(jobs).length, NOTIFICATION_LIMITS.incomingJobsPerBinding, 'incoming jobs are capped separately');
  await f.service.message(f.room.id, f.guest, { requestId: randomUUID(), to: 'you', text: 'after' });
  assert.equal((await f.jobs()).filter(j => j.kind === undefined).length, 1, 'queued incoming jobs do not block or duplicate message coalescing');
  assert.equal(new Set(jobs.map(j => j.id)).size, jobs.length);
  const kinds = (await f.claim()).items.map(i => i.message.data.kind).sort();
  assert.equal(kinds.filter(k => k === INCOMING_NOTIFICATION_KIND).length, NOTIFICATION_LIMITS.incomingJobsPerBinding);
});

test('claim time rechecks gift state and arrival, and reports the current ETA', async t => {
  const f = await fixture(t);
  await f.subscribe(f.host);
  const gifted = await f.launch(f.guest, ids.enemy, ids.home, 8);
  await f.launch(f.guest, ids.enemy, ids.home, 9);
  f.clock.now = 0.5 * HOUR; await f.tick();
  assert.equal(incomingJobs(await f.jobs()).length, 2);
  const g = await f.snap(f.guest);
  const giftFleet = g.game.fleets.find(fl => fl.drones === 8)!;
  await f.service.hauler(f.room.id, f.guest, { requestId: randomUUID(), revision: g.revision, fleet: giftFleet.id, action: 'gift' });
  f.clock.now = 0.75 * HOUR;
  const first = (await f.claim()).items.map(i => i.message.body);
  assert.deepEqual(first.length, 1, 'a hauler that became an active gift is dropped at claim');
  assert.match(first[0]!, /9 drones/);
  void gifted;
  const fleet = (await f.stored()).rooms[0]!.game.fleets.find(fl => fl.drones === 9)!;
  const remaining = fleet.arrives * HOUR - f.clock.now;
  const [, h, m] = first[0]!.match(/in (\d+)h (\d+)m/)!.map(Number);
  assert.equal(h! * 60 + m!, Math.ceil(remaining / 60_000), 'ETA is the current remaining time, rounded up to the minute');
  await f.launch(f.guest, ids.enemy, ids.home, 2);
  f.clock.now = 1 * HOUR; await f.tick();
  const late = (await f.stored()).rooms[0]!.game.fleets.find(fl => fl.drones === 2)!;
  f.clock.now = late.arrives * HOUR + 1;
  assert.equal((await f.claim()).items.filter(i => /2 drones/.test(i.message.body)).length, 0, 'an arrived threat is never sent');
  assert.equal(incomingJobs(await f.jobs()).filter(j => j.state === 'queued').length, 0);
});

test('background settlement restores a failing room and still commits others', async t => {
  const f = await fixture(t);
  await f.subscribe(f.host);
  const host2 = secret(), guest2 = secret();
  const second = await f.service.create(host2); await f.service.join(second.invite, guest2); await f.service.start(second.id, host2);
  await f.service.setNotifications(second.id, host2, { requestId: randomUUID(), deviceId: device(), revision: 0, enabled: true, expoPushToken: pushToken(), incoming: true }, 2);
  const before = (await f.stored()).rooms.find(r => r.id === f.room.id)!;
  const internal = f.service as unknown as { advanceRoom(room: { id: string }): void };
  const original = internal.advanceRoom.bind(f.service);
  internal.advanceRoom = room => { original(room); if (room.id === f.room.id) throw new Error('boom'); };
  t.after(() => { internal.advanceRoom = original; });
  const errors = t.mock.method(console, 'error', () => undefined);
  f.clock.now = 2 * HOUR;
  assert.equal(await f.tick(), 1);
  const rooms = (await f.stored()).rooms;
  assert.deepEqual(rooms.find(r => r.id === f.room.id), before, 'the failing room is restored after a partial advance');
  assert.equal(rooms.find(r => r.id === second.id)!.game.hour, 2, 'the other room settles');
  assert.ok(errors.mock.calls.length >= 1);
});

test('strict validation rejects malformed incoming state and accepts older files', async t => {
  const f = await fixture(t);
  await f.subscribe(f.host);
  await f.launch(f.guest, ids.enemy, ids.home, 8);
  f.clock.now = 0.5 * HOUR; await f.tick();
  const good = await f.stored();
  const reject = async (mutate: (db: Database) => void) => {
    const db = structuredClone(good); mutate(db); await writeFile(f.file, JSON.stringify(db));
    await assert.rejects(() => f.open(), /Damaged notification metadata/);
  };
  await reject(db => { db.notifications!.bindings[0]!.enabled = false; delete db.notifications!.bindings[0]!.token; db.notifications!.jobs = []; });
  await reject(db => { delete db.notifications!.jobs.find(j => j.kind === 'incoming')!.alert; });
  await reject(db => { db.notifications!.jobs.find(j => j.kind === 'incoming')!.alert!.faction = 'vesper'; });
  await reject(db => { (db.notifications!.jobs[0] as { kind: string }).kind = 'other'; });
  await reject(db => { db.notifications!.incoming!.push(structuredClone(db.notifications!.incoming![0]!)); });
  await reject(db => { db.notifications!.incoming![0]!.keys.push(db.notifications!.incoming![0]!.keys[0]!); });
  const legacy = structuredClone(good);
  delete legacy.notifications!.incoming; legacy.notifications!.jobs = legacy.notifications!.jobs.filter(j => j.kind !== 'incoming');
  for (const b of legacy.notifications!.bindings) delete b.incoming;
  await writeFile(f.file, JSON.stringify(legacy));
  await f.open();
});

test('a seat that no longer consents receives nothing and the loop skips rooms without consent', async t => {
  const f = await fixture(t);
  const { deviceId } = await f.subscribe(f.host, false);
  await f.launch(f.guest, ids.enemy, ids.home, 8);
  f.clock.now = 0.5 * HOUR;
  const before = await readFile(f.file, 'utf8');
  assert.equal(await f.tick(), 0);
  assert.equal(await readFile(f.file, 'utf8'), before, 'no consenting room means no settlement and no write');
  const view = await f.service.notificationSettings(f.room.id, f.host, deviceId, 2);
  assert.equal(view.incoming, false);
  const snapshot: Snapshot = await f.snap(f.host);
  assert.equal(snapshot.game.fleets.length, 1);
  assert.equal(incomingJobs(await f.jobs()).length, 0, 'request settlement never alerts without consent');
});

test('version-2 flag-only writes switch consent on a bound device without a token, and never attach one', async t => {
  const f = await fixture(t);
  const write = (body: object) => f.service.setNotifications(f.room.id, f.host, body, 2);
  const unknown = device();
  await assert.rejects(() => write({ requestId: randomUUID(), deviceId: unknown, revision: 0, enabled: true, incoming: true }), { code: 'notification.conflict.unbound' });
  assert.equal((await f.stored()).notifications?.bindings.length ?? 0, 0, 'no record is created for an unknown device');
  await assert.rejects(() => f.service.setNotifications(f.room.id, f.host, { requestId: randomUUID(), deviceId: unknown, revision: 0, enabled: true }, 1), { code: 'notification.validation.payload' }, 'version 1 still requires a token to enable');
  const { deviceId, view } = await f.subscribe(f.host, false);
  const before = (await f.stored()).notifications!.bindings[0]!;
  const on = { requestId: randomUUID(), deviceId, revision: view.revision, enabled: true, incoming: true };
  const turned = await write(on);
  assert.equal(turned.incoming, true); assert.equal(turned.bindingId, view.bindingId, 'the binding ID is retained');
  const after = (await f.stored()).notifications!.bindings[0]!;
  assert.equal(after.token, before.token, 'the token is retained');
  assert.deepEqual(await write(on), turned, 'a verbatim flag-only retry is idempotent');
  await assert.rejects(() => write({ ...on, expoPushToken: pushToken() }), { code: 'command.conflict.reused_id' }, 'the fingerprint distinguishes an omitted token');
  await f.launch(f.guest, ids.enemy, ids.home, 8);
  f.clock.now = 0.5 * HOUR; await f.tick();
  assert.equal(incomingJobs(await f.jobs()).length, 1);
  const off = await write({ requestId: randomUUID(), deviceId, revision: turned.revision, enabled: true, incoming: false });
  assert.equal(off.incoming, false); assert.equal(off.enabled, true); assert.equal(off.bindingId, view.bindingId);
  assert.equal(incomingJobs(await f.jobs()).length, 0, 'switching off clears pending incoming jobs and keeps messages');
  const disabled = await f.service.setNotifications(f.room.id, f.host, { requestId: randomUUID(), deviceId, revision: off.revision, enabled: false }, 1);
  await assert.rejects(() => write({ requestId: randomUUID(), deviceId, revision: disabled.revision, enabled: true, incoming: true }), { code: 'notification.conflict.unbound' }, 'a disabled binding cannot be re-enabled without a token');
  await f.service.setNotifications(f.room.id, f.host, { requestId: randomUUID(), deviceId, revision: disabled.revision, enabled: true, expoPushToken: pushToken() }, 1);
  await f.service.linkAccount(f.room.id, f.host, { accountId: 'user_flagonly' });
  const stale = await f.service.notificationSettings(f.room.id, { accountId: 'user_flagonly' }, deviceId, 2);
  await assert.rejects(() => f.service.setNotifications(f.room.id, { accountId: 'user_flagonly' }, { requestId: randomUUID(), deviceId, revision: stale.revision, enabled: true, incoming: true }, 2), { code: 'notification.conflict.unbound' }, 'a previous-generation binding needs a fresh registration');
});

class Provider implements PushProvider {
  sent: PushMessage[] = [];
  receipt: Receipt = { status: 'ok' };
  async send(messages: PushMessage[]) { this.sent.push(...messages); return { kind: 'tickets' as const, tickets: messages.map((): Ticket => ({ status: 'ok', id: randomUUID() })) }; }
  async receipts(ids: string[]) { return { kind: 'receipts' as const, receipts: Object.fromEntries(ids.map(id => [id, this.receipt])) }; }
}

test('the worker settles zero-client rooms at most once per interval, then sends and checks receipts', async t => {
  const f = await fixture(t);
  await f.subscribe(f.host);
  await f.launch(f.guest, ids.enemy, ids.home, 8);
  const provider = new Provider();
  const worker = new NotificationWorker(f.service.notificationQueue(), provider, { now: () => f.clock.now, settleIntervalMs: 60_000 });
  f.clock.now = 0.15 * HOUR; await worker.runOnce();
  assert.equal(provider.sent.length, 0, 'still preparing at the first settlement');
  f.clock.now += 20_000; const hourBefore = (await f.stored()).rooms[0]!.game.hour;
  await worker.runOnce();
  assert.equal((await f.stored()).rooms[0]!.game.hour, hourBefore, 'no second settlement inside the interval');
  f.clock.now += 60_000; await worker.runOnce();
  assert.equal(provider.sent.length, 1, 'the worker alone settled, detected, and sent');
  assert.equal(provider.sent[0]!.data.kind, INCOMING_NOTIFICATION_KIND);
  f.clock.now += 16 * 60_000; await worker.runOnce();
  assert.equal(incomingJobs(await f.jobs()).length, 0, 'an ok receipt completes the incoming job');
});

test('an unregistered receipt detaches the binding and clears incoming consent', async t => {
  const f = await fixture(t);
  const { deviceId } = await f.subscribe(f.host);
  await f.launch(f.guest, ids.enemy, ids.home, 8);
  const provider = new Provider(); provider.receipt = { status: 'error', error: 'DeviceNotRegistered' };
  const worker = new NotificationWorker(f.service.notificationQueue(), provider, { now: () => f.clock.now });
  f.clock.now = 0.5 * HOUR; await worker.runOnce();
  f.clock.now += 16 * 60_000; await worker.runOnce();
  const view = await f.service.notificationSettings(f.room.id, f.host, deviceId, 2);
  assert.equal(view.enabled, false); assert.equal(view.incoming, false);
});

test('settlement failures are logged without blocking sends, and stop waits for an in-flight settlement', async t => {
  const logs: string[] = [];
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  let settles = 0; let claims = 0;
  const queue = {
    settleIncoming: async () => { settles++; if (settles === 1) throw new Error('disk'); await gate; return 1; },
    claimSends: async () => { claims++; return { lease: 'l'.repeat(32), items: [] }; },
    finishSends: async () => undefined, claimReceipts: async () => ({ lease: 'r'.repeat(32), items: [] }), finishReceipts: async () => undefined, release: async () => undefined,
  };
  let now = 0;
  const worker = new NotificationWorker(queue, new Provider(), { now: () => now, log: m => logs.push(m), intervalMs: 1 });
  await worker.runOnce();
  assert.equal(claims, 1, 'a failed settlement still lets delivery proceed');
  assert.match(logs[0]!, /Incoming settlement failed: Error/);
  now = 120_000; worker.start();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(settles, 2);
  const stopped = worker.stop(5_000); release(); await stopped;
  const after = settles; await new Promise(r => setTimeout(r, 20));
  assert.equal(settles, after, 'no settlement starts after stop');
});

test('a consent-only off succeeds when delivery is no longer configured, while turning on stays unavailable', async t => {
  const f = await fixture(t);
  const { deviceId, view } = await f.subscribe(f.host);
  const offline = await GameService.open(f.file, () => f.clock.now, world, { notifications: false });
  const write = (body: object) => offline.setNotifications(f.room.id, f.host, body, 2);
  const before = (await f.stored()).notifications!.bindings[0]!;
  const off = await write({ requestId: randomUUID(), deviceId, revision: view.revision, enabled: true, incoming: false });
  assert.equal(off.available, false); assert.equal(off.incoming, false); assert.equal(off.bindingId, view.bindingId);
  const after = (await f.stored()).notifications!.bindings[0]!;
  assert.equal(after.token, before.token, 'no token lookup or replacement');
  await assert.rejects(() => write({ requestId: randomUUID(), deviceId, revision: off.revision, enabled: true, incoming: true }), { code: 'notification.unavailable.delivery' });
  await assert.rejects(() => write({ requestId: randomUUID(), deviceId, revision: off.revision, enabled: true, expoPushToken: pushToken(), incoming: false }), { code: 'notification.unavailable.delivery' }, 'a tokened registration still needs delivery');
  await assert.rejects(() => write({ requestId: randomUUID(), deviceId: device(), revision: 0, enabled: true, incoming: false }), { code: 'notification.conflict.unbound' }, 'an unknown device is never attached');
  assert.equal((await offline.setNotifications(f.room.id, f.host, { requestId: randomUUID(), deviceId, revision: off.revision, enabled: false }, 1)).enabled, false, 'master disable remains allowed');
});

test('threats exclude terminal and eliminated seats, and a changed target is a new threat', () => {
  const game = advance(dispatch(world(), ids.enemy, ids.home, 5, 'vesper'), 0.5);
  assert.equal(hostileIncoming(game, 'you').size, 1);
  assert.equal(hostileIncoming({ ...game, winner: 'vesper' }, 'you').size, 0, 'a finished operation never alerts');
  assert.equal(hostileIncoming({ ...game, draw: true }, 'you').size, 0);
  assert.equal(hostileIncoming({ ...game, eliminated: ['you'] }, 'you').size, 0, 'an eliminated seat never alerts');
  const fleet = game.fleets[0]!;
  assert.notEqual(threatKey(fleet), threatKey({ ...fleet, to: ids.near }), 'a redirect between owned sites is a new threat');
  assert.notEqual(threatKey(fleet), threatKey({ ...fleet, owner: 'null' }), 'an ownership switch is a new threat');
  assert.notEqual(threatKey({ ...fleet, intercept: { home: ids.enemy, target: 1 } }), threatKey({ ...fleet, intercept: { home: ids.enemy, target: 2 } }));
});

test('a message is still queued when only incoming jobs are pending for the binding', async t => {
  const f = await fixture(t);
  await f.subscribe(f.host);
  for (let i = 0; i < NOTIFICATION_LIMITS.incomingJobsPerBinding; i++) await f.launch(f.guest, ids.enemy, ids.home, 1);
  f.clock.now = 0.5 * HOUR; await f.tick();
  assert.equal(incomingJobs(await f.jobs()).length, NOTIFICATION_LIMITS.incomingJobsPerBinding);
  await f.service.message(f.room.id, f.guest, { requestId: randomUUID(), to: 'you', text: 'still delivered' });
  assert.equal((await f.jobs()).filter(j => j.kind === undefined).length, 1, 'incoming jobs neither coalesce nor cap messages');
});
