/** @format */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const React = require('react');
const { create, act } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

test('multiplayer entry opens each task directly and preserves drafts while busy guards prevent task changes', async () => {
  const output = await build({
    stdin: {
      contents: "export { OnlineEntry } from './src/online/OnlineEntry';",
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'entry-hosts',
        setup(b) {
          b.onResolve({ filter: /^react(?:\/.*)?$/ }, (a) => ({
            path: pathToFileURL(require.resolve(a.path)).href,
            external: true,
          }));
          b.onResolve({ filter: /^react-native$|\/components\/Pressable$/ }, (a) => ({
            path: a.path,
            namespace: 'entry-host',
          }));
          b.onLoad({ filter: /.*/, namespace: 'entry-host' }, (a) => ({
            contents:
              a.path === 'react-native'
                ? "export const View='View',Text='Text',StyleSheet={create:x=>x};"
                : "export const Pressable='Pressable';",
          }));
        },
      },
    ],
  });
  const { OnlineEntry } = await import(
    `data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`
  );
  let tree: any,
    busy = false;
  function Form() {
    const [invite, setInvite] = React.useState('');
    const [recovery, setRecovery] = React.useState('');
    const [players, setPlayers] = React.useState('3');
    const field = (label: string, value: string, onChangeText: (value: string) => void) =>
      React.createElement('TextInput', { accessibilityLabel: label, value, onChangeText });
    return React.createElement(OnlineEntry, {
      disabled: busy,
      server: field('Server', 'fixture', () => {}),
      create: field('Player count', players, setPlayers),
      join: field('Invitation code', invite, setInvite),
      restore: field('Recovery code', recovery, setRecovery),
    });
  }
  const field = (name: string) =>
    tree.root
      .findAllByType('TextInput')
      .find((node: any) => node.props.accessibilityLabel === name);
  const button = (name: string) =>
    tree.root
      .findAllByType('Pressable')
      .find((node: any) => node.props.accessibilityLabel === name);
  const choose = async (name: string) => act(async () => button(name).props.onPress());
  try {
    await act(async () => {
      tree = create(React.createElement(Form));
    });
    assert.ok(field('Player count'));
    assert.equal(field('Recovery code'), undefined);
    assert.equal(field('Invitation code'), undefined);
    await act(async () => field('Player count').props.onChangeText('10'));
    await choose('Join an operation');
    assert.equal(field('Player count'), undefined);
    await act(async () => field('Invitation code').props.onChangeText('invitation-draft'));
    await choose('Restore a seat');
    assert.equal(field('Invitation code'), undefined);
    assert.ok(field('Server'));
    await act(async () => field('Recovery code').props.onChangeText('synthetic-recovery'));
    await choose('Join an operation');
    assert.equal(field('Invitation code').props.value, 'invitation-draft');
    await choose('Create an operation');
    assert.equal(field('Player count').props.value, '10');
    await choose('Restore a seat');
    assert.equal(field('Recovery code').props.value, 'synthetic-recovery');
    assert.equal(button('Restore a seat').props.accessibilityState.selected, true);
    busy = true;
    await act(async () => tree.update(React.createElement(Form)));
    assert.ok(tree.root.findAllByType('Pressable').every((node: any) => node.props.disabled));
    await choose('Create an operation');
    assert.ok(field('Recovery code'));
  } finally {
    if (tree) await act(async () => tree.unmount());
  }
});
