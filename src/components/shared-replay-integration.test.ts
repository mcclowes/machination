import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import type { ReplayScene } from '../replay/presentation';
import type { SharedReplay } from '../replay/timeline';
const require = createRequire(import.meta.url);
const React = require('react');
const { create, act } = require('react-test-renderer');
type Node = { type: unknown; props: Record<string, any>; children: (Node | string)[]; findAll: (predicate: (node: Node) => boolean) => Node[] };
const text = (node: Node | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
function fixture(zero = false): SharedReplay {
  const scene = (hour: number, drones: number, known = true): ReplayScene => ({ hour, rocks: [
    { id: 'a', name: 'Alpha', x: 45, y: 45, known, kind: known ? 'core' : 'unknown', ...(known ? { owner: 'you' as const, drones, specialists: [{ id: 'u1', kind: 'queen' as const, owner: 'you' as const }] } : {}) },
    { id: 'b', name: 'Beta', x: 60, y: 55, known: false, kind: 'unknown' }],
    fleets: hour === 0 ? [{ id: 1, owner: 'you', from: 'a', to: 'b', drones: 2, departed: 0, arrives: 1 }] : [],
    coverage: [], cargo: {}, eliminated: [], winner: hour === 2 ? 'you' : null });
  return { kind: 'machination.observed-timeline', schemaVersion: 1, presentationVersion: 1, history: 'canonical-events', perspective: 'you', from: 0, through: zero ? 0 : 2,
    groups: zero ? [{ hour: 0, states: [scene(0, 1), scene(0, 2)] }] : [{ hour: 0, states: [scene(0, 1), scene(0, 2)] }, { hour: 1, states: [scene(1, 0, false)] }, { hour: 2, states: [scene(2, 9)] }],
    spans: zero ? [] : [{ from: 0, through: 1, scene: scene(0, 2) }, { from: 1, through: 2, scene: scene(1, 0, false) }] };
}
// Real React lifecycle with native hosts; no browser or device gesture claim.
test('shared replay import and viewer remain local, causal, bounded, and clean up playback', async () => {
  const key = '__sharedReplayIntegration';
  const globals = globalThis as typeof globalThis & Record<string, any>;
  let picked: string | null | Error = null, picks = 0, forbidden = 0, now = 1000, timer: (() => void) | undefined, starts = 0;
  globals[key] = { pick: async () => { picks++; if (picked instanceof Error) throw picked; return picked; }, forbidden: () => { forbidden++; throw new Error('Live boundary reached'); } };
  const priorAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  const originals = { interval: globalThis.setInterval, clear: globalThis.clearInterval, fetch: globalThis.fetch, now: Date.now };
  let renderer: any;
  try {
    const output = await build({ entryPoints: [new URL('./ReplayLibraryScreen.tsx', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.png': 'dataurl' }, plugins: [{ name: 'replay-hosts', setup(builder) {
      builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
      builder.onResolve({ filter: /replay\/files$/ }, () => ({ path: 'files', namespace: 'hosts' }));
      builder.onResolve({ filter: /^(react-native|react-native-svg|expo-clipboard|@react-native-async-storage\/async-storage)$/ }, args => ({ path: args.path, namespace: 'hosts' }));
      builder.onResolve({ filter: /(?:\/hooks\/|\/online\/|\/storage$|\/Operation$)/ }, () => ({ path: 'forbidden', namespace: 'hosts' }));
      builder.onLoad({ filter: /.*/, namespace: 'hosts' }, args => ({ contents: args.path === 'files' ? `export const pickSharedReplay=()=>globalThis.${key}.pick();` : args.path === 'react-native' ? `export const View='View',Text='Text',Image='Image',Pressable='Pressable',ScrollView='ScrollView',TextInput='TextInput'; export const StyleSheet={create:x=>x}; export const PanResponder={create:x=>({panHandlers:x})};` : args.path === 'react-native-svg' ? `export default 'Svg'; export const Circle='Circle',Ellipse='Ellipse',G='G',Line='Line',Path='Path',Text='SvgText';` : args.path === 'expo-clipboard' ? `export const setStringAsync=()=>globalThis.${key}.forbidden();` : `export default globalThis.${key}.forbidden();` }));
    } }] });
    const { ReplayLibraryScreen } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`);
    globalThis.fetch = globals[key].forbidden;
    Date.now = () => now;
    globalThis.setInterval = ((callback: () => void) => { starts++; timer = callback; return 1; }) as any;
    globalThis.clearInterval = (() => { timer = undefined; }) as any;
    const flush = async (fn: () => void) => { await act(async () => { fn(); await Promise.resolve(); }); };
    const hosts = (type: string): Node[] => renderer.root.findAll((node: Node) => node.type === type);
    const button = (label: string) => hosts('Pressable').find(node => node.props.accessibilityLabel === label)!;
    const press = async (label: string) => { const node = button(label); assert.ok(node, label); assert.ok(!node.props.disabled, label); await flush(() => node.props.onPress()); };
    const visible = () => text(renderer.root);
    await flush(() => { renderer = create(React.createElement(ReplayLibraryScreen, { onExit() {} })); });
    assert.equal(picks, 0); assert.equal(starts, 0);
    picked = JSON.stringify(fixture()); await press('Open replay');
    assert.match(visible(), /Hour 2\.000/); assert.match(visible(), /Winner/); assert.equal(starts, 0);
    await press('Beginning'); assert.match(visible(), /State 1 of 2/);
    await press(hosts('Pressable').find(node => node.props.accessibilityLabel?.startsWith('Beta,'))!.props.accessibilityLabel); assert.match(visible(), /Outside recorded sensor coverage/);
    assert.doesNotMatch(visible(), /Shield undefined|undefined drones/);
    await press('Close site details');
    await press('Next state'); assert.match(visible(), /State 2 of 2/);
    await press('Previous state'); assert.match(visible(), /State 1 of 2/);
    await press('Alpha, core, Mnemosyne, 1 drones, Intelligence core'); assert.match(visible(), /Specialist owner/);
    await press('Next state'); await press('Next state'); assert.doesNotMatch(visible(), /Close site details/);
    await press('Beginning');
    const fleet = hosts('Pressable').find(node => /hauler,/.test(node.props.accessibilityLabel ?? ''))!;
    await flush(() => fleet.props.onPress()); assert.ok(button('Close hauler details'));
    await press('Jump to hauler arrival'); assert.match(visible(), /Hour 1\.000/); assert.equal(button('Close hauler details'), undefined);
    const input = hosts('TextInput')[0]!;
    await flush(() => input.props.onChangeText('999')); await press('Seek hour'); assert.match(visible(), /Hour 2\.000/);
    await flush(() => input.props.onChangeText('NaN')); await press('Seek hour'); assert.match(visible(), /Hour 2\.000/);
    await press('Beginning');
    const timeline = hosts('View').find(node => node.props.accessibilityLabel === 'Replay timeline')!;
    await flush(() => timeline.props.onLayout({ nativeEvent: { layout: { width: 200 } } }));
    await flush(() => timeline.props.onResponderGrant({ nativeEvent: { locationX: 100 } })); assert.match(visible(), /Hour 1\.000/);
    await flush(() => timeline.props.onResponderMove({ nativeEvent: { locationX: -50 } })); assert.match(visible(), /State 2 of 2/);
    await flush(() => timeline.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } })); assert.match(visible(), /State 1 of 2/);
    await press('4×'); await press('1×');
    await press('Play'); assert.equal(starts, 1);
    now = Infinity; await flush(() => timer!()); assert.match(visible(), /Hour 0\.000/);
    now = 2000; await flush(() => timer!()); assert.match(visible(), /Hour 0\.000/);
    now = 3000; await flush(() => timer!()); assert.match(visible(), /Hour 1\.000/);
    now = 4000; await flush(() => timer!()); assert.match(visible(), /Hour 2\.000/); assert.equal(timer, undefined);
    await press('Exit replay');
    picked = null; await press('Open replay'); assert.ok(button('View imported replay'));
    picked = new Error('secret file:///private/path'); await press('Open replay'); assert.match(visible(), /not a supported/); assert.doesNotMatch(visible(), /private\/path/);
    picked = '{bad'; await press('Open replay'); assert.ok(button('View imported replay'));
    await press('View imported replay'); await press('Beginning'); await press('Play');
    await flush(() => renderer.unmount()); renderer = undefined; assert.equal(timer, undefined);
    picked = JSON.stringify(fixture(true));
    await flush(() => { renderer = create(React.createElement(ReplayLibraryScreen, { onExit() {} })); });
    await press('Open replay'); assert.match(visible(), /State 2 of 2/); assert.ok(button('Play').props.disabled);
    await press('Previous state'); await press('Next state'); assert.match(visible(), /State 2 of 2/);
    assert.equal(forbidden, 0);
    await press('Exit replay');
    const beyond = fixture();
    for (const state of beyond.groups[0]!.states) state.fleets[0]!.arrives = 8;
    beyond.spans[0]!.scene.fleets[0]!.arrives = 8;
    picked = JSON.stringify(beyond); await press('Open replay'); await press('Beginning');
    await flush(() => hosts('Pressable').find(node => /hauler,/.test(node.props.accessibilityLabel ?? ''))!.props.onPress());
    assert.equal(button('Jump to hauler arrival'), undefined);
    await press('Next state');
    assert.equal(button('Close hauler details'), undefined);
    assert.equal(forbidden, 0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    globalThis.setInterval = originals.interval; globalThis.clearInterval = originals.clear; globalThis.fetch = originals.fetch; Date.now = originals.now;
    delete globals[key];
    if (priorAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', priorAct); else delete globals.IS_REACT_ACT_ENVIRONMENT;
  }
});
