import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { installationDeviceId, notificationDisposition, parseNotificationData, resetInstallationCache, type InstallationStore } from './message-notifications';
import { messageNotificationsApi, setMessageNotificationsApi, RejectedCommand } from './network';
import { useNotificationLaunch, type NotificationLaunchDeps } from './useNotificationLaunch';
import type { NotificationDevice, NotificationOpen } from './notification-device';

const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
const { create, act } = require('react-test-renderer');
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const gameId = 'a'.repeat(24), deviceId = 'b'.repeat(64);
const seat = { url: 'https://belt.example', token: 'c'.repeat(64), id: gameId };
const data = { kind: 'machination.message', version: 1, gameId, bindingId: 'binding-1', notificationId: 'note-1' };

function memoryStore(initial: Record<string, string> = {}): InstallationStore & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return { values, getItemAsync: async key => values.get(key) ?? null, setItemAsync: async (key, value) => { values.set(key, value); } };
}

test('installation ID is 32 random bytes as lowercase hex, created once and kept', async () => {
  resetInstallationCache();
  const store = memoryStore();
  let calls = 0;
  const random = async (count: number) => { calls++; return Uint8Array.from({ length: count }, (_, i) => i * 7 + 250); };
  const [first, second] = await Promise.all([installationDeviceId(store, random), installationDeviceId(store, random)]);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(second, first);
  assert.equal(calls, 1);
  resetInstallationCache();
  assert.equal(await installationDeviceId(store, random), first, 'reused from secure storage after restart');
  resetInstallationCache();
  const corrupt = memoryStore({ 'machination.notifications.v1.device': 'NOT-HEX' });
  assert.notEqual(await installationDeviceId(corrupt, random), 'NOT-HEX');
  resetInstallationCache();
  await assert.rejects(installationDeviceId(memoryStore(), async () => new Uint8Array(4)), /random/);
  resetInstallationCache();
});

test('settings requests use the seat bearer and reject responses that leak or mismatch', async t => {
  const responses: unknown[] = [];
  const sent: { url: string; init: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => { sent.push({ url, init }); return new Response(JSON.stringify(responses.shift()), { status: 200 }); });
  const view = { gameId, deviceId, revision: 2, available: true, enabled: true, bindingId: 'binding-1' };
  responses.push(view);
  assert.deepEqual(await messageNotificationsApi(seat, deviceId), view);
  assert.equal(sent[0]!.url, `https://belt.example/v1/games/${gameId}/notifications?deviceId=${deviceId}`);
  assert.equal(sent[0]!.init.method, 'GET');
  assert.equal((sent[0]!.init.headers as Record<string, string>).Authorization, `Bearer ${seat.token}`);
  const body = { requestId: 'request-0000000001', deviceId, revision: 2, enabled: true, expoPushToken: 'ExponentPushToken[abc]' };
  responses.push({ ...view, revision: 3 });
  assert.equal((await setMessageNotificationsApi(seat, body)).revision, 3);
  assert.deepEqual(JSON.parse(sent[1]!.init.body as string), body);
  for (const bad of [{ ...view, expoPushToken: 'ExponentPushToken[abc]' }, { ...view, gameId: 'd'.repeat(24) }, { ...view, deviceId: 'e'.repeat(64) }, { ...view, revision: -1 }, { ...view, available: 'yes' }, { ...view, bindingId: 'has space' }, null]) {
    responses.push(bad);
    await assert.rejects(messageNotificationsApi(seat, deviceId), /Unsupported notification settings/);
  }
  await assert.rejects(setMessageNotificationsApi(seat, { ...body, expoPushToken: undefined }), /Invalid notification preference/);
  await assert.rejects(setMessageNotificationsApi(seat, { ...body, enabled: false }), /Invalid notification preference/, 'disable requests omit the token');
  await assert.rejects(messageNotificationsApi(seat, 'short'), /Invalid notification device/);
  assert.equal(sent.length, 9, 'invalid requests never reach the network');
  for (const bad of [{ ...view, bindingId: undefined }, { ...view, enabled: false }]) {
    responses.push(bad);
    await assert.rejects(messageNotificationsApi(seat, deviceId), /Unsupported notification settings/);
  }
});

