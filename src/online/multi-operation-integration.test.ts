/** @format */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { GameService } from '../../server/service';
import { createApi } from '../../server/http';
import type { Session } from './client';

const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
const { create, act } = require('react-test-renderer');
const KEY = '__multiOperationHost';
const globals = globalThis as typeof globalThis & Record<string, any>;
type Client = typeof import('./client') & typeof import('./useOnlineConnection') & typeof import('./network');
type Connection = ReturnType<Client['useOnlineConnection']>;

// Real connection, storage, and HTTP service; only native platform I/O is replaced.
async function clientBundle(): Promise<Client> {
  const output = await build({
    stdin: {
      contents:
        "export * from './src/online/client'; export * from './src/online/useOnlineConnection'; export {accountOperationsApi} from './src/online/network';",
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'multi-operation-native-hosts',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
            path: pathToFileURL(require.resolve(args.path)).href,
            external: true,
          }));
          const state = `globalThis[${JSON.stringify(KEY)}]`;
          const stubs: Record<string, string> = {
            'react-native':
              "export const Platform={OS:'ios'},AppState={currentState:'background',addEventListener:()=>({remove(){}})};",
            'expo-secure-store': `export const getItemAsync=async k=>${state}.get(k)??null,setItemAsync=async(k,v)=>{${state}.set(k,v)},deleteItemAsync=async k=>{${state}.delete(k)};`,
            'expo-crypto':
              "import {randomBytes,randomUUID} from 'node:crypto'; export {randomUUID}; export const getRandomBytesAsync=async n=>new Uint8Array(randomBytes(n));",
            '@react-native-async-storage/async-storage':
              'export default {getItem:async()=>null,setItem:async()=>{},removeItem:async()=>{}};',
          };
          builder.onResolve(
            { filter: /^(react-native|expo-secure-store|expo-crypto|@react-native-async-storage\/async-storage)$/ },
            (args) => ({ path: args.path, namespace: 'multi-operation-host' }),
          );
          builder.onLoad({ filter: /.*/, namespace: 'multi-operation-host' }, (args) => ({
            contents: stubs[args.path]!,
          }));
        },
      },
    ],
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`);
}

test('an account opens, creates, and resumes several operations with separate saved connections', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-multi-client-'));
  const priorAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  const renderers: any[] = [];
  const service = await GameService.open(join(directory, 'games.json'), () => 1000);
  const server = createApi(service, undefined, async (token) => {
    if (token !== 'session-alice') throw new Error('unknown session');
    return { accountId: 'user_alice' };
  });
  t.after(async () => {
    for (const renderer of renderers) await act(async () => renderer.unmount());
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    delete globals[KEY];
    if (priorAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', priorAct);
    else delete globals.IS_REACT_ACT_ENVIRONMENT;
    await rm(directory, { recursive: true, force: true });
  });
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  const native = new Map<string, string>();
  globals[KEY] = native;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const alice = { accountId: 'user_alice' };
  const account = { ...alice, getToken: async () => 'session-alice' };
  const first = await service.create(alice, undefined, undefined, undefined, 'existing-operation-01');
  const second = await service.create(alice, undefined, undefined, undefined, 'existing-operation-02');
  const priorServer = process.env.EXPO_PUBLIC_GAME_SERVER;
  process.env.EXPO_PUBLIC_GAME_SERVER = url;
  t.after(() => {
    if (priorServer === undefined) delete process.env.EXPO_PUBLIC_GAME_SERVER;
    else process.env.EXPO_PUBLIC_GAME_SERVER = priorServer;
  });
  const client = await clientBundle();

  let connection: Connection | undefined;
  const current = (): Connection | undefined => connection;
  async function mount(operationId?: string): Promise<Connection> {
    for (const renderer of renderers.splice(0)) await act(async () => renderer.unmount());
    connection = undefined;
    function Harness() {
      connection = client.useOnlineConnection(account, { onConnected() {}, onCompleted() {}, onReset() {} }, operationId);
      return null;
    }
    await act(async () => {
      renderers.push(create(React.createElement(Harness)));
    });
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      const settled = current();
      if (settled?.restored && !settled.busy) return settled;
    }
    return assert.fail(`Connection did not settle: ${current()?.error ?? 'not mounted'}`);
  }

  // A pre-multi-operation save sat in the account's single slot; it still opens its operation.
  const legacy: Session = { url, token: 'f'.repeat(64), accountId: alice.accountId, id: first.id };
  native.set('machination.online.v1.user_alice', JSON.stringify(legacy));
  assert.equal((await mount(first.id)).snapshot?.id, first.id);
  assert.equal(native.has('machination.online.v1.user_alice'), false, 'the old single slot moves to its operation slot');
  assert.equal((await client.restoreSession(alice.accountId, first.id))?.id, first.id);

  const opened = await mount(second.id);
  assert.equal(opened.snapshot?.id, second.id);
  assert.equal((await client.restoreSession(alice.accountId, second.id))?.id, second.id);
  assert.equal((await client.restoreSession(alice.accountId, first.id))?.id, first.id, 'opening one operation keeps the other');

  // A draft creation that is retried returns the same operation instead of starting another.
  const draft: Session = { url, token: 'e'.repeat(64), accountId: alice.accountId, requestId: 'draft-creation-request' };
  native.set('machination.online.v1.user_alice', JSON.stringify(draft));
  const created = (await mount()).snapshot!.id;
  native.set('machination.online.v1.user_alice', JSON.stringify(draft));
  assert.equal((await mount()).snapshot!.id, created);
  assert.equal(native.has('machination.online.v1.user_alice'), false);

  assert.equal((await mount()).session, null, 'without an operation or draft, setup opens');
  await act(async () => {
    await connection!.enter(false, false, { invite: '', options: { playerCount: 2, mode: 'mining' } });
  });
  const fresh = connection!;
  assert.ok(fresh.snapshot?.id);
  const listed = await client.accountOperationsApi({ url, token: '', ...account });
  assert.deepEqual(
    listed.map((o) => o.id),
    [fresh.snapshot!.id, created, second.id, first.id],
  );
});
