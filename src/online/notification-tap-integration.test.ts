import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { build } from 'esbuild';
import { Failure, GameService } from '../../server/service';
import { createApi } from '../../server/http';
import { SPECIALISTS } from '../game/specialist-catalog';
import { playerAppearance } from '../game/players';
import { OPERATION_MOTION_NATIVE, OPERATION_MOTION_PREFERENCE } from '../test-support/operation-motion-host';

const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
const { create, act } = require('react-test-renderer');
type Node = { type: unknown; props: Record<string, any>; children: (Node | string)[]; findAll: (predicate: (node: Node) => boolean) => Node[] };
const text = (node: Node | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
const KEY = '__notificationTapIntegration';
const globals = globalThis as typeof globalThis & Record<string, any>;

// Real App, OnlineOperation, notification hooks, HTTP API, and GameService. Native IO and decorative motion are replaced:
// secure storage, crypto, and the notification device. This is host evidence, not native tap acceptance.
const bundles = new Map<boolean, Promise<string>>();
// The account variant configures Clerk with a host stub; the server decides whether its token is accepted.
const bundleFor = (account: boolean) => bundles.get(account) ?? bundles.set(account, build({
  entryPoints: [new URL('../../App.tsx', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.png': 'dataurl' }, logLevel: 'silent',
  ...(account ? { define: { 'process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify('pk_test_host_stub') } } : {}),
  plugins: [{ name: 'tap-native-hosts', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
    const host = (path: string) => ({ path, namespace: 'tap-host' });
    builder.onResolve({ filter: /\/SpaceBackground$/ }, () => host('sky'));
    builder.onResolve({ filter: /use-ambient-motion$/ }, () => host('motion'));
    builder.onResolve({ filter: /\/audio\/sound$/ }, () => host('audio'));
    builder.onResolve({ filter: /replay\/files$/ }, () => host('replay-files'));
    builder.onResolve({ filter: /\/notification-device$/ }, () => host('notification-device'));
    builder.onResolve({ filter: /^(react-native(?:-svg|-safe-area-context)?|expo-[a-z-]+|@react-native-async-storage\/async-storage|@clerk\/expo(?:\/.*)?)$/ }, args => host(args.path));
    const g = `globalThis[${JSON.stringify(KEY)}]`;
    const stubs: Record<string, string> = {
      sky: 'export const SpaceBackground=()=>null;',
      motion: OPERATION_MOTION_PREFERENCE,
      audio: 'export const playSound=()=>{},useSoundCues=()=>{},useSoundEnabled=()=>false,setSoundEnabled=()=>{};',
      'replay-files': `export const pickSharedReplay=()=>{throw new Error('replay file')},saveSharedReplay=()=>{throw new Error('replay file')};`,
      'notification-device': `export * from ${JSON.stringify(new URL('./notification-device.ts', import.meta.url).pathname)}; export const loadNotificationDevice=async()=>{${g}.loads++;return ${g}.device;};`,
      'react-native': `import React from 'react';
        export const View='View',Text='Text',Image='Image',Pressable='Pressable',ScrollView='ScrollView',TextInput='TextInput',KeyboardAvoidingView='KeyboardAvoidingView',ActivityIndicator='ActivityIndicator';
        export const Modal=({visible,children,...props})=>visible?React.createElement('Modal',props,children):null;
        export const StyleSheet={create:x=>x,absoluteFillObject:{},hairlineWidth:1},Platform={OS:'ios',select:x=>x.ios??x.native??x.default};
        export const useWindowDimensions=()=>({width:1200,height:800,scale:1,fontScale:1});
        export const Dimensions={get:()=>({width:1200,height:800})},PanResponder={create:x=>({panHandlers:x})},Linking={openURL:async()=>{}};
        export const AppState={currentState:'background',addEventListener:()=>({remove(){}})},Keyboard={dismiss(){},isVisible:()=>false,addListener:()=>({remove(){}})};
        ${OPERATION_MOTION_NATIVE}`,
      'react-native-safe-area-context': `export const SafeAreaProvider='SafeAreaProvider',SafeAreaView='SafeAreaView';`,
      'react-native-svg': `export default 'Svg'; export const Circle='Circle',Ellipse='Ellipse',G='G',Line='Line',Path='Path',Rect='Rect',Text='SvgText',Defs='Defs',RadialGradient='RadialGradient',LinearGradient='LinearGradient',Stop='Stop';`,
      'expo-status-bar': `export const StatusBar='StatusBar';`,
      'expo-crypto': `import { randomUUID as uuid, randomBytes } from 'node:crypto'; export const randomUUID=()=>uuid(),getRandomBytesAsync=async n=>new Uint8Array(randomBytes(n));`,
      'expo-secure-store': `export const getItemAsync=async k=>${g}.secure.get(k)??null,setItemAsync=async(k,v)=>{${g}.secure.set(k,v)},deleteItemAsync=async k=>{${g}.secure.delete(k)};`,
      'expo-clipboard': `export const setStringAsync=async()=>true;`,
      '@react-native-async-storage/async-storage': `export default {getItem:async k=>${g}.async.get(k)??null,setItem:async(k,v)=>{${g}.async.set(k,v)},removeItem:async k=>{${g}.async.delete(k)}};`,
      '@clerk/expo': `export const ClerkProvider=({children})=>children,useAuth=()=>${g}.auth??(()=>{throw new Error('Clerk is not configured in this test')})();`,
    };
    builder.onLoad({ filter: /.*/, namespace: 'tap-host' }, args => {
      const contents = stubs[args.path] ?? (args.path.startsWith('@clerk/expo/') ? 'export const tokenCache={},useHostedAuth=()=>({}),SignInButton=()=>null;' : undefined);
      if (contents === undefined) throw new Error(`Unstubbed native module ${args.path}`);
      return { contents, resolveDir: process.cwd() };
    });
  } }],
}).then(output => output.outputFiles[0]!.text)).get(account)!;

type Tap = { kind: string; version: number; gameId: string; bindingId: string; notificationId: string };
function fakeDevice() {
  const opened = new Set<(open: { data: unknown }) => void>();
  const calls = { cleared: 0, prompts: 0, tokens: 0 };
  let last: { data: unknown } | null = null;
  return {
    calls, opened, setLast(data: unknown) { last = { data }; },
    tap(data: unknown) { last = { data }; for (const listener of opened) listener({ data }); },
    device: {
      permission: async () => 'granted' as const,
      requestPermission: async () => { calls.prompts++; return 'granted' as const; },
      pushToken: async () => { calls.tokens++; return 'ExponentPushToken[tap-test]'; },
      onTokenChange: () => () => {},
      lastOpened: async () => last,
      onOpened: (listener: (open: { data: unknown }) => void) => { opened.add(listener); return () => opened.delete(listener); },
      clearOpened: async () => { calls.cleared++; last = null; },
    },
  };
}

async function scenario(t: TestContext, options: { token?: string; account?: 'expired' | 'valid'; linked?: boolean; stored?: boolean; incoming?: boolean; legacy?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'machination-tap-'));
  const file = join(dir, 'games.json');
  const clock = { now: 1_900_000_000_000 };
  const service = await GameService.open(file, () => clock.now, undefined, { notifications: true });
  const seats = [0, 1, 2].map(() => randomBytes(32).toString('hex'));
  const room = await service.create(seats[0]!);
  await service.join(room.invite, seats[1]!); await service.join(room.invite, seats[2]!);
  await service.start(room.id, seats[0]!);
  // A linked seat is controlled by the account; its bindings belong to that credential generation.
  if (options.linked) await service.linkAccount(room.id, seats[0]!, { accountId: 'user_alice' });
  const owner = options.linked ? { accountId: 'user_alice' } : seats[0]!;
  const deviceId = randomBytes(32).toString('hex');
  const enable = (revision: number) => service.setNotifications(room.id, owner, { requestId: randomUUID(), deviceId, revision, enabled: true, expoPushToken: `ExponentPushToken[${randomBytes(8).toString('hex')}]` });
  const first = await enable(0);
  await service.setNotifications(room.id, owner, { requestId: randomUUID(), deviceId, revision: 1, enabled: false });
  const current = await enable(2);
  assert.notEqual(first.bindingId, current.bindingId);
  if (options.incoming !== undefined) await service.setNotifications(room.id, owner, { requestId: randomUUID(), deviceId, revision: 3, enabled: true, incoming: options.incoming }, 2);

  const failing = { game: false, settings: false, session: false };
  const requests: string[] = [];
  // Only the explicit valid account bearer authenticates; legacy seat bearers use the real service path.
  const authenticate = options.account && (async (bearer: string) => {
    if (bearer === 'valid-clerk-session') return { accountId: 'user_alice' };
    throw new Failure(401, 'account.unauthorized.session', 'Sign in to your Machination account.');
  });
  const api = createApi(service, undefined, authenticate).listeners('request')[0] as (req: IncomingMessage, res: ServerResponse) => void;
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url!.replace(/\?.*$/, '')}`);
    if (options.legacy && req.method === 'GET' && req.url!.includes('/notifications') && new URL(req.url!, 'http://localhost').searchParams.has('version')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ issues: [{ issue: 'notification.validation.device', message: { detail: 'Provide exactly one deviceId and no other query parameters.' } }] }));
      return;
    }
    const kind = req.url!.includes('/notifications') ? 'settings' : req.url!.includes('/account/session') ? 'session' : 'game';
    if (failing[kind]) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ issues: [{ message: { detail: 'Temporarily unavailable.' } }] })); return; }
    api(req, res);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const fake = fakeDevice();
  globals[KEY] = {
    loads: 0, device: fake.device,
    secure: new Map<string, string>([
      ...(options.stored === false ? [] : [['machination.online.v1', JSON.stringify({ url, token: options.token ?? seats[0], id: room.id })] as [string, string]]),
      ['machination.notifications.v1.device', deviceId],
      ['machination.notifications.v1.registered', '1'],
    ]),
    async: new Map<string, string>([['machination.briefing.v1', '1']]),
    ...(options.account ? { auth: { isLoaded: true, isSignedIn: true, userId: 'user_alice', getToken: async () => `${options.account}-clerk-session`, signOut: async () => {} } } : {}),
  };
  // Without a stored seat, account restore starts from the configured server address.
  const originalServer = process.env.EXPO_PUBLIC_GAME_SERVER;
  process.env.EXPO_PUBLIC_GAME_SERVER = url;
  const originalInterval = globalThis.setInterval;
  globalThis.setInterval = (() => 0) as unknown as typeof setInterval;
  const originalFetch = globalThis.fetch;
  let pendingRequests = 0, requestRevision = 0;
  globalThis.fetch = async (input, init) => {
    pendingRequests++; requestRevision++;
    try { return await originalFetch(input, init); }
    finally { pendingRequests--; }
  };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer: any;
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
    globalThis.fetch = originalFetch;
    globalThis.setInterval = originalInterval; delete globals[KEY];
    if (originalServer === undefined) delete process.env.EXPO_PUBLIC_GAME_SERVER; else process.env.EXPO_PUBLIC_GAME_SERVER = originalServer;
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  const { default: App } = await import(`data:text/javascript;base64,${Buffer.from(`${await bundleFor(!!options.account)}\n// ${randomUUID()}`).toString('base64')}`);
  const settle = async () => {
    const deadline = Date.now() + 10_000;
    let idlePasses = 0, previousRevision = requestRevision;
    for (let pass = 0; Date.now() < deadline; pass++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
      idlePasses = pendingRequests === 0 && previousRevision === requestRevision ? idlePasses + 1 : 0;
      previousRevision = requestRevision;
      if (pass >= 19 && idlePasses >= 3) return;
    }
    assert.fail('HTTP requests and React effects did not settle within 10 seconds.');
  };
  const hosts = (type: string) => renderer.root.findAll((node: Node) => node.type === type) as Node[];
  const label = (node: Node) => node.props.accessibilityLabel ?? text(node);
  const press = async (name: string) => {
    const match = hosts('Pressable').find(node => label(node) === name);
    assert.ok(match, `Missing control: ${name}`);
    assert.ok(!match.props.disabled, `Disabled control: ${name}`);
    await act(async () => { match.props.onPress(); }); await settle();
  };
  const tab = (name: string) => hosts('Pressable').find(node => node.props.accessibilityLabel === name && node.props.accessibilityState?.selected !== undefined);
  const signalsOpen = () => tab('Signals')?.props.accessibilityState.selected === true && /Diplomacy and signals/.test(text(renderer.root));
  const visible = () => text(renderer.root);
  const mount = async () => { await act(async () => { renderer = create(React.createElement(App)); }); await settle(); };
  const tapFor = (bindingId: string, extra: Partial<Tap> = {}): Tap => ({ kind: 'machination.message', version: 1, gameId: room.id, bindingId, notificationId: randomBytes(16).toString('hex'), ...extra });
  const stored = async () => JSON.parse(await readFile(file, 'utf8'));
  return { room, seats, service, clock, deviceId, current: current.bindingId!, stale: first.bindingId!, fake, failing, requests, mount, press, settle, signalsOpen, visible, tapFor, stored, tab, hosts };
}

test('restored online site inspection explains roles at live and forecast times without a command', async t => {
  const s = await scenario(t);
  const before = await s.stored();
  s.fake.setLast(s.tapFor(s.current));
  await s.mount();
  const snapshot = await s.service.snapshot(s.room.id, s.seats[0]!);
  const core = snapshot.game.rocks.find(site => site.known && site.coreOf === snapshot.faction)!;
  await s.press('Chart');
  await s.press(s.hosts('Pressable').find(node => node.props.accessibilityLabel?.startsWith(`${core.name},`))!.props.accessibilityLabel);
  assert.match(s.visible(), /Specialists at this site/);
  assert.ok(s.visible().includes(SPECIALISTS.queen.description));
  assert.ok(s.visible().includes(`Specialist owner: ${playerAppearance(snapshot.faction, snapshot.game.rules?.portraits).name}`));
  await s.press('Time Machine');
  await s.press('+1h');
  assert.match(s.visible(), /Forecast/);
  assert.ok(s.visible().includes(SPECIALISTS.queen.description));
  await s.press('Now');
  await s.press('Map controls');
  await s.press('Fit chart');
  const unknown = snapshot.game.rocks.find(site => !site.known)!;
  await s.press(s.hosts('Pressable').find(node => node.props.accessibilityLabel?.startsWith(`${unknown.name},`))!.props.accessibilityLabel);
  assert.doesNotMatch(s.visible(), /Specialists at this site/);
  assert.ok(!s.visible().includes(SPECIALISTS.queen.description));
  assert.deepEqual(s.requests.filter(request => !request.startsWith('GET ')), []);
  assert.deepEqual((await s.stored()).rooms, before.rooms, 'Role inspection and forecasting do not alter orders, activity, or messages');
});

test('a cold-start tap for the current binding opens Signals with no command or game-time effect', async t => {
  const s = await scenario(t);
  const before = await s.stored();
  s.fake.setLast(s.tapFor(s.current));
  await s.mount();
  assert.ok(s.signalsOpen(), 'Signals opens for the restored seat and matching binding');
  assert.doesNotMatch(s.visible(), /was not opened/);
  assert.ok(s.fake.calls.cleared >= 1, 'the consumed native response is cleared');
  assert.deepEqual(s.fake.calls, { ...s.fake.calls, prompts: 0, tokens: 0 });
  assert.deepEqual(s.requests.filter(r => !r.startsWith('GET ')), [], 'no command, activity, or preference write');
  const after = await s.stored();
  assert.deepEqual(after.rooms, before.rooms, 'game time, orders, activity, and messages are unchanged');
  // The same response delivered again after consumption cannot reopen anything.
  await s.press('Chart');
  const cleared = s.fake.calls.cleared;
  await act(async () => { s.fake.tap(s.tapFor(s.current, { notificationId: 'repeat' })); });
  await s.settle();
  assert.ok(s.signalsOpen(), 'a fresh matching tap opens again');
  await s.press('Chart');
  await act(async () => { s.fake.tap(s.tapFor(s.current, { notificationId: 'repeat' })); });
  await s.settle();
  assert.equal(s.signalsOpen(), false, 'a consumed notification ID is not reopened');
  assert.ok(s.fake.calls.cleared > cleared);
});

test('incoming taps open the live chart, leaving forecasts and Signals without issuing a command', async t => {
  const s = await scenario(t, { incoming: true });
  const defender = await s.service.snapshot(s.room.id, s.seats[0]!);
  const attacker = await s.service.snapshot(s.room.id, s.seats[1]!);
  const from = attacker.game.rocks.find(rock => rock.known && rock.owner === attacker.faction && !rock.coreOf && rock.drones >= 5)!;
  const to = defender.game.rocks.find(rock => rock.owner === defender.faction && rock.coreOf)!;
  await s.service.order(s.room.id, s.seats[1]!, { requestId: randomUUID(), revision: attacker.revision, from: from.id, to: to.id, drones: 5 });
  s.clock.now += 0.5 * 3_600_000;
  await s.service.notificationQueue().settleIncoming!();
  const claim = await s.service.notificationQueue().claimSends('incoming-app-test');
  assert.equal(claim.items.length, 1);
  const delivered = claim.items[0]!.message;
  assert.match(delivered.body, /Incoming attack from Vesper: 5 drones arriving in/);
  assert.equal(delivered.data.kind, 'machination.incoming');
  assert.equal(s.requests.length, 0, 'The server materialized the attack with no connected HTTP client');
  const before = await s.stored();
  const incoming = () => s.tapFor(s.current, { kind: 'machination.incoming' });
  s.fake.setLast(delivered.data);
  await s.mount();
  assert.equal(s.tab('Chart')!.props.accessibilityState.selected, true);
  assert.equal(s.signalsOpen(), false);
  assert.ok(s.fake.calls.cleared >= 1);
  await s.press('Time Machine');
  await s.press('+1h');
  assert.match(s.visible(), /Forecast/);
  await s.press('Signals');
  assert.ok(s.signalsOpen());
  await act(async () => s.fake.tap(incoming()));
  await s.settle();
  assert.equal(s.tab('Chart')!.props.accessibilityState.selected, true);
  assert.equal(s.signalsOpen(), false);
  assert.doesNotMatch(s.visible(), /Forecast|was not opened/);
  assert.deepEqual(s.requests.filter(request => !request.startsWith('GET ')), []);
  assert.deepEqual((await s.stored()).rooms, before.rooms);
  assert.equal(s.fake.calls.prompts + s.fake.calls.tokens, 0);
});

test('a pre-incoming server still supports message taps and disabling notifications', async t => {
  const s = await scenario(t, { legacy: true });
  s.fake.setLast(s.tapFor(s.current));
  await s.mount();
  assert.ok(s.signalsOpen(), 'The old server’s version-query refusal falls back to message-only settings');
  await s.press('Setup');
  assert.match(s.visible(), /Turn off message notifications/);
  assert.doesNotMatch(s.visible(), /Incoming attack alerts/);
  await s.press('Turn off message notifications');
  assert.match(s.visible(), /Turn on message notifications/);
  assert.equal((await s.service.notificationSettings(s.room.id, s.seats[0]!, s.deviceId)).enabled, false);
  assert.deepEqual(s.requests.filter(request => !request.startsWith('GET ')), [`POST /v1/games/${s.room.id}/notifications`]);
});

test('each incoming tap confirms fresh consent even when the binding ID has not changed', async t => {
  const s = await scenario(t, { incoming: true });
  await s.mount();
  await s.press('Open multiplayer uplink');
  await s.press('Signals');
  assert.ok(s.signalsOpen());
  const before = s.requests.filter(request => request.endsWith('/notifications')).length;
  const revoked = await s.service.setNotifications(s.room.id, s.seats[0]!, { requestId: randomUUID(), deviceId: s.deviceId, revision: 4, enabled: true, incoming: false }, 2);
  assert.equal(revoked.bindingId, s.current);
  await act(async () => s.fake.tap(s.tapFor(s.current, { kind: 'machination.incoming' })));
  await s.settle();
  assert.ok(s.signalsOpen(), 'A revoked incoming alert cannot navigate away from Signals');
  assert.match(s.visible(), /incoming alerts are off for this device/);
  assert.equal(s.requests.filter(request => request.endsWith('/notifications')).length, before + 1);
  assert.ok(s.fake.calls.cleared >= 1);
  await s.press('Chart');
  await act(async () => s.fake.tap(s.tapFor(s.current)));
  await s.settle();
  assert.ok(s.signalsOpen(), 'Message taps still work for the same enabled binding');
  assert.deepEqual(s.requests.filter(request => !request.startsWith('GET ')), []);
});

test('incoming alerts wait through unreadable settings and preserve solo, practice, and replay sessions', async t => {
  const s = await scenario(t, { incoming: true });
  await s.mount();
  for (const [open, marker] of [['Open solo operation', /Solo operation/], ['Start tactical practice', /Tactical practice/], ['Open shared replay', /Shared replays/]] as const) {
    await s.press(open);
    const requests = s.requests.length;
    await act(async () => s.fake.tap(s.tapFor(s.current, { kind: 'machination.incoming' })));
    await s.settle();
    assert.match(s.visible(), marker);
    assert.match(s.visible(), /Incoming attack alert\./);
    assert.equal(s.requests.length, requests);
    await s.press('Dismiss');
    await s.press(open === 'Open shared replay' ? 'Exit replay library' : '‹ Games');
  }
  await s.press('Open solo operation');
  s.failing.settings = true;
  await act(async () => s.fake.tap(s.tapFor(s.current, { kind: 'machination.incoming' })));
  await s.settle();
  await s.press('Open multiplayer');
  assert.match(s.visible(), /An incoming attack alert is waiting/);
  assert.equal(s.fake.calls.cleared, 3, 'Only the three dismissed alerts have been consumed');
  s.failing.settings = false;
  await s.press('Retry notification');
  assert.equal(s.tab('Chart')!.props.accessibilityState.selected, true);
  assert.doesNotMatch(s.visible(), /was not opened/);
  assert.ok(s.fake.calls.cleared > 3);
  assert.deepEqual(s.requests.filter(request => !request.startsWith('GET ')), []);
});

test('stale bindings and foreign operations are consumed without opening Signals', async t => {
  const s = await scenario(t);
  s.fake.setLast(s.tapFor(s.stale));
  await s.mount();
  assert.equal(s.signalsOpen(), false);
  assert.match(s.visible(), /was not opened because it does not match/);
  const cleared = s.fake.calls.cleared;
  assert.ok(cleared >= 1);
  await act(async () => { s.fake.tap(s.tapFor(s.current, { gameId: 'f'.repeat(24) })); });
  await s.settle();
  assert.equal(s.signalsOpen(), false);
  assert.ok(s.fake.calls.cleared > cleared);
  await act(async () => { s.fake.tap({ ...s.tapFor(s.current), sender: 'leak' }); });
  await s.settle();
  assert.equal(s.signalsOpen(), false, 'malformed payloads never navigate');
  assert.deepEqual(s.requests.filter(r => !r.startsWith('GET ')), []);
});

test('solo, practice, and replay sessions are not replaced by a tap', async t => {
  const s = await scenario(t);
  await s.mount();
  for (const [open, marker] of [['Open solo operation', /Solo operation/], ['Start tactical practice', /Tactical practice/], ['Open shared replay', /Shared replays/]] as const) {
    await s.press(open);
    assert.match(s.visible(), marker);
    const requests = s.requests.length;
    await act(async () => { s.fake.tap(s.tapFor(s.current)); });
    await s.settle();
    assert.match(s.visible(), marker, `${open} stays in place`);
    assert.match(s.visible(), /New transmission received\./);
    assert.equal(s.requests.length, requests, 'multiplayer is not mounted behind the current session');
    await s.press('Dismiss');
    assert.doesNotMatch(s.visible(), /New transmission received\./);
    await s.press(open === 'Open shared replay' ? 'Exit replay library' : '‹ Games');
  }
  await act(async () => { s.fake.tap(s.tapFor(s.current)); });
  await s.settle();
  assert.ok(s.signalsOpen(), 'from the start screen a tap opens multiplayer and Signals');
});

test('an explicit Open multiplayer from solo routes the pending tap', async t => {
  const s = await scenario(t);
  await s.mount();
  await s.press('Open solo operation');
  await act(async () => { s.fake.tap(s.tapFor(s.current)); });
  await s.settle();
  await s.press('Open multiplayer');
  assert.ok(s.signalsOpen());
});

test('transient restore and settings failures keep the tap pending until an explicit retry succeeds', async t => {
  const s = await scenario(t);
  s.failing.game = true;
  s.fake.setLast(s.tapFor(s.current));
  await s.mount();
  assert.match(s.visible(), /Temporarily unavailable/);
  assert.match(s.visible(), /waiting for this operation to reconnect/);
  assert.doesNotMatch(s.visible(), /was not opened/);
  assert.equal(s.fake.calls.cleared, 0, 'the tap is still pending after a failed restore');
  s.failing.game = false; s.failing.settings = true;
  await s.press('Retry notification');
  assert.equal(s.signalsOpen(), false, 'settings could not confirm the binding yet');
  assert.match(s.visible(), /could not be checked/);
  assert.equal(s.fake.calls.cleared, 0);
  s.failing.settings = false;
  await s.press('Retry notification');
  assert.ok(s.signalsOpen(), 'the retried settings read confirms the binding and opens Signals');
  assert.ok(s.fake.calls.cleared >= 1);
  assert.deepEqual(s.requests.filter(r => !r.startsWith('GET ')), []);
});

test('a pending tap can be dismissed without a snapshot', async t => {
  const s = await scenario(t);
  s.failing.game = true;
  s.fake.setLast(s.tapFor(s.current));
  await s.mount();
  await s.press('Dismiss notification');
  assert.doesNotMatch(s.visible(), /waiting for this operation/);
  assert.equal(s.fake.calls.cleared, 1);
  s.failing.game = false;
  await s.press('Reconnect / refresh');
  assert.equal(s.signalsOpen(), false, 'a dismissed tap does not open later');
});

test('a rejected seat credential is terminal and ignores the tap', async t => {
  const s = await scenario(t, { token: 'e'.repeat(64) });
  s.fake.setLast(s.tapFor(s.current));
  await s.mount();
  assert.match(s.visible(), /was not opened because it does not match/);
  assert.doesNotMatch(s.visible(), /waiting for this operation/);
  assert.equal(s.fake.calls.cleared, 1);
});

test('a warm app re-reads the binding for each tap instead of trusting cached settings', async t => {
  const s = await scenario(t);
  await s.mount();
  await s.press('Open multiplayer uplink');
  await s.press('Setup');
  assert.match(s.visible(), /Turn off device notifications/, 'the app cached this device as enabled');
  const reads = () => s.requests.filter(r => r.endsWith('/notifications')).length;
  const before = reads();
  // The server detaches this device after the app cached it as enabled.
  await s.service.setNotifications(s.room.id, s.seats[0]!, { requestId: randomUUID(), deviceId: s.deviceId, revision: 3, enabled: false });
  await act(async () => { s.fake.tap(s.tapFor(s.current)); });
  await s.settle();
  assert.equal(reads(), before + 1, 'the tap triggered a fresh settings read');
  assert.equal(s.signalsOpen(), false, 'a detached binding cannot open Signals');
  assert.match(s.visible(), /was not opened/);
  // Re-enabled elsewhere with a new binding: a tap for the new binding opens even though the app cached the old one.
  const renewed = await s.service.setNotifications(s.room.id, s.seats[0]!, { requestId: randomUUID(), deviceId: s.deviceId, revision: 4, enabled: true, expoPushToken: 'ExponentPushToken[renewed]' });
  await act(async () => { s.fake.tap(s.tapFor(renewed.bindingId!)); });
  await s.settle();
  assert.ok(s.signalsOpen());
  assert.equal(s.fake.calls.prompts + s.fake.calls.tokens, 0, 'taps never request permission or register');
  assert.deepEqual(s.requests.filter(r => !r.startsWith('GET ')), []);
});

test('a rejected account link does not reject the stored legacy seat or drop a pending tap', async t => {
  const s = await scenario(t, { account: 'expired' });
  s.failing.settings = true;
  s.fake.setLast(s.tapFor(s.current));
  await s.mount();
  assert.match(s.visible(), /could not be checked/, 'the tap waits on unreadable settings');
  await s.press('Setup');
  await s.press('Link seat to my account');
  assert.match(s.visible(), /could not link this seat/);
  assert.doesNotMatch(s.visible(), /was not opened/, 'the legacy seat was not treated as rejected');
  assert.equal(s.fake.calls.cleared, 0, 'the tap is still pending');
  assert.match(s.visible(), /Link seat to my account/, 'the legacy seat and its snapshot are kept');
  assert.equal(s.requests.filter(r => r === 'POST /v1/account/link').length, 1, 'linking ran once, only on the explicit action');
  s.failing.settings = false;
  await s.press('Retry notification');
  assert.ok(s.signalsOpen(), 'the legacy seat still confirms its binding and opens Signals');
  assert.equal(s.requests.filter(r => r === 'POST /v1/account/link').length, 1, 'the tap caused no link retry');
  assert.deepEqual(s.requests.filter(r => r.startsWith('POST ') && r !== 'POST /v1/account/link'), []);
});

test('a valid account link with an invalidated legacy seat keeps the terminal seat-loss path', async t => {
  const s = await scenario(t, { account: 'valid' });
  s.failing.settings = true;
  s.fake.setLast(s.tapFor(s.current));
  await s.mount();
  assert.match(s.visible(), /could not be checked/, 'the tap waits on unreadable settings');
  // The seat is recovered elsewhere after restore, so the stored legacy token no longer controls it.
  const secret = randomBytes(32).toString('hex');
  await s.service.setRecovery(s.room.id, s.seats[0]!, { requestId: randomUUID(), secret });
  await s.service.recover(s.room.id, randomBytes(32).toString('hex'), { secret });
  await s.press('Setup');
  await s.press('Link seat to my account');
  assert.doesNotMatch(s.visible(), /could not link this seat/, 'a rejected seat token is not reported as an account problem');
  assert.match(s.visible(), /existing seat credential is required/);
  assert.match(s.visible(), /Machination \/ uplink/, 'the snapshot is cleared as for any lost seat');
  assert.match(s.visible(), /was not opened because it does not match/, 'the pending tap is terminally ignored');
  assert.equal(s.fake.calls.cleared, 1);
  assert.equal(s.requests.filter(r => r === 'POST /v1/account/link').length, 1);
  assert.deepEqual(s.requests.filter(r => r.startsWith('POST ') && r !== 'POST /v1/account/link'), []);
});

test('an account cold start with no stored seat waits through a transient restore failure, then opens on retry', async t => {
  const s = await scenario(t, { account: 'valid', linked: true, stored: false });
  s.failing.session = true;
  s.fake.setLast(s.tapFor(s.current));
  await s.mount();
  assert.match(s.visible(), /Temporarily unavailable/);
  assert.match(s.visible(), /waiting for this operation to reconnect/);
  assert.doesNotMatch(s.visible(), /was not opened/);
  assert.equal(s.fake.calls.cleared, 0, 'the tap is still pending after a failed account restore');
  s.failing.session = false;
  await s.press('Retry notification');
  assert.ok(s.signalsOpen(), 'the restored account seat confirms its binding and opens Signals');
  assert.equal(s.requests.filter(r => r === 'GET /v1/account/session').length, 2, 'one automatic restore and one explicit retry');
  assert.deepEqual(s.requests.filter(r => r.startsWith('POST ')), []);
});

test('an account cold start rejected by the server is terminal for the tap', async t => {
  const s = await scenario(t, { account: 'expired', linked: true, stored: false });
  s.fake.setLast(s.tapFor(s.current));
  await s.mount();
  assert.match(s.visible(), /Sign in to your Machination account/);
  assert.match(s.visible(), /was not opened because it does not match/);
  assert.doesNotMatch(s.visible(), /waiting for this operation/);
  assert.equal(s.fake.calls.cleared, 1);
  assert.equal(s.requests.filter(r => r === 'GET /v1/account/session').length, 1, 'no automatic retry');
});