test('notification conflicts preserve their machine-readable issue and detail', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ issues: [{ issue: 'notification.capacity.devices', message: { detail: 'Disable another device first.' } }] }), { status: 409 }));
  await assert.rejects(messageNotificationsApi(seat, deviceId), error => error instanceof RejectedCommand && error.status === 409 && error.issue === 'notification.capacity.devices' && error.message === 'Disable another device first.');
});

test('tap payloads accept only the exact opaque contract shape', () => {
  assert.deepEqual(parseNotificationData(data), { gameId, bindingId: 'binding-1', notificationId: 'note-1' });
  for (const bad of [null, [], { ...data, kind: 'other' }, { ...data, version: 2 }, { ...data, gameId: 'x' }, { ...data, body: 'secret' }, { ...data, bindingId: '' }, { gameId }]) assert.equal(parseNotificationData(bad), undefined);
});

test('a tap opens Signals only after the restored operation and current binding match', () => {
  const request = parseNotificationData(data)!;
  assert.equal(notificationDisposition(request, { restored: false }), 'wait');
  assert.equal(notificationDisposition(request, { restored: true }), 'ignore', 'signed out or no restored seat');
  assert.equal(notificationDisposition(request, { restored: true, gameId: 'd'.repeat(24), bindingId: 'binding-1' }), 'ignore', 'another operation');
  assert.equal(notificationDisposition(request, { restored: true, gameId }), 'wait', 'binding still loading');
  assert.equal(notificationDisposition(request, { restored: true, gameId, bindingId: null }), 'ignore', 'not enabled for this seat');
  assert.equal(notificationDisposition(request, { restored: true, gameId, bindingId: 'binding-2' }), 'ignore', 'another seat or stale binding');
  assert.equal(notificationDisposition(request, { restored: true, gameId, bindingId: 'binding-1' }), 'open');
});

function launchDevice(last: NotificationOpen | null) {
  const listeners = new Set<(open: NotificationOpen) => void>();
  const calls = { cleared: 0 };
  const device: NotificationDevice = {
    permission: async () => { throw new Error('launch handling must not read permission'); },
    requestPermission: async () => { throw new Error('launch handling must not prompt'); },
    pushToken: async () => { throw new Error('launch handling must not request a token'); },
    onTokenChange: () => () => {},
    lastOpened: async () => last,
    onOpened: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    clearOpened: async () => { calls.cleared++; last = null; },
  };
  return { device, listeners, calls };
}
const pending = (out: { current?: ReturnType<typeof useNotificationLaunch> }): string | undefined => out.current!.request?.notificationId;
async function mountLaunch(deps: NotificationLaunchDeps) {
  const out: { current?: ReturnType<typeof useNotificationLaunch> } = {};
  function Probe() { out.current = useNotificationLaunch(deps); return null; }
  let renderer: any;
  await act(async () => { renderer = create(React.createElement(Probe)); });
  return { out, renderer };
}

test('installations that never opted in do not load the native adapter until registration', async () => {
  const fake = launchDevice({ data });
  let registered = false, loads = 0;
  const registrations = new Set<() => void>();
  const { out, renderer } = await mountLaunch({ shouldListen: async () => registered, onRegistered: l => { registrations.add(l); return () => registrations.delete(l); }, load: async () => { loads++; return fake.device; } });
  assert.equal(loads, 0);
  assert.equal(out.current!.request, undefined);
  registered = true;
  await act(async () => { for (const l of registrations) l(); });
  assert.equal(loads, 1);
  assert.equal(pending(out), 'note-1');
  await act(async () => renderer.unmount());
  assert.equal(fake.listeners.size, 0);
});

