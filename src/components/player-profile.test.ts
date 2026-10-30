import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
const { create, act } = require('react-test-renderer');

test('profile picker loads on demand, saves selections, and restores them on reopen', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previous); else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT'); });
  const result = await build({
    stdin: { contents: "export {PlayerProfile} from './src/components/PlayerProfile'; export {loadProfile} from './src/solo/profile';", resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'profile-hosts', setup(builder) {
      builder.onResolve({ filter: /^react$/ }, () => ({ path: pathToFileURL(require.resolve('react')).href, external: true }));
      builder.onResolve({ filter: /^(react-native|@react-native-async-storage\/async-storage)$/ }, args => ({ path: args.path, namespace: 'profile-host' }));
      builder.onLoad({ filter: /.*/, namespace: 'profile-host' }, args => ({ contents: args.path === 'react-native' ? `
        export const Pressable='Pressable',ScrollView='ScrollView',Text='Text',View='View',StyleSheet={create:x=>x};
        export const Modal=({visible,children})=>visible?children:null;
      ` : `let raw=null; export default {getItem:async()=>raw,setItem:async(key,value)=>{raw=value;}};` }));
    } }],
  });
  const { PlayerProfile, loadProfile } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0]!.text).toString('base64')}`);
  let renderer: any;
  await act(async () => { renderer = create(React.createElement(PlayerProfile)); });
  const button = () => renderer.root.findAll((n: any) => n.type === 'Pressable' && n.props.accessibilityRole === 'button');
  const color = (label: string) => renderer.root.findAll((n: any) => n.type === 'Pressable' && n.props.accessibilityLabel === label)[0];
  await act(async () => { button()[0].props.onPress(); });
  assert.equal(color('Automatic player color').props.accessibilityState.checked, true);
  await act(async () => { await color('gold player color').props.onPress(); });
  assert.equal(color('gold player color').props.accessibilityState.checked, true);
  assert.deepEqual(await loadProfile(), { preferredColor: 'gold' });
  await act(async () => { button().at(-1).props.onPress(); });
  await act(async () => { button()[0].props.onPress(); });
  assert.equal(color('gold player color').props.accessibilityState.checked, true);
  await act(async () => { await color('Automatic player color').props.onPress(); });
  assert.deepEqual(await loadProfile(), {});
  await act(async () => { renderer.unmount(); });
});
