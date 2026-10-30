import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test, type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
const { create, act } = require('react-test-renderer');

async function rootHost(t: TestContext) {
  const globals = globalThis as typeof globalThis & Record<string, any>;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  const host = { failure: '', mounts: 0, cleanups: 0, writes: 0, requests: 0, root: undefined as any,
    saved: { operation: 'existing operation', seat: 'existing seat credential' } };
  globals.__appRecoveryHost = host;
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async () => { host.requests++; throw new Error('Recovery must not send requests.'); });
  t.after(() => {
    delete globals.__appRecoveryHost;
    if (previous) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previous);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  });
  const output = await build({
    stdin: { contents: "import './index'; export const Root=globalThis.__appRecoveryHost.root;", resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'recovery-root-hosts', setup(builder) {
      builder.onResolve({ filter: /^react$/ }, () => ({ path: pathToFileURL(require.resolve('react')).href, external: true }));
      builder.onResolve({ filter: /^(expo|react-native|react-native-safe-area-context|expo-status-bar|expo-secure-store|@react-native-async-storage\/async-storage)$|^\.\/App$|\/MultiplayerAccount$/ }, args => ({ path: args.path, namespace: 'recovery-host' }));
      builder.onLoad({ filter: /.*/, namespace: 'recovery-host' }, args => ({ contents:
        args.path === 'expo' ? 'export const registerRootComponent=root=>{globalThis.__appRecoveryHost.root=root};'
          : args.path === './App' ? `import React from 'react'; const host=globalThis.__appRecoveryHost;
            export default function App(){
              React.useLayoutEffect(()=>{if(host.failure==='lifecycle')throw Error('private lifecycle details');});
              React.useEffect(()=>{host.mounts++;return()=>{host.cleanups++}},[]);
              if(host.failure==='render')throw Error('private seat credential and operation details');
              return React.createElement('Text',null,host.saved.operation);
            }`
          : args.path.endsWith('MultiplayerAccount') ? `export const AccountProvider=({children})=>{
              if(globalThis.__appRecoveryHost.failure==='provider')throw Error('private account details');return children;};`
          : args.path === 'react-native' ? "export const View='View',Text='Text',Pressable='Pressable',ScrollView='ScrollView',StyleSheet={create:x=>x};"
          : args.path === 'react-native-safe-area-context' ? "export const SafeAreaProvider='SafeAreaProvider',SafeAreaView='SafeAreaView';"
          : args.path === 'expo-status-bar' ? "export const StatusBar='StatusBar';"
          : `const host=globalThis.__appRecoveryHost; const change=()=>{host.writes++;host.saved={}};
             export default {clear:change,removeItem:change,setItem:change,multiRemove:change};export const deleteItemAsync=change;`
      }));
    } }],
  });
  const { Root } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}#${randomUUID()}`);
  let renderer: any;
  const render = async () => act(async () => {
    if (renderer) renderer.update(React.createElement(Root));
    else renderer = create(React.createElement(Root));
  });
  t.after(async () => { if (renderer) await act(async () => renderer.unmount()); });
  return { host, render, tree: () => renderer.toJSON(),
    retry: async () => act(async () => renderer.root.findByProps({ accessibilityRole: 'button', accessibilityLabel: 'Try again' }).props.onPress()) };
}

test('a root render failure offers recovery and retries without clearing the existing operation or seat', async t => {
  const { host, render, tree, retry } = await rootHost(t);
  await render();
  assert.equal(host.mounts, 1);
  assert.ok(!JSON.stringify(tree()).includes('Try again'));
  host.failure = 'render';
  await render();
  assert.ok(JSON.stringify(tree()).includes('Try again'));
  assert.ok(!JSON.stringify(tree()).includes('private seat credential'));
  assert.equal(host.cleanups, 1, 'the failed operation releases its effects');
  host.failure = '';
  await retry();
  assert.equal(host.mounts, 2, 'retry remounts the application');
  assert.ok(JSON.stringify(tree()).includes('existing operation'));
  assert.equal(host.saved.seat, 'existing seat credential');
  assert.equal(host.writes, 0);
  assert.equal(host.requests, 0);
});

test('account initialization failures remain recoverable outside the account provider', async t => {
  const { host, render, tree, retry } = await rootHost(t);
  host.failure = 'provider';
  await render();
  assert.ok(JSON.stringify(tree()).includes('Try again'));
  assert.ok(!JSON.stringify(tree()).includes('private account details'));
  assert.equal(host.mounts, 0);
  host.failure = '';
  await retry();
  assert.equal(host.mounts, 1);
  assert.ok(JSON.stringify(tree()).includes('existing operation'));
  assert.equal(host.writes, 0);
  assert.equal(host.requests, 0);
});

test('retrying a persistent failure keeps recovery available and never erases saved access', async t => {
  const { host, render, tree, retry } = await rootHost(t);
  host.failure = 'render';
  await render();
  for (let attempt = 0; attempt < 3; attempt++) {
    await retry();
    assert.ok(JSON.stringify(tree()).includes('Try again'));
    assert.ok(!JSON.stringify(tree()).includes('private seat credential'));
    assert.equal(host.writes, 0);
    assert.equal(host.requests, 0);
    assert.equal(host.saved.seat, 'existing seat credential');
  }
});

test('descendant lifecycle failures unmount the operation and recover through the same control', async t => {
  const { host, render, tree, retry } = await rootHost(t);
  await render();
  host.failure = 'lifecycle';
  await render();
  assert.ok(JSON.stringify(tree()).includes('Try again'));
  assert.equal(host.cleanups, 1);
  assert.ok(!JSON.stringify(tree()).includes('private lifecycle details'));
  host.failure = '';
  await retry();
  assert.equal(host.mounts, 2);
  assert.equal(host.writes, 0);
  assert.equal(host.requests, 0);
});
