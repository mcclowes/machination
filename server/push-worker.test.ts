// A fake provider makes ticket, receipt, backoff, lease, and shutdown outcomes deterministic. It does not prove device delivery.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { GameService } from './service';
import { NotificationWorker } from './push-worker';
import { NOTIFICATION_TIMING } from './notifications';
import type { Database } from './database';
import type { PushProvider, Receipt, RequestFailure, Ticket } from './expo-push';
import type { PushMessage } from './notifications';

type Send = (messages: PushMessage[], signal: AbortSignal) => Promise<{ kind: 'tickets'; tickets: Ticket[] } | RequestFailure>;
type Receipts = (ids: string[], signal: AbortSignal) => Promise<{ kind: 'receipts'; receipts: Record<string, Receipt> } | RequestFailure>;
class FakeProvider implements PushProvider {
  sent: PushMessage[][] = []; checked: string[][] = [];
  onSend: Send = async messages => ({ kind: 'tickets', tickets: messages.map(() => ({ status: 'ok', id: randomUUID() })) });
  onReceipts: Receipts = async ids => ({ kind: 'receipts', receipts: Object.fromEntries(ids.map(id => [id, { status: 'ok' as const }])) });
  send(messages: PushMessage[], signal: AbortSignal) { this.sent.push(messages); return this.onSend(messages, signal); }
  receipts(ids: string[], signal: AbortSignal) { this.checked.push(ids); return this.onReceipts(ids, signal); }
}
const fakeProvider = () => new FakeProvider();

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'machination-push-worker-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'games.json');
  const clock = { now: 1_000_000 };
  const open = () => GameService.open(file, () => clock.now, undefined, { notifications: true });
  const service = await open();
  const tokens = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
  const room = await service.create(tokens[0]!); await service.join(room.invite, tokens[1]!);
  const deviceId = randomBytes(32).toString('hex');
  const expoPushToken = `ExponentPushToken[${randomBytes(11).toString('hex')}]`;
  const binding = await service.setNotifications(room.id, tokens[1]!, { requestId: randomUUID(), deviceId, revision: 0, enabled: true, expoPushToken });
  const send = () => service.message(room.id, tokens[0]!, { requestId: randomUUID(), to: 'vesper', text: 'Hidden text' });
  const jobs = async () => (JSON.parse(await readFile(file, 'utf8')) as Database).notifications!.jobs;
  const settings = () => service.notificationSettings(room.id, tokens[1]!, deviceId);
  return { file, clock, open, service, room, binding, expoPushToken, send, jobs, settings, tokens, deviceId };
}

test('accepted tickets wait fifteen minutes for receipts; an ok receipt completes the job', async t => {
  const { service, send, jobs, clock, expoPushToken, binding } = await fixture(t);
  const provider = fakeProvider();
  const worker = new NotificationWorker(service.notificationQueue(), provider, { log: () => undefined });
  await send();
  assert.deepEqual(await worker.runOnce(), { sent: 1, checked: 0 });
  const [message] = provider.sent[0]!;
  assert.equal(message!.to, expoPushToken);
  assert.equal(message!.data.bindingId, binding.bindingId);
  assert.ok(!JSON.stringify(message).includes('Hidden'));
  const [ticketed] = await jobs();
  assert.equal(ticketed!.state, 'ticketed');
  clock.now += NOTIFICATION_TIMING.receiptDelayMs - 1;
  assert.deepEqual(await worker.runOnce(), { sent: 0, checked: 0 });
  clock.now += 1;
  assert.deepEqual(await worker.runOnce(), { sent: 0, checked: 1 });
  assert.deepEqual(await jobs(), []);
});

test('DeviceNotRegistered on a ticket or a receipt disables the binding and removes its work', async t => {
  for (const stage of ['ticket', 'receipt'] as const) {
    const { service, send, jobs, clock, settings } = await fixture(t);
    const provider = fakeProvider();
    if (stage === 'ticket') provider.onSend = async () => ({ kind: 'tickets', tickets: [{ status: 'error', error: 'DeviceNotRegistered' }] });
    else provider.onReceipts = async ids => ({ kind: 'receipts', receipts: { [ids[0]!]: { status: 'error', error: 'DeviceNotRegistered' } } });
    const worker = new NotificationWorker(service.notificationQueue(), provider, { log: () => undefined });
    await send(); await worker.runOnce();
    clock.now += NOTIFICATION_TIMING.receiptDelayMs; await worker.runOnce();
    assert.deepEqual(await jobs(), [], stage);
    const view = await settings();
    assert.equal(view.enabled, false, stage); assert.equal(view.revision, 1, `${stage}: the device revision is kept`);
    await send();
    assert.deepEqual(await jobs(), [], `${stage}: no further jobs for the cleaned token`);
  }
});

