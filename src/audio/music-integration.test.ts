import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { build } from 'esbuild';
import type { MusicView } from './music-tension';
import type { CueView } from './sound-cues';

const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
const { create, act } = require('react-test-renderer');

test('live music respects mute, foreground, view removal, and unmount with the real hooks', async () => {
  const key = `__musicIntegration_${randomUUID().replaceAll('-', '')}`;
  const globals = globalThis as typeof globalThis & Record<string, any>;
  const priorAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  const players: { source: string; loop: boolean; volume: number; plays: number; removed: boolean }[] = [];
  const callbacks = new Set<(state: string) => void>();
  const writes: string[][] = [];
  const appState = { currentState: 'active', addEventListener(_event: string, callback: (state: string) => void) {
    callbacks.add(callback); return { remove() { callbacks.delete(callback); } };
  } };
  globals[key] = {
    appState,
    storage: { getItem: async () => 'on', setItem: async (...args: string[]) => { writes.push(args); } },
    createPlayer(source: string) {
      const player = { source, loop: false, volume: 1, plays: 0, removed: false, play() { this.plays++; }, remove() { this.removed = true; } };
      players.push(player); return player;
    },
  };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer: any;
  try {
    const output = await build({ entryPoints: [new URL('./sound.ts', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'music-native-hosts', setup(builder) {
      builder.onResolve({ filter: /^react$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
      builder.onResolve({ filter: /^(expo-audio|react-native|@react-native-async-storage\/async-storage)$/ }, args => ({ path: args.path, namespace: 'music-host' }));
      builder.onLoad({ filter: /.*/, namespace: 'music-host' }, args => ({ contents: args.path === 'expo-audio' ? `export const createAudioPlayer=globalThis[${JSON.stringify(key)}].createPlayer;` : args.path === 'react-native' ? `export const AppState=globalThis[${JSON.stringify(key)}].appState;` : `export default globalThis[${JSON.stringify(key)}].storage;` }));
      builder.onLoad({ filter: /\.(mp3|wav)$/ }, args => ({ contents: `module.exports = ${JSON.stringify(args.path)};` }));
    } }] });
    const sound = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`);
    function Operation({ view }: { view?: MusicView & CueView }) { sound.useSoundCues(view, 'you'); return null; }
    const view: MusicView & CueView = { epoch: 1, hour: 10, rocks: [{ id: 'a', x: 0, y: 0, owner: 'you', known: true }], fleets: [], events: [], scheduled: [], eliminated: [], winner: null };
    const render = (current?: MusicView & CueView) => React.createElement(Operation, { view: current });
    const flush = async (work: () => void) => { await act(async () => { work(); }); };
    await flush(() => { renderer = create(render()); });
    assert.equal(players.length, 0); assert.equal(callbacks.size, 0, 'no operation means no music lifecycle');
    await flush(() => renderer.update(render(view)));
    assert.match(players[0]!.source, /space-ambient\.mp3$/); assert.equal(players[0]!.loop, true); assert.equal(players[0]!.plays, 1);
    await flush(() => renderer.update(render({ ...view })));
    assert.equal(players.length, 1, 'polling does not restart the track');
    await flush(() => sound.setSoundEnabled(false));
    assert.ok(players.every(p => p.removed));
    await flush(() => sound.setSoundEnabled(true));
    assert.equal(players.length, 2);
    const state = (next: string) => { appState.currentState = next; callbacks.forEach(callback => callback(next)); };
    await flush(() => state('background'));
    assert.ok(players.every(p => p.removed));
    await flush(() => state('active'));
    assert.equal(players.length, 3);
    const threatened = { ...view, rocks: [...view.rocks, { id: 'b', x: 80, y: 0, owner: 'vesper' as const }], fleets: [{ id: 1, owner: 'vesper' as const, from: 'b', to: 'a', drones: 5, departed: 8, arrives: 10.5 }] };
    // A fresh epoch avoids generating sound effects in this music-only host.
    await flush(() => renderer.update(render({ ...threatened, epoch: 2 })));
    assert.match(players.at(-1)!.source, /rising-dread\.mp3$/);
    await flush(() => renderer.update(render()));
    assert.ok(players.every(p => p.removed)); assert.equal(callbacks.size, 0);
    await flush(() => renderer.update(render(view)));
    await flush(() => renderer.unmount()); renderer = null;
    assert.ok(players.every(p => p.removed)); assert.equal(callbacks.size, 0);
    assert.deepEqual(writes, [['machination.sound.v1', 'off'], ['machination.sound.v1', 'on']]);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    delete globals[key];
    if (priorAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', priorAct);
    else delete globals.IS_REACT_ACT_ENVIRONMENT;
  }
});
