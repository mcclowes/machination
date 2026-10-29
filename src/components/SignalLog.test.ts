import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const React = require('react');
const { create, act } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const loaded = build({
  stdin: { contents: `export * from './src/components/SignalLog'; export {PlayerPortraits} from './src/components/PlayerIdentity';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.png': 'dataurl' },
  plugins: [{ name: 'native-hosts', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, a => ({ path: pathToFileURL(require.resolve(a.path)).href, external: true }));
    builder.onResolve({ filter: /^react-native(?:-svg)?$/ }, a => ({ path: a.path, namespace: 'host' }));
    builder.onLoad({ filter: /.*/, namespace: 'host' }, a => ({ contents: a.path === 'react-native' ? `export const View='View',Text='Text',Image='Image',StyleSheet={create:x=>x};` : `export default 'Svg'; export const Circle='Circle',Path='Path';` }));
  } }],
}).then(async result => import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0]!.text).toString('base64')}`));

test('system signals keep their text and timestamp alongside an illustration', async () => {
  const { SignalLog } = await loaded;
  const event = { hour: 0, message: 'Corporate uplink lost. Operational autonomy granted.' };
  let tree: any;
  await act(async () => { tree = create(React.createElement(SignalLog, { view: { hour: 0, winner: null, eliminated: [], events: [event] } })); });
  const images = tree.root.findAllByType('Image');
  assert.equal(images.length, 1);
  assert.ok(images[0].props.source);
  const text = tree.root.findAllByType('Text').map((node: any) => node.children.join(''));
  assert.ok(text.includes(event.message));
  assert.ok(text.includes('D01 · 00:00'));
  await act(async () => tree.unmount());
});

test('signals use contextual scenes and identify only players named in the visible text', async () => {
  const { signalArtwork, signalPlayers } = await loaded;
  const view = { rules: { players: ['you', 'vesper', 'null'] } };
  assert.equal(signalArtwork('Foundry: mine drilled for 50 drones.'), 'mining-world');
  assert.equal(signalArtwork('Foundry: opposing modules captured.'), 'techno-gothic-duel');
  assert.equal(signalArtwork('Haulers fought in transit; surviving modules returned or were captured.'), 'techno-gothic-duel');
  assert.equal(signalArtwork('Foundry: shields enabled.'), 'industrial-cockpit');
  assert.equal(signalArtwork('Self-destruct detonation destroyed 2 sites.'), 'exploding-planet');
  assert.equal(signalArtwork('1 Assassin recruited at the core.'), 'ritual-tech-clash');
  assert.deepEqual(signalPlayers(view, 'Mnemosyne: 30 drones dispatched to Vesper berth.'), ['you', 'vesper']);
  assert.deepEqual(signalPlayers(view, 'you began funding vesper.'), ['you', 'vesper']);
  assert.deepEqual(signalPlayers(view, 'null: core lost. Orders and extraction terminated.'), ['null']);
  assert.deepEqual(signalPlayers(view, 'Foundry acquired; opposing modules captured.'), []);
  assert.deepEqual(signalPlayers(view, 'Establish your orbit. Nullified transfer.'), []);
});

test('player signals show roster portraits and faction emblems while respecting the log limit', async () => {
  const { SignalLog, PlayerPortraits } = await loaded;
  const view = { hour: 6, winner: null, eliminated: [], events: [
    { hour: 6, message: 'you began funding vesper.' },
    { hour: 5, message: 'Earlier signal omitted.' },
  ] };
  let tree: any;
  await act(async () => { tree = create(React.createElement(PlayerPortraits.Provider, { value: ['wraith', 'courier'] }, React.createElement(SignalLog, { view, limit: 1 }))); });
  assert.equal(tree.root.findAllByType('Image').length, 3, 'one scene and two portraits');
  assert.equal(tree.root.findAllByType('Svg').length, 2, 'one faction emblem for each player');
  const text = tree.root.findAllByType('Text').map((node: any) => node.children.join(''));
  assert.ok(text.includes('Mnemosyne'));
  assert.ok(text.includes('Vesper'));
  assert.ok(!text.includes('Earlier signal omitted.'));
  const portraits = tree.root.findAllByType('Image').slice(1);
  assert.notEqual(portraits[0].props.style.left, portraits[1].props.style.left, 'selected roster cells are distinct');
  await act(async () => tree.unmount());
});