test('temporary failures back off exponentially, honor Retry-After, and drop after the attempt limit', async t => {
  const { service, send, jobs, clock } = await fixture(t);
  const provider = fakeProvider();
  provider.onSend = async () => ({ kind: 'retry', reason: 'http_503' });
  const worker = new NotificationWorker(service.notificationQueue(), provider, { log: () => undefined });
  await send();
  const waits: number[] = [];
  for (let attempt = 1; attempt < NOTIFICATION_TIMING.maxAttempts; attempt++) {
    await worker.runOnce();
    const [job] = await jobs();
    waits.push(job!.availableAt - clock.now);
    assert.deepEqual(await worker.runOnce(), { sent: 0, checked: 0 }, 'not due before its backoff');
    clock.now = job!.availableAt;
  }
  assert.deepEqual(waits.slice(0, 4), [30_000, 60_000, 120_000, 240_000]);
  assert.ok(waits.every(wait => wait <= NOTIFICATION_TIMING.backoffMaxMs));
  await worker.runOnce();
  assert.deepEqual(await jobs(), [], 'dropped at the attempt limit');

  await send();
  provider.onSend = async () => ({ kind: 'retry', reason: 'TOO_MANY_REQUESTS', retryAfterMs: 600_000 });
  await worker.runOnce();
  assert.equal((await jobs())[0]!.availableAt - clock.now, 600_000);
});

test('malformed tickets retry only their own job; rejected requests drop; missing receipts recheck until Expo clears them', async t => {
  const { service, send, jobs, clock } = await fixture(t);
  const provider = fakeProvider();
  const worker = new NotificationWorker(service.notificationQueue(), provider, { log: () => undefined });
  const host = randomBytes(32).toString('hex');
  const second = await service.create(host);
  const guest = randomBytes(32).toString('hex'); await service.join(second.invite, guest);
  await service.setNotifications(second.id, guest, { requestId: randomUUID(), deviceId: randomBytes(32).toString('hex'), revision: 0, enabled: true, expoPushToken: 'ExponentPushToken[second]' });
  await send(); await service.message(second.id, host, { requestId: randomUUID(), to: 'vesper', text: 'x' });
  provider.onSend = async messages => ({ kind: 'tickets', tickets: [{ status: 'malformed' }, ...messages.slice(1).map(() => ({ status: 'ok' as const, id: 'ticket-ok' }))] });
  await worker.runOnce();
  assert.deepEqual((await jobs()).map(job => job.state).sort(), ['queued', 'ticketed']);

  provider.onSend = async () => ({ kind: 'reject', reason: 'UNAUTHORIZED' });
  clock.now += NOTIFICATION_TIMING.backoffBaseMs;
  provider.onReceipts = async () => ({ kind: 'receipts', receipts: {} });
  await worker.runOnce();
  assert.deepEqual((await jobs()).map(job => job.state), ['ticketed'], 'the rejected batch is dropped');
  for (let i = 0; i < 200 && (await jobs()).length; i++) { clock.now += NOTIFICATION_TIMING.receiptDelayMs; await worker.runOnce(); }
  assert.deepEqual(await jobs(), [], 'unknown receipts end when Expo retention ends');
  assert.ok(provider.checked.length > 50 && provider.checked.length <= 24 * 4 + 1);
});

test('leases block concurrent claims, expire after a crash, and ignore late completion from the lost lease', async t => {
  const { service, send, jobs, clock, open } = await fixture(t);
  await send();
  const first = await service.notificationQueue().claimSends('crashed');
  assert.equal(first.items.length, 1);
  assert.equal((await service.notificationQueue().claimSends('other')).items.length, 0, 'leased work is not claimed twice');
  const restarted = await open();
  clock.now += NOTIFICATION_TIMING.leaseMs;
  const second = await restarted.notificationQueue().claimSends('recovered');
  assert.equal(second.items.length, 1, 'restart plus lease expiry makes the work claimable again');
  assert.equal(second.items[0]!.jobId, first.items[0]!.jobId, 'the notification ID is stable across attempts');
  assert.equal(second.items[0]!.message.collapseId, first.items[0]!.message.collapseId);
  await restarted.notificationQueue().finishSends(first.lease, new Map([[first.items[0]!.jobId, { kind: 'drop' }]]));
  assert.equal((await jobs()).length, 1, 'the lost lease cannot finish the reclaimed job');
  await restarted.notificationQueue().finishSends(second.lease, new Map([[second.items[0]!.jobId, { kind: 'ticket', id: 't1' }]]));
  assert.equal((await jobs())[0]!.attempts, 2);
});

