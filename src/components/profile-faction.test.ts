import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
const { create, act } = require('react-test-renderer');

test('profile factions use account credentials, restore device seats, and explain missing connections', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previous); else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT'); });
  const result = await build({
    stdin: { contents: "export {ProfileFaction} from './src/components/ProfileFaction'; export {state} from 'profile-state';", resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'profile-faction-hosts', setup(builder) {
      builder.onResolve({ filter: /^react$/ }, () => ({ path: pathToFileURL(require.resolve('react')).href, external: true }));
      builder.onResolve({ filter: /^(profile-state|react-native)$|\/(MultiplayerAccount|client|FactionPanel)$/ }, args => ({ path: args.path, namespace: 'host' }));
      builder.onLoad({ filter: /.*/, namespace: 'host' }, args => ({ contents:
        args.path === 'profile-state' ? 'export const state={account:null,session:null,fail:false};'
        : args.path === 'react-native' ? "export const Text='Text';"
        : args.path.endsWith('MultiplayerAccount') ? "import {state} from 'profile-state'; export const useAccountAccess=()=>state.account;"
        : args.path.endsWith('client') ? "import {state} from 'profile-state'; export const DEFAULT_GAME_SERVER='https://game.example'; export const restoreSession=async()=>{if(state.fail)throw Error('storage');return state.session;};"
        : "export const FactionPanel='FactionPanel';"
      }));
    } }],
  });
  const { ProfileFaction, state } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0]!.text).toString('base64')}`);
  let renderer: any;
  const mount = async () => { await act(async () => { renderer = create(React.createElement(ProfileFaction)); }); };
  const unmount = async () => { await act(async () => { renderer.unmount(); }); };
  await mount();
  assert.match(renderer.root.findByType('Text').props.children, /multiplayer uplink/);
  await unmount();
  state.session = { url: 'https://device.example', token: 'device-token' };
  await mount();
  assert.deepEqual(renderer.root.findByType('FactionPanel').props.session, state.session);
  await unmount();
  state.account = { accountId: 'account', getToken: async () => 'fresh-token' };
  await mount();
  const session = renderer.root.findByType('FactionPanel').props.session;
  assert.equal(session.accountId, 'account');
  assert.equal(session.url, 'https://game.example');
  assert.equal(session.token, '');
  assert.equal(await session.getToken(), 'fresh-token');
  await unmount();
  state.account = null;
  state.fail = true;
  await mount();
  assert.match(renderer.root.findByType('Text').props.children, /Could not restore/);
  await unmount();
});
