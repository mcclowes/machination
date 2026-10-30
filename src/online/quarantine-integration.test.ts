/** @format */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { GameService } from '../../server/service';
import { createApi } from '../../server/http';
import type { Pending, Session } from './client';

const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
const { create, act } = require('react-test-renderer');
const KEY = '__quarantineConnectionHost';
const globals = globalThis as typeof globalThis & Record<string, any>;
type Client = typeof import('./client') &
  typeof import('./useOnlineConnection') &
  typeof import('./network');
type Connection = ReturnType<Client['useOnlineConnection']>;
let bundle: Promise<Client> | undefined;

// Real connection/storage code and HTTP service; only native platform I/O is replaced.
function clientBundle(): Promise<Client> {
  return (bundle ??= build({
    stdin: {
      contents:
        "export * from './src/online/client'; export * from './src/online/useOnlineConnection'; export {api,RejectedCommand} from './src/online/network';",
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'quarantine-native-hosts',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
            path: pathToFileURL(require.resolve(args.path)).href,
            external: true,
          }));
          const state = `globalThis[${JSON.stringify(KEY)}]`;
          const stubs: Record<string, string> = {
            'react-native':
              "export const Platform={OS:'ios'},AppState={currentState:'background',addEventListener:()=>({remove(){}})};",
            'expo-secure-store': `export const getItemAsync=async k=>${state}.bytes.get(k)??null,setItemAsync=async(k,v)=>{${state}.writes++;${state}.bytes.set(k,v)},deleteItemAsync=async k=>{${state}.deletes++;${state}.bytes.delete(k)};`,
            'expo-crypto':
              "import {randomBytes,randomUUID} from 'node:crypto'; export {randomUUID}; export const getRandomBytesAsync=async n=>new Uint8Array(randomBytes(n));",
            '@react-native-async-storage/async-storage':
              'export default {getItem:async()=>null,setItem:async()=>{},removeItem:async()=>{}};',
          };
          builder.onResolve(
            {
              filter:
                /^(react-native|expo-secure-store|expo-crypto|@react-native-async-storage\/async-storage)$/,
            },
            (args) => ({ path: args.path, namespace: 'quarantine-host' }),
          );
          builder.onLoad({ filter: /.*/, namespace: 'quarantine-host' }, (args) => ({
            contents: stubs[args.path]!,
          }));
        },
      },
    ],
  }).then(
    (output) =>
      import(
        `data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`
      ),
  ));
}

async function settled(read: () => Connection | undefined): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (read()?.restored && !read()?.busy) return;
  }
  assert.fail(`Connection did not settle: ${read()?.error ?? 'not mounted'}`);
}

for (const kind of ['messages', 'recover'] as const)
  test(`${kind}: quarantine retains saved credentials and the original pending retry through repair`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'machination-quarantine-client-'));
    const file = join(directory, 'games.json');
    const priorAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    let renderer: any;
    let server: ReturnType<typeof createApi> | undefined;
    t.after(async () => {
      if (renderer)
        await act(async () => {
          renderer.unmount();
        });
      if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
      delete globals[KEY];
      if (priorAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', priorAct);
      else delete globals.IS_REACT_ACT_ENVIRONMENT;
      await rm(directory, { recursive: true, force: true });
    });
    globals.IS_REACT_ACT_ENVIRONMENT = true;
    const native = { bytes: new Map<string, string>(), writes: 0, deletes: 0 };
    globals[KEY] = native;
    const host = 'a'.repeat(64),
      guest = 'b'.repeat(64),
      fresh = 'c'.repeat(64),
      secret = 'd'.repeat(64);
    const service = await GameService.open(file, () => 1000);
    const room = await service.create(host);
    await service.join(room.invite!, guest);
    if (kind === 'recover')
      await service.setRecovery(room.id, host, { requestId: 'quarantine-client-setup', secret });
    const validSource = await readFile(file, 'utf8');
    const damaged = JSON.parse(validSource);
    damaged.rooms[0].game.version = 999;
    await writeFile(file, JSON.stringify(damaged));
    const quarantined = await GameService.open(file, () => 1000, undefined, {
      databaseRecovery: 'quarantine',
    });
    server = createApi(quarantined);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const pending: Pending =
      kind === 'messages'
        ? {
            kind,
            body: {
              requestId: 'quarantine-client-pending',
              to: 'vesper',
              text: 'Exactly one recovered message.',
            },
          }
        : { kind, body: { secret } };
    const saved: Session = {
      url: `http://127.0.0.1:${port}`,
      id: room.id,
      token: kind === 'recover' ? fresh : host,
      pending,
    };
    const client = await clientBundle();
    await client.storeSession(saved);
    const originalBytes = native.bytes.get('machination.online.v1');
    native.writes = 0;
    let connection: Connection | undefined;
    function Harness() {
      connection = client.useOnlineConnection(undefined, {
        onConnected() {},
        onCompleted() {},
        onReset() {},
      });
      return null;
    }
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });
    await settled(() => connection);
    assert.match(connection!.error, /temporarily unavailable/);
    assert.equal(connection!.rejectedSeat, undefined);
    assert.deepEqual(connection!.session?.pending, pending);
    await act(async () => {
      await connection!.run(() => connection!.complete(connection!.session!, pending));
    });
    assert.equal(native.bytes.get('machination.online.v1'), originalBytes);
    assert.equal(native.writes, 0);
    assert.equal(native.deletes, 0);
    assert.equal(connection!.session?.token, saved.token);

    // The isolated fixture restores its valid snapshot with every writer stopped.
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    await writeFile(file, validSource);
    server = createApi(await GameService.open(file, () => 1000));
    await new Promise<void>((resolve) => server!.listen(port, '127.0.0.1', resolve));
    await act(async () => {
      await connection!.run(() => connection!.complete(connection!.session!, pending));
    });
    assert.equal(connection!.error, '');
    assert.equal(connection!.session?.token, saved.token);
    assert.equal(connection!.session?.pending, undefined);
    assert.equal((await client.restoreSession())?.pending, undefined);
    const retried = await client.api(
      connection!.session!,
      `games/${room.id}/${pending.kind}`,
      pending.body,
    );
    if (kind === 'messages')
      assert.equal(
        retried.messages.filter((message) => message.text === 'Exactly one recovered message.')
          .length,
        1,
      );
    else {
      assert.equal(retried.id, room.id);
      await assert.rejects(
        client.api({ ...saved, token: host }, `games/${room.id}`),
        (error: unknown) => error instanceof client.RejectedCommand && error.status === 401,
      );
    }
    assert.equal(native.deletes, 0);
  });