test('disabling during an in-flight send discards its result; queued work expires after the send window', async t => {
  const { service, send, jobs, clock, room, tokens, deviceId } = await fixture(t);
  await send();
  const claim = await service.notificationQueue().claimSends('worker');
  await service.setNotifications(room.id, tokens[1]!, { requestId: randomUUID(), deviceId, revision: 1, enabled: false });
  await service.notificationQueue().finishSends(claim.lease, new Map([[claim.items[0]!.jobId, { kind: 'ticket', id: 'late' }]]));
  assert.deepEqual(await jobs(), [], 'a disabled binding keeps no work, even from a send already in flight');

  await service.setNotifications(room.id, tokens[1]!, { requestId: randomUUID(), deviceId, revision: 2, enabled: true, expoPushToken: 'ExponentPushToken[again]' });
  await send();
  clock.now += NOTIFICATION_TIMING.sendWindowMs;
  assert.equal((await service.notificationQueue().claimSends('worker')).items.length, 0);
  assert.deepEqual(await jobs(), [], 'expired before any send');
});

test('shutdown stops new claims, aborts a hung provider after the grace period, and releases its lease', async t => {
  const { service, send, jobs, clock } = await fixture(t);
  const provider = fakeProvider();
  let started!: () => void; const sending = new Promise<void>(resolve => { started = resolve; });
  let aborted = false;
  provider.onSend = (_messages, signal) => { started(); return new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve({ kind: 'retry', reason: 'aborted' }); })); };
  const worker = new NotificationWorker(service.notificationQueue(), provider, { intervalMs: 10, log: () => undefined });
  await send();
  worker.start();
  await sending;
  const began = Date.now();
  await worker.stop(50);
  assert.ok(aborted, 'the provider call was aborted');
  assert.ok(Date.now() - began < 1_000);
  const [job] = await jobs();
  assert.equal(job!.state, 'queued', 'aborted work returns to the queue for the next host');
  assert.equal(job!.lease, undefined);
  await send();
  assert.deepEqual(await worker.runOnce(), { sent: 0, checked: 0 }, 'a stopped worker claims nothing');
  assert.equal(provider.sent.length, 1);

  clock.now += NOTIFICATION_TIMING.backoffBaseMs;
  const hung = fakeProvider();
  let hungStarted!: () => void; const hanging = new Promise<void>(resolve => { hungStarted = resolve; });
  hung.onSend = () => { hungStarted(); return new Promise(() => undefined); };
  const stubborn = new NotificationWorker(service.notificationQueue(), hung, { intervalMs: 10, log: () => undefined });
  stubborn.start();
  await hanging;
  await stubborn.stop(20);
  const [released] = await jobs();
  assert.equal(released!.state, 'queued', 'a provider that ignores abort still has its lease released');
  assert.equal(released!.lease, undefined);
});

test('a finished send pass completes during graceful shutdown without being released', async t => {
  const { service, send, jobs } = await fixture(t);
  const provider = fakeProvider();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void; const sending = new Promise<void>(resolve => { started = resolve; });
  const ok = provider.onSend;
  provider.onSend = async (messages, signal) => { started(); await gate; return ok(messages, signal); };
  const worker = new NotificationWorker(service.notificationQueue(), provider, { intervalMs: 10, log: () => undefined });
  await send(); worker.start(); await sending;
  const stopping = worker.stop(2_000);
  release();
  await stopping;
  assert.equal((await jobs())[0]!.state, 'ticketed');
});

test('expired leases and shutdown releases still count against the attempt limit', async t => {
  for (const loss of ['expired', 'released'] as const) {
    const { service, send, jobs, clock } = await fixture(t);
    const queue = service.notificationQueue();
    await send();
    for (let i = 0; i < NOTIFICATION_TIMING.maxAttempts; i++) {
      const claim = await queue.claimSends(`crash-${i}`);
      assert.equal(claim.items.length, 1, `${loss}: attempt ${i + 1} is claimable`);
      if (loss === 'released') await queue.release(claim.lease); else clock.now += NOTIFICATION_TIMING.leaseMs;
    }
    assert.equal((await queue.claimSends('next')).items.length, 0, `${loss}: no claim past the limit`);
    assert.deepEqual(await jobs(), [], `${loss}: the job is dropped`);
  }
});
