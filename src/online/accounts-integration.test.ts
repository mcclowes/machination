import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
const { create, act } = require('react-test-renderer');

test('account changes unmount the previous operation and keep saved seats and pending commands separate', async t => {
  const key = `__accountIntegration_${randomUUID().replaceAll('-', '')}`;
  const globals = globalThis as typeof globalThis & Record<string, any>;
  const priorAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  const bytes = new Map<string, string>();
  const auth: Record<string, any> = { isLoaded: true, isSignedIn: false, userId: null, getToken: async () => 'jwt', signOut: async () => {} };
  globals[key] = { auth, storage: {
    getItemAsync: async (key: string) => bytes.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { bytes.set(key, value); },
    deleteItemAsync: async (key: string) => { bytes.delete(key); },
  } };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  t.after(() => { delete globals[key]; if (priorAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', priorAct); else delete globals.IS_REACT_ACT_ENVIRONMENT; });
  const output = await build({
    stdin: { contents: `export * from './src/online/client'; export * from './src/online/MultiplayerAccount';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'esm',
    define: { 'process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify('pk_test_host_stub') },
    plugins: [{ name: 'account-hosts', setup(builder) {
      builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
      const stubs: Record<string, string> = {
        'react-native': `export const View='View',Text='Text',Pressable='Pressable',ScrollView='ScrollView',ActivityIndicator='ActivityIndicator',Linking={openURL:async()=>{}},Platform={OS:'ios'},AppState={currentState:'active'};`,
        'expo-secure-store': `const store=globalThis[${JSON.stringify(key)}].storage; export const {getItemAsync,setItemAsync,deleteItemAsync}=store;`,
        'expo-crypto': `export const randomUUID=()=> 'account-test-uuid',getRandomBytesAsync=async()=>new Uint8Array(32);`,
        '@clerk/expo': `export const ClerkProvider=({children})=>children,useAuth=()=>globalThis[${JSON.stringify(key)}].auth;`,
        '@clerk/expo/token-cache': `export const tokenCache={};`,
        '@clerk/expo/hosted-auth': `export const useHostedAuth=()=>({startHostedAuth:async()=>({createdSessionId:null})});`,
      };
      builder.onResolve({ filter: /^(react-native|expo-secure-store|expo-crypto|@clerk\/expo(?:\/.*)?)$/ }, args => ({ path: args.path, namespace: 'account-host' }));
      builder.onLoad({ filter: /.*/, namespace: 'account-host' }, args => ({ contents: stubs[args.path]! }));
    } }],
  });
  const client = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`) as typeof import('./client') & typeof import('./MultiplayerAccount');
  const base = { url: 'https://belt.example', token: 'a'.repeat(64), id: '0'.repeat(24) };
  const alice = { ...base, accountId: 'user_alice', getToken: async () => 'never-persist-this-jwt', pending: { kind: 'resign' as const, body: { requestId: 'resign-request-01', revision: 0 } } };
  const bob = { ...base, accountId: 'user_bob', token: 'b'.repeat(64) };
  await client.storeSession(base);
  await client.storeSession(alice);
  await client.storeSession(bob);
  assert.equal((await client.restoreSession('user_alice'))?.pending?.kind, 'resign');
  assert.equal((await client.restoreSession('user_bob'))?.token, bob.token);
  assert.equal((await client.restoreSession())?.token, base.token);
  assert.equal([...bytes.values()].some(value => value.includes('never-persist-this-jwt')), false);
  await client.storeSession(null, 'user_bob');
  assert.equal(await client.restoreSession('user_bob'), null);
  assert.equal((await client.restoreSession('user_alice'))?.id, base.id);
  bytes.set('machination.online.v1.user_bob', JSON.stringify(alice));
  await assert.rejects(client.restoreSession('user_bob'), /another account/);

  const mounted: string[] = [], unmounted: string[] = [];
  function Operation({ accountId }: { accountId: string }) {
    React.useEffect(() => { mounted.push(accountId); return () => { unmounted.push(accountId); }; }, []);
    return React.createElement('operation', { accountId });
  }
  const element = () => React.createElement(client.MultiplayerAccount, { children: account => React.createElement(Operation, { accountId: account!.accountId }) });
  let renderer: any;
  await act(async () => { renderer = create(element()); });
  assert.equal(renderer.root.findAllByType('operation').length, 0);
  Object.assign(auth, { isSignedIn: true, userId: 'user_alice' });
  await act(async () => { renderer.update(element()); });
  Object.assign(auth, { userId: 'user_bob' });
  await act(async () => { renderer.update(element()); });
  assert.deepEqual(mounted, ['user_alice', 'user_bob']);
  assert.deepEqual(unmounted, ['user_alice']);
  Object.assign(auth, { isSignedIn: false, userId: null });
  await act(async () => { renderer.update(element()); });
  assert.equal(renderer.root.findAllByType('operation').length, 0);
  assert.deepEqual(unmounted, ['user_alice', 'user_bob']);
  await act(async () => { renderer.unmount(); });
});
