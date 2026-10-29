import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test, type TestContext } from 'node:test';
import { api, historicalApi } from './network';
import type { RequestSession } from './account-auth';
import { exportSharedReplay } from './shared-replay';
import { createConfiguredGame } from '../game/world';
import { createArchive } from '../game/replay';
import { generateSharedReplay } from '../replay/generate';
import { encodeSharedReplay } from '../replay/codec';

const require = createRequire(import.meta.url);
// This is the implementation installed by React Native's setUpXHR, not Node's fuller API.
const { AbortController: NativeAbortController } = require('abort-controller/dist/abort-controller');
const session = { url: 'https://example.test', token: 'a'.repeat(64), id: 'b'.repeat(24) };
const snapshot = { id: session.id, visibility: 'sensors.v1', faction: 'vesper', messages: [], game: { scheduled: [] } };

function nativeController(t: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AbortController')!;
  Object.defineProperty(globalThis, 'AbortController', { ...original, value: NativeAbortController });
  t.after(() => Object.defineProperty(globalThis, 'AbortController', original));
}

test('native multiplayer joins using the React Native AbortController implementation', async t => {
  nativeController(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(typeof new AbortController().signal.throwIfAborted, 'undefined');
  let sentSignal: AbortSignal | undefined;
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, `${session.url}/v1/join`);
    assert.equal(options.method, 'POST');
    assert.equal((options.headers as Record<string, string>).Authorization, `Bearer ${session.token}`);
    assert.deepEqual(JSON.parse(options.body as string), { invite: 'c'.repeat(24) });
    assert.equal(options.signal!.aborted, false);
    sentSignal = options.signal!;
    return new Response(JSON.stringify(snapshot));
  });
  assert.deepEqual(await api(session, 'join', { invite: 'c'.repeat(24) }), snapshot);
  assert.equal(fetch.mock.callCount(), 1);
  t.mock.timers.tick(15_000);
  assert.equal(sentSignal!.aborted, false, 'successful requests clear their timeout');
});

test('native replay export reaches fetch and strictly decodes the response', async t => {
  nativeController(t);
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 73);
  const replay = generateSharedReplay({ game, archive: createArchive(game) }, 'you', 0, 0);
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, `${session.url}/v1/games/${session.id}/replay?from=0&through=0`);
    assert.equal((options.headers as Record<string, string>).Authorization, `Bearer ${session.token}`);
    assert.equal(options.signal!.aborted, false);
    return { ok: true, headers: new Headers(), text: async () => encodeSharedReplay(replay) } as Response;
  });
  assert.deepEqual(await exportSharedReplay(session, 0, 0), replay);
});

const paths = [
  { name: 'history', run: (seat: RequestSession & { id: string }, signal: AbortSignal) => historicalApi(seat, 1, signal) },
  { name: 'replay', run: (seat: RequestSession & { id: string }, signal: AbortSignal) => exportSharedReplay(seat, 0, 0, signal) },
];
for (const path of paths) {
  for (const account of [false, true]) test(`native ${path.name} refuses an already canceled request before fetch, account=${account}`, async t => {
    nativeController(t);
    const caller = new AbortController(); caller.abort();
    const remove = t.mock.method(caller.signal, 'removeEventListener');
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch'); });
    let tokens = 0;
    const seat = account ? { ...session, accountId: 'user_native', getToken: async () => { tokens++; return 'unused'; } } : session;
    await assert.rejects(path.run(seat, caller.signal), { name: 'AbortError' });
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(tokens, 0, 'a canceled request never asks for an account token');
    assert.equal(remove.mock.callCount(), 1, 'caller listener is removed on refusal');
  });

  test(`native ${path.name} refreshes account authorization without falling back to the seat token`, async t => {
    nativeController(t);
    const controller = new AbortController();
    let token: string | null = 'jwt-first';
    const seat = { ...session, accountId: 'user_native', getToken: async () => token };
    const fetch = t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
      assert.equal((options.headers as Record<string, string>).Authorization, `Bearer ${token}`);
      return new Response(JSON.stringify({ issues: [{ message: { detail: 'Authenticated refusal.' } }] }), { status: 409 });
    });
    for (token of ['jwt-first', 'jwt-second']) await assert.rejects(path.run(seat, controller.signal), /Authenticated refusal/);
    token = null;
    await assert.rejects(path.run(seat, controller.signal), /Sign in/);
    assert.equal(fetch.mock.callCount(), 2);
  });

  for (const timeout of [false, true]) test(`native ${path.name} cancels during account authorization, timeout=${timeout}`, async t => {
    nativeController(t);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const caller = new AbortController();
    let authorize!: (token: string) => void;
    const seat = { ...session, accountId: 'user_native', getToken: () => new Promise<string>(resolve => { authorize = resolve; }) };
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch'); });
    const pending = path.run(seat, caller.signal);
    let outcome = 'pending';
    const result = pending.catch(error => { outcome = error.name; throw error; });
    const rejected = assert.rejects(result, { name: 'AbortError' });
    if (timeout) t.mock.timers.tick(15_000); else caller.abort();
    await new Promise<void>(resolve => setImmediate(resolve));
    const beforeToken = outcome;
    authorize('fresh-account-token');
    await rejected;
    assert.equal(beforeToken, 'AbortError', 'cancellation settles without waiting for the token provider');
    assert.equal(fetch.mock.callCount(), 0, 'late authorization cannot dispatch the canceled request');
  });

  test(`native ${path.name} rechecks cancellation after account authorization settles`, async t => {
    nativeController(t);
    const caller = new AbortController();
    const seat = { ...session, accountId: 'user_native', getToken: async () => 'fresh-token' };
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch'); });
    const pending = path.run(seat, caller.signal);
    queueMicrotask(() => queueMicrotask(() => caller.abort()));
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(fetch.mock.callCount(), 0);
  });

  test(`native ${path.name} forwards in-flight cancellation to the fetch signal`, async t => {
    nativeController(t);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const caller = new AbortController();
    const remove = t.mock.method(caller.signal, 'removeEventListener');
    let aborts = 0;
    t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => { aborts++; reject(new Error('Transport canceled.')); });
    }));
    const pending = path.run(session, caller.signal);
    caller.abort();
    await assert.rejects(pending, /Transport canceled/);
    assert.equal(aborts, 1);
    assert.equal(remove.mock.callCount(), 1);
    t.mock.timers.tick(15_000);
    assert.equal(aborts, 1, 'the timeout is cleared after cancellation');
  });
}
