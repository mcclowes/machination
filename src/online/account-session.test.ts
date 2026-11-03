import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import type { AccountAccess } from './account-auth';

const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
const { create, act } = require('react-test-renderer');

async function mount() {
  const key = `__accountSession_${randomUUID().replaceAll('-', '')}`;
  const globals = globalThis as typeof globalThis & Record<string, any>;
  const priorAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  const tokens: Record<string, string | null> = { user_alice: 'alice-session', user_bob: 'bob-session' };
  const calls: string[] = [];
  const resource = (id: string) => ({ user: { id }, async getToken() {
    calls.push(this.user.id);
    const token = tokens[this.user.id];
    await Promise.resolve();
    return token ?? null;
  } });
  const alice = resource('user_alice'), bob = resource('user_bob');
  const session: { isLoaded: boolean; session: ReturnType<typeof resource> | null } = { isLoaded: true, session: alice };
  const auth = {
    isLoaded: true, isSignedIn: true, userId: 'user_alice' as string | null,
    async getToken() { await Promise.resolve(); return session.session?.getToken() ?? null; },
    signOut: async () => {},
  };
  globals[key] = { auth, session };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer: any;
  try {
    const output = await build({
      stdin: { contents: "export * from './src/online/MultiplayerAccount'; export {authorization} from './src/online/account-auth';", resolveDir: process.cwd(), loader: 'ts' },
      bundle: true, write: false, platform: 'node', format: 'esm',
      define: { 'process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify('pk_test_session_fixture'), 'process.env.EXPO_PUBLIC_CLERK_ACCOUNT_URL': JSON.stringify('') },
      plugins: [{ name: 'account-session-hosts', setup(builder) {
        builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
        builder.onResolve({ filter: /\/AccountSignIn$/ }, () => ({ path: 'signin', namespace: 'session-host' }));
        const stubs: Record<string, string> = {
          signin: "export const AccountSignIn='AccountSignIn';",
          'react-native': "export const View='View',Text='Text',Pressable='Pressable',ScrollView='ScrollView',ActivityIndicator='ActivityIndicator',Linking={openURL:async()=>{}};",
          '@clerk/expo': `export const ClerkProvider=({children})=>children,useAuth=()=>globalThis[${JSON.stringify(key)}].auth,useSession=()=>globalThis[${JSON.stringify(key)}].session;`,
          '@clerk/expo/token-cache': 'export const tokenCache={};',
        };
        builder.onResolve({ filter: /^(react-native|@clerk\/expo(?:\/.*)?)$/ }, args => ({ path: args.path, namespace: 'session-host' }));
        builder.onLoad({ filter: /.*/, namespace: 'session-host' }, args => ({ contents: stubs[args.path]! }));
      } }],
    });
    const app = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`) as typeof import('./MultiplayerAccount') & typeof import('./account-auth');
    const direct: { current: AccountAccess | null | undefined } = { current: undefined };
    function Access() { direct.current = app.useAccountAccess(); return null; }
    const element = () => React.createElement(React.Fragment, null,
      React.createElement(Access),
      React.createElement(app.MultiplayerAccount, { children: account => React.createElement('operation', { account }) }),
    );
    await act(async () => { renderer = create(element()); });
    return {
      auth, session, alice, bob, tokens, calls, direct, renderer,
      gate: () => renderer.root.findAllByType('operation')[0]?.props.account as AccountAccess | undefined,
      authorization: (access: AccountAccess) => app.authorization({ url: 'https://fixture.example', token: 'unused-device-credential', ...access }),
      update: () => act(async () => { renderer.update(element()); }),
      async close() {
        await act(async () => renderer.unmount());
        delete globals[key];
        if (priorAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', priorAct); else delete globals.IS_REACT_ACT_ENVIRONMENT;
      },
    };
  } catch (error) {
    if (renderer) await act(async () => renderer.unmount());
    delete globals[key];
    if (priorAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', priorAct); else delete globals.IS_REACT_ACT_ENVIRONMENT;
    throw error;
  }
}

test('both account access paths keep pending token retrieval bound to the initiating session', async () => {
  const m = await mount();
  try {
    const original = [m.direct.current!, m.gate()!];
    assert.ok(original.every(access => access.accountId === 'user_alice'));
    const pending = Promise.all(original.map(access => m.authorization(access)));
    m.auth.userId = 'user_bob';
    m.session.session = m.bob;
    await m.update();
    assert.deepEqual(await pending, ['Bearer alice-session', 'Bearer alice-session']);
    assert.equal(m.gate()!.accountId, 'user_bob');
    assert.equal(m.direct.current!.accountId, 'user_bob');
    assert.deepEqual(m.calls, ['user_alice', 'user_alice']);
    const current = [m.direct.current!, m.gate()!];
    assert.deepEqual(await Promise.all(current.map(access => m.authorization(access))), ['Bearer bob-session', 'Bearer bob-session']);
    m.tokens.user_bob = 'bob-refreshed-session';
    assert.deepEqual(await Promise.all(current.map(access => m.authorization(access))), ['Bearer bob-refreshed-session', 'Bearer bob-refreshed-session']);
    m.tokens.user_alice = null;
    for (const access of original) await assert.rejects(m.authorization(access), /Sign in/);
    assert.deepEqual(m.calls.slice(-2), ['user_alice', 'user_alice']);
  } finally {
    await m.close();
  }
});

test('loading, absent, or mismatched sessions withhold account access and remove the operation', async () => {
  const m = await mount();
  try {
    const withheld = () => {
      assert.equal(m.direct.current, undefined);
      assert.equal(m.gate(), undefined);
      assert.equal(m.renderer.root.findAllByType('ActivityIndicator').length, 1);
    };
    m.session.isLoaded = false;
    await m.update();
    withheld();
    m.session.isLoaded = true;
    m.session.session = null;
    await m.update();
    withheld();
    m.session.session = m.bob;
    await m.update();
    withheld();
    m.session.session = m.alice;
    m.auth.isLoaded = false;
    await m.update();
    withheld();
    m.auth.isLoaded = true;
    m.auth.isSignedIn = false;
    m.auth.userId = null;
    m.session.session = null;
    await m.update();
    assert.equal(m.direct.current, null);
    assert.equal(m.gate(), undefined);
    assert.equal(m.renderer.root.findAllByType('AccountSignIn').length, 1);
    assert.deepEqual(m.calls, []);
    m.auth.isSignedIn = true;
    m.auth.userId = 'user_bob';
    m.session.session = m.bob;
    await m.update();
    assert.equal(m.direct.current!.accountId, 'user_bob');
    assert.equal(m.gate()!.accountId, 'user_bob');
  } finally {
    await m.close();
  }
});

test('a replacement session for the same account supplies fresh access without reviving its ended resource', async () => {
  const m = await mount();
  try {
    const original = [m.direct.current!, m.gate()!];
    m.tokens.user_alice = null;
    m.session.session = { user: { id: 'user_alice' }, getToken: async () => 'alice-new-session' };
    await m.update();
    for (const access of original) await assert.rejects(m.authorization(access), /Sign in/);
    const current = [m.direct.current!, m.gate()!];
    assert.deepEqual(await Promise.all(current.map(access => m.authorization(access))), ['Bearer alice-new-session', 'Bearer alice-new-session']);
  } finally {
    await m.close();
  }
});
