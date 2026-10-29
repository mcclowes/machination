import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { useMessageNotifications, type MessageNotificationDeps, type MessageNotificationState, type NotificationSeat } from './useMessageNotifications';
import type { NotificationDevice, NotificationPermission } from './notification-device';
import type { MessageNotificationSettings, SetMessageNotifications } from './notification-contract';
import { RejectedCommand } from './network';

const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
const { create, act } = require('react-test-renderer');
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const deviceId = 'f'.repeat(64);
const seatA: NotificationSeat = { url: 'https://belt.example', token: 'a'.repeat(64), id: 'a'.repeat(24) };
const seatB: NotificationSeat = { ...seatA, token: 'b'.repeat(64), id: 'b'.repeat(24) };

function deferred<T>() { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

function fakeDevice(permission: NotificationPermission = 'undetermined') {
  const calls = { requests: 0, tokens: 0 };
  const tokenListeners = new Set<() => void>();
  let token = 'ExponentPushToken[first]';
  const state = { permission, grant: 'granted' as NotificationPermission };
  const device: NotificationDevice = {
    permission: async () => state.permission,
    requestPermission: async () => { calls.requests++; state.permission = state.grant; return state.permission; },
    pushToken: async () => { calls.tokens++; return token; },
    onTokenChange: listener => { tokenListeners.add(listener); return () => tokenListeners.delete(listener); },
    lastOpened: async () => null, onOpened: () => () => {}, clearOpened: async () => {},
  };
  return { device, calls, state, tokenListeners, rotate(next: string) { token = next; for (const l of tokenListeners) l(); } };
}

function fakeServer() {
  const records = new Map<string, MessageNotificationSettings>();
  const writes: { seat: string; body: SetMessageNotifications }[] = [];
  const reads: string[] = [];
  let available = true;
  const pause: { next?: ReturnType<typeof deferred<void>> } = {};
  const failures: unknown[] = [];
  const record = (seat: NotificationSeat) => records.get(seat.id) ?? { gameId: seat.id, deviceId, revision: 0, available, enabled: false };
  return {
    records, writes, reads, pause, failures,
    setAvailable(value: boolean) { available = value; for (const [k, v] of records) records.set(k, { ...v, available: value }); },
    read: async (seat: NotificationSeat) => { reads.push(seat.id); return { ...record(seat), available }; },
    write: async (seat: NotificationSeat, body: SetMessageNotifications) => {
      writes.push({ seat: seat.id, body });
      const gate = pause.next; pause.next = undefined;
      if (gate) await gate.promise;
      const failure = failures.shift();
      if (failure) throw failure;
      const current = record(seat);
      if (body.revision !== current.revision) throw new RejectedCommand(409, 'Stale preference revision.', 'notification.conflict.stale');
      if (body.enabled && !available) throw new RejectedCommand(409, 'Delivery unavailable.');
      const next = { ...current, available, revision: current.revision + 1, enabled: body.enabled, ...(body.enabled ? { bindingId: `binding-${seat.id.slice(0, 1)}-${current.revision + 1}` } : {}) };
      records.set(seat.id, next);
      return next;
    },
  };
}

async function mount(seat: NotificationSeat | undefined, device: MessageNotificationDeps['device'], server = fakeServer(), overrides: Partial<MessageNotificationDeps> = {}) {
  let requestCount = 0, registered = 0;
  const deps: MessageNotificationDeps = { device, deviceId: async () => deviceId, read: server.read, write: server.write, requestId: () => `request-${String(++requestCount).padStart(12, '0')}`, markRegistered: async () => { registered++; }, ...overrides };
  const out: { current?: MessageNotificationState } = {};
  function Probe({ seat }: { seat?: NotificationSeat }) { out.current = useMessageNotifications(seat, deps); return null; }
  let renderer: any;
  await act(async () => { renderer = create(React.createElement(Probe, { seat })); });
  return { out, server, rerender: (next?: NotificationSeat) => act(async () => renderer.update(React.createElement(Probe, { seat: next }))), registered: () => registered, unmount: () => act(async () => renderer.unmount()) };
}
const press = (fn: () => void) => act(async () => { fn(); });

test('a registration waiting for device identity cannot cross seats or survive unmount', async () => {
  for (const unmount of [false, true]) {
    const gate = deferred<string>();
    let calls = 0;
    const m = await mount(seatA, fakeDevice('granted').device, fakeServer(), { deviceId: () => ++calls === 2 ? gate.promise : Promise.resolve(deviceId) });
    await press(m.out.current!.enable);
    if (unmount) await m.unmount(); else await m.rerender(seatB);
    await act(async () => { gate.resolve(deviceId); await gate.promise; });
    assert.deepEqual(m.server.writes, [], 'pending local work must not issue a write after leaving its seat');
    if (!unmount) await m.unmount();
  }
});

test('capacity conflicts retain the server explanation', async () => {
  const m = await mount(seatA, fakeDevice('granted').device);
  m.server.failures.push(new RejectedCommand(409, 'Disable another device first.', 'notification.capacity.devices'));
  await press(m.out.current!.enable);
  assert.equal(m.out.current!.error, 'Disable another device first.');
  assert.equal(m.server.reads.length, 1);
  await m.unmount();
});

test('a failed stale-preference refresh retains its network error and read retry', async () => {
  const server = fakeServer();
  let reads = 0;
  const m = await mount(seatA, fakeDevice('granted').device, server, { read: async seat => {
    if (++reads === 2) throw new Error('Connection lost during refresh');
    return server.read(seat);
  } });
  server.records.set(seatA.id, { gameId: seatA.id, deviceId, revision: 7, available: true, enabled: false });
  await press(m.out.current!.enable);
  assert.match(m.out.current!.error!, /Connection lost during refresh/);
  await press(m.out.current!.retry);
  assert.equal(m.out.current!.settings?.revision, 7);
  assert.equal(m.out.current!.error, undefined);
  assert.equal(server.writes.length, 1, 'Retry only reads after the failed refresh');
  await m.unmount();
});

test('retrying an enable refreshes a rotated token without reusing its request ID', async () => {
  const fake = fakeDevice('granted');
  const m = await mount(seatA, fake.device);
  m.server.failures.push(new Error('Network request failed'));
  await press(m.out.current!.enable);
  const failed = m.server.writes.at(-1)!.body;
  fake.rotate('ExponentPushToken[second]');
  await press(m.out.current!.retry);
  const retried = m.server.writes.at(-1)!.body;
  assert.equal(retried.expoPushToken, 'ExponentPushToken[second]');
  assert.notEqual(retried.requestId, failed.requestId);
  assert.equal(fake.calls.requests, 1);
  await m.unmount();
});

test('native token events do not rewrite an unchanged Expo subscription', async () => {
  const fake = fakeDevice('granted');
  const m = await mount(seatA, fake.device);
  await press(m.out.current!.enable);
  await act(async () => fake.rotate('ExponentPushToken[first]'));
  assert.equal(m.server.writes.length, 1);
  await m.unmount();
});

test('a lost enable response and rotated token reconcile an enabled binding without undoing a later disable', async () => {
  for (const disabledElsewhere of [false, true]) {
    const fake = fakeDevice('granted');
    const server = fakeServer();
    let lose = true, boundToken: string | undefined;
    const m = await mount(seatA, fake.device, server, { write: async (seat, body) => {
      const result = await server.write(seat, body);
      boundToken = body.expoPushToken;
      if (lose) { lose = false; throw new Error('Response lost after acceptance'); }
      return result;
    } });
    await press(m.out.current!.enable);
    assert.equal(server.records.get(seatA.id)!.enabled, true);
    assert.equal(m.out.current!.settings?.enabled, false, 'only the response was lost');
    if (disabledElsewhere) {
      server.records.set(seatA.id, { gameId: seatA.id, deviceId, revision: 2, available: true, enabled: false });
      boundToken = undefined;
    }
    fake.rotate('ExponentPushToken[second]');
    await press(m.out.current!.retry);
    assert.equal(m.out.current!.settings?.enabled, !disabledElsewhere);
    assert.equal(boundToken, disabledElsewhere ? undefined : 'ExponentPushToken[second]');
    assert.equal(server.writes.length, disabledElsewhere ? 2 : 3);
    if (!disabledElsewhere) assert.equal(m.out.current!.error, undefined);
    assert.equal(fake.calls.requests, 1, 'reconciliation never prompts again');
    await m.unmount();
  }
});

test('web and unsupported builds never read settings; native mount reads without prompting', async () => {
  const web = await mount(seatA, undefined);
  assert.equal(web.out.current!.phase, 'unsupported');
  assert.deepEqual(web.server.reads, []);
  const fake = fakeDevice();
  const native = await mount(seatA, fake.device);
  assert.equal(native.out.current!.phase, 'ready');
  assert.equal(native.out.current!.settings?.enabled, false);
  assert.equal(native.out.current!.permission, 'undetermined');
  assert.deepEqual(fake.calls, { requests: 0, tokens: 0 });
  const idle = await mount(undefined, fakeDevice().device);
  assert.equal(idle.out.current!.phase, 'idle');
  assert.deepEqual(idle.server.reads, []);
});

test('OS denial leaves notifications off with a retry that registers once permission is granted', async () => {
  const fake = fakeDevice();
  fake.state.grant = 'denied';
  const m = await mount(seatA, fake.device);
  await press(m.out.current!.enable);
  assert.equal(m.out.current!.permission, 'denied');
  assert.match(m.out.current!.error!, /blocked/);
  assert.equal(m.server.writes.length, 0);
  assert.equal(fake.calls.tokens, 0);
  fake.state.grant = 'provisional';
  await press(m.out.current!.retry);
  assert.equal(m.out.current!.settings?.enabled, true);
  assert.equal(m.out.current!.error, undefined);
  assert.deepEqual(m.server.writes[0]!.body, { requestId: 'request-000000000001', deviceId, revision: 0, enabled: true, expoPushToken: 'ExponentPushToken[first]' });
  assert.equal(m.registered(), 1);
  await press(m.out.current!.disable);
  assert.deepEqual(m.server.writes[1]!.body, { requestId: 'request-000000000002', deviceId, revision: 1, enabled: false });
  assert.equal(m.out.current!.settings?.enabled, false);
});

test('an unavailable server blocks enabling but still lets an enabled device turn off', async () => {
  const server = fakeServer();
  server.setAvailable(false);
  const fake = fakeDevice('granted');
  const off = await mount(seatA, fake.device, server);
  await press(off.out.current!.enable);
  assert.equal(fake.calls.requests, 0, 'no prompt when the operator has not enabled delivery');
  assert.equal(server.writes.length, 0);
  server.records.set(seatA.id, { gameId: seatA.id, deviceId, revision: 4, available: false, enabled: true, bindingId: 'binding-old' });
  const on = await mount(seatA, fake.device, server);
  assert.equal(on.out.current!.settings?.enabled, true);
  await press(on.out.current!.disable);
  assert.equal(on.out.current!.settings?.enabled, false);
  assert.equal(server.writes.at(-1)!.body.expoPushToken, undefined);
});

test('a failed disable keeps the honest enabled state and retry repeats the identical request', async () => {
  const fake = fakeDevice('granted');
  const m = await mount(seatA, fake.device);
  await press(m.out.current!.enable);
  m.server.failures.push(new Error('Network request failed'));
  await press(m.out.current!.disable);
  assert.equal(m.out.current!.settings?.enabled, true);
  assert.match(m.out.current!.error!, /Network request failed/);
  const failed = m.server.writes.at(-1)!.body;
  await press(m.out.current!.retry);
  assert.deepEqual(m.server.writes.at(-1)!.body, failed);
  assert.equal(m.out.current!.settings?.enabled, false);
  assert.equal(m.out.current!.error, undefined);
});

test('a stale revision reloads the device preference instead of overwriting it', async () => {
  const fake = fakeDevice('granted');
  const m = await mount(seatA, fake.device);
  m.server.records.set(seatA.id, { gameId: seatA.id, deviceId, revision: 7, available: true, enabled: false });
  await press(m.out.current!.enable);
  assert.match(m.out.current!.error!, /changed elsewhere/);
  assert.equal(m.out.current!.settings?.revision, 7);
  assert.equal(m.server.writes.length, 1);
});

test('a seat change discards the old seat’s in-flight registration and token listener', async () => {
  const fake = fakeDevice('granted');
  const m = await mount(seatA, fake.device);
  const gate = deferred<void>();
  m.server.pause.next = gate;
  await press(m.out.current!.enable);
  assert.equal(m.out.current!.working, true);
  await m.rerender(seatB);
  assert.equal(m.out.current!.settings?.gameId, seatB.id);
  assert.equal(m.out.current!.settings?.enabled, false);
  await act(async () => { gate.resolve(); await gate.promise; });
  assert.equal(m.out.current!.settings?.gameId, seatB.id, 'seat A’s completion cannot publish into seat B');
  assert.equal(m.out.current!.settings?.enabled, false);
  assert.equal(m.out.current!.working, false);
  assert.equal(m.registered(), 1, 'an already-sent opt-in still enables future cold-start tap handling');
  assert.equal(fake.tokenListeners.size, 0, 'seat B is not enabled, so nothing listens for rotations');
  await m.rerender(seatA);
  assert.equal(m.out.current!.settings?.enabled, true, 'seat A reloads its own server state');
  assert.equal(fake.tokenListeners.size, 1);
  const reads = m.server.reads.length;
  await m.rerender({ ...seatA, token: 'c'.repeat(64) });
  assert.equal(m.server.reads.length, reads + 1, 'a recovered legacy credential is a new scope and re-reads its own binding');
  await m.unmount();
});

test('token rotation re-registers only the current enabled seat', async () => {
  const fake = fakeDevice('granted');
  const m = await mount(seatA, fake.device);
  await press(m.out.current!.enable);
  await act(async () => fake.rotate('ExponentPushToken[second]'));
  const last = m.server.writes.at(-1)!;
  assert.equal(last.seat, seatA.id);
  assert.equal(last.body.expoPushToken, 'ExponentPushToken[second]');
  assert.equal(last.body.revision, 1);
  assert.equal(m.out.current!.settings?.revision, 2);
  assert.equal(fake.calls.requests, 1, 'rotation never prompts again');
  await m.unmount();
  const before = m.server.writes.length;
  fake.rotate('ExponentPushToken[third]');
  assert.equal(m.server.writes.length, before);
});