test('cold-start and live taps are deduplicated, consumed responses are cleared, and foreign payloads are dropped', async () => {
  const fake = launchDevice({ data });
  const { out, renderer } = await mountLaunch({ shouldListen: async () => true, onRegistered: () => () => {}, load: async () => fake.device });
  assert.equal(pending(out), 'note-1');
  await act(async () => { for (const l of fake.listeners) l({ data }); });
  assert.equal(pending(out), 'note-1', 'the same response delivered twice stays one request');
  await act(async () => out.current!.consume('note-1'));
  assert.equal(out.current!.request, undefined);
  assert.equal(fake.calls.cleared, 1);
  await act(async () => { for (const l of fake.listeners) l({ data }); });
  assert.equal(out.current!.request, undefined, 'a consumed notification cannot reopen');
  await act(async () => { for (const l of fake.listeners) l({ data: { ...data, notificationId: 'note-2', extra: 'sender' } }); });
  assert.equal(out.current!.request, undefined);
  assert.equal(fake.calls.cleared, 3);
  await act(async () => { for (const l of fake.listeners) l({ data: { ...data, notificationId: 'note-3' } }); });
  assert.equal(pending(out), 'note-3');
  await act(async () => renderer.unmount());
});

test('web resolution never bundles the native SDK and native resolution loads it lazily', async () => {
  const bundle = async (extensions: string[]) => (await build({
    entryPoints: ['src/online/notification-wiring.ts'], bundle: true, write: false, platform: 'neutral', format: 'esm', resolveExtensions: extensions,
    external: ['react', 'react-native', 'expo-crypto', 'expo-secure-store', 'expo-notifications'], logLevel: 'silent',
  })).outputFiles[0]!.text;
  assert.equal((await bundle(['.web.ts', '.ts', '.tsx'])).includes('expo-notifications'), false);
  const native = await bundle(['.native.ts', '.ts', '.tsx']);
  assert.match(native, /import\("expo-notifications"\)/);
  assert.doesNotMatch(native, /from "expo-notifications"/);
});

test('settings show honest states and only the actions each state allows', async () => {
  const { pathToFileURL } = await import('node:url');
  const output = await build({
    entryPoints: ['src/online/MessageNotificationSettings.tsx'], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'hosts', setup(b) {
      b.onResolve({ filter: /^react(?:\/.*)?$/ }, a => ({ path: pathToFileURL(require.resolve(a.path)).href, external: true }));
      b.onResolve({ filter: /^react-native$/ }, () => ({ path: 'rn', namespace: 'host' }));
      b.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `export const View='View',Text='Text',Pressable='Pressable',StyleSheet={create:x=>x};` }));
    } }],
  });
  const { MessageNotificationSettings } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`);
  const pressed: string[] = [];
  const base = { working: false, enable: () => pressed.push('enable'), disable: () => pressed.push('disable'), retry: () => pressed.push('retry') };
  const view = { gameId, deviceId, revision: 1, available: true, enabled: false };
  const render = (state: object) => {
    let renderer: any;
    act(() => { renderer = create(React.createElement(MessageNotificationSettings, { state: { ...base, ...state } })); });
    const text = renderer.root.findAll((n: any) => n.type === 'Text').map((n: any) => [].concat(n.props.children).join('')).join(' | ');
    const buttons = renderer.root.findAll((n: any) => n.type === 'Pressable');
    return { text, buttons };
  };
  assert.deepEqual(render({ phase: 'unsupported' }).buttons, []);
  const off = render({ phase: 'ready', settings: view, permission: 'undetermined' });
  assert.match(off.text, /Turn on message notifications/);
  assert.match(off.text, /New transmission received/);
  off.buttons[0].props.onPress();
  const blocked = render({ phase: 'ready', settings: { ...view, available: false } });
  assert.equal(blocked.buttons.length, 0);
  assert.match(blocked.text, /has not enabled notification delivery/);
  const stopped = render({ phase: 'ready', settings: { ...view, available: false, enabled: true, bindingId: 'b' } });
  assert.match(stopped.text, /stopped notification delivery/);
  stopped.buttons[0].props.onPress();
  const revoked = render({ phase: 'ready', settings: { ...view, enabled: true, bindingId: 'b' }, permission: 'denied' });
  assert.match(revoked.text, /system notifications are blocked/);
  const failed = render({ phase: 'ready', settings: view, error: 'Network request failed' });
  failed.buttons.at(-1).props.onPress();
  assert.equal(render({ phase: 'ready', settings: view, working: true }).buttons[0].props.disabled, true);
  assert.deepEqual(pressed, ['enable', 'disable', 'retry']);
});
