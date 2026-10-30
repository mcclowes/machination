import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createTrainingAttempt } from '../game/training';
import { applyCommand, createArchive } from '../game/replay';
import { encodeOperation } from '../game/operation-save';
import { advance } from '../game/simulation';
import { OPERATION_MOTION_NATIVE, OPERATION_MOTION_PREFERENCE } from '../test-support/operation-motion-host';

const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
const { create, act } = require('react-test-renderer');
type Node = { type: unknown; props: Record<string, any>; children: (Node | string)[]; findAll: (predicate: (node: Node) => boolean) => Node[] };
const text = (node: Node | string): string => typeof node === 'string' ? node : node.children.map(text).join('');

// Real operation and scheduler; native hosts and storage are isolated from user state.
test('solo schedules a follow-on attack from a site captured only in the forecast', async t => {
  const key = `__launchIntegration_${randomUUID().replaceAll('-', '')}`;
  const globals = globalThis as typeof globalThis & Record<string, any>;
  const priorAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  const initial = createTrainingAttempt('first-launch');
  const incoming = applyCommand(initial.archive, { type: 'dispatch', owner: 'you', from: 'works', to: 'relay', drones: 24 }, { rivals: false, knownThrough: 0 });
  assert.equal(incoming.game.rocks.find(r => r.id === 'relay')!.owner, null);
  Object.assign(incoming.game.rocks.find(r => r.id === 'rival-home')!, { x: 23, y: 18 });
  const now = 1_800_000_000_000;
  const bytes = new Map<string, string>([['machination.game.v1', encodeOperation({ game: incoming.game, archive: createArchive(incoming.game, { rivals: true }) }, now)], ['machination.briefing.v1', '1']]);
  globals[key] = {
    storage: { getItem: async (name: string) => bytes.get(name) ?? null, setItem: async (name: string, value: string) => { bytes.set(name, value); } },
    subscribe: () => ({ remove() {} }),
    online: () => { throw new Error('Unexpected online mount'); },
    replayFile: () => { throw new Error('Unexpected replay file access'); },
  };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', () => ({}) as ReturnType<typeof setInterval>);
  t.mock.method(globalThis, 'clearInterval', () => {});
  let renderer: any;
  try {
    const output = await build({
      entryPoints: [new URL('../../App.tsx', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.png': 'dataurl' },
      plugins: [{ name: 'launch-native-hosts', setup(builder) {
        builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
        builder.onResolve({ filter: /\/SpaceBackground$/ }, () => ({ path: 'sky', namespace: 'launch-sky' }));
        builder.onResolve({ filter: /use-ambient-motion$/ }, () => ({ path: 'motion', namespace: 'launch-host' }));
        builder.onLoad({ filter: /.*/, namespace: 'launch-sky' }, () => ({ contents: 'export const SpaceBackground=()=>null;' }));
        const stubs: Record<string, string> = {
          motion: OPERATION_MOTION_PREFERENCE,
          'react-native': `import React from 'react';
            export const View='View',Text='Text',Image='Image',Pressable='Pressable',ScrollView='ScrollView',TextInput='TextInput',KeyboardAvoidingView='KeyboardAvoidingView';
            export const Modal=({visible,children,...props})=>visible?React.createElement('Modal',props,children):null;
            export const StyleSheet={create:x=>x,absoluteFillObject:{},hairlineWidth:1},Platform={OS:'web',select:x=>x.web??x.default};
            export const useWindowDimensions=()=>({width:1200,height:800,scale:1,fontScale:1});
            export const Dimensions={get:()=>({width:1200,height:800})},PanResponder={create:x=>({panHandlers:x})};
            export const AppState={currentState:'active',addEventListener:(name)=>globalThis[${JSON.stringify(key)}].subscribe(name)},Keyboard={dismiss(){},addListener:name=>globalThis[${JSON.stringify(key)}].subscribe(name)};
            ${OPERATION_MOTION_NATIVE}`,
          'react-native-safe-area-context': `export const SafeAreaProvider='SafeAreaProvider',SafeAreaView='SafeAreaView';`,
          'expo-status-bar': `export const StatusBar='StatusBar';`,
          'expo-crypto': `export const randomUUID=()=> 'launch-host-uuid';`,
          'expo-clipboard': `export const setStringAsync=async()=>true;`,
          '@react-native-async-storage/async-storage': `export default globalThis[${JSON.stringify(key)}].storage;`,
          'react-native-svg': `export default 'Svg'; export const Circle='Circle',Ellipse='Ellipse',G='G',Line='Line',Path='Path',Text='SvgText',Defs='Defs',LinearGradient='LinearGradient',RadialGradient='RadialGradient',Rect='Rect',Stop='Stop';`,
        };
        builder.onResolve({ filter: /OnlineOperation$/ }, () => ({ path: 'online-boundary', namespace: 'launch-host' }));
        builder.onResolve({ filter: /notification-wiring$/ }, () => ({ path: 'notification-boundary', namespace: 'launch-host' }));
        builder.onResolve({ filter: /\/audio\/sound$/ }, () => ({ path: 'silent-audio', namespace: 'launch-host' }));
        builder.onResolve({ filter: /replay\/files$/ }, () => ({ path: 'replay-files', namespace: 'launch-host' }));
        builder.onResolve({ filter: /^(react-native(?:-svg|-safe-area-context)?|expo-status-bar|expo-crypto|expo-clipboard|@react-native-async-storage\/async-storage)$/ }, args => ({ path: args.path, namespace: 'launch-host' }));
        builder.onLoad({ filter: /.*/, namespace: 'launch-host' }, args => ({ contents: args.path === 'silent-audio' ? `export const playSound=()=>{},useSoundCues=()=>{},useSoundEnabled=()=>false,setSoundEnabled=()=>{};` : args.path === 'online-boundary' ? `export const OnlineOperation=()=>globalThis[${JSON.stringify(key)}].online();` : args.path === 'notification-boundary' ? `export const launchDeps=undefined;` : args.path === 'replay-files' ? `export const pickSharedReplay=()=>globalThis[${JSON.stringify(key)}].replayFile(),saveSharedReplay=()=>globalThis[${JSON.stringify(key)}].replayFile();` : stubs[args.path]! }));
      } }],
    });
    const { default: App } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`);
    const flush = async (action: () => void) => { await act(async () => { action(); await Promise.resolve(); }); };
    const hosts = (type: string) => renderer.root.findAll((node: Node) => node.type === type) as Node[];
    const button = (label: string | RegExp) => {
      const node = hosts('Pressable').find(node => typeof label === 'string' ? (node.props.accessibilityLabel ?? text(node)) === label : label.test(node.props.accessibilityLabel ?? text(node)));
      assert.ok(node, `Missing control: ${label}`);
      return node;
    };
    const press = async (label: string | RegExp) => {
      const node = button(label);
      assert.ok(!node.props.disabled, `Disabled control: ${label}`);
      await flush(() => node.props.onPress());
    };
    const input = async (label: string, value: string) => {
      const node = hosts('TextInput').find(node => node.props.accessibilityLabel === label);
      assert.ok(node, `Missing input: ${label}`);
      await flush(() => node.props.onChangeText(value));
    };
    await flush(() => { renderer = create(React.createElement(App)); });
    await press('Open solo operation');
    await press('Time Machine');
    await input('Go to hours from now', '2');
    await press('Inspect');
    await press(/^Quiet landing,/);
    assert.match(text(button(/^Quiet landing,/)), /20/);
    await input('Drones to dispatch', '20');
    await press('Plan transfer at this time ↗');
    await press(/^Distant anchor,/);
    await input('Drones to dispatch', '0');
    assert.equal(button('Schedule at D01 · 02:00').props.disabled, true);
    assert.match(text(renderer.root), /Send at least one drone or select a specialist/);
    await input('Drones to dispatch', '20');
    assert.doesNotMatch(text(renderer.root), /Send at least one drone or select a specialist/);
    await press('Schedule at D01 · 02:00');
    const saved = JSON.parse(bytes.get('machination.game.v1')!);
    const plan = saved.game.scheduled.find((p: any) => p.from === 'relay');
    assert.ok(plan, 'The bottom button queues the follow-on launch');
    assert.deepEqual([plan.to, plan.drones, plan.executeAt], ['rival-home', 20, 2]);
    assert.equal(saved.game.rocks.find((r: any) => r.id === 'relay').owner, null, 'Scheduling leaves live ownership unchanged');
    const executed = advance(saved.game, 2.01, { rivals: false });
    assert.ok(executed.fleets.some(f => f.from === 'relay' && f.to === 'rival-home' && f.drones === 20), 'The queued attack executes after the capture');
    const failedCapture = advance({ ...saved.game, fleets: [] }, 2.01, { rivals: false });
    assert.equal(failedCapture.fleets.some(f => f.from === 'relay'), false, 'The launch still aborts if the source is not captured');
    const queuedOrder = 'Inspect scheduled order: Quiet landing → Distant anchor';
    await press('Now');
    await press(queuedOrder);
    assert.ok(hosts('TextInput').some(node => node.props.accessibilityLabel === 'Scheduled launch drones'), 'selecting a tray order reveals its editor after changing from live to forecast');
    assert.match(text(renderer.root), /Forecast · D01 · 02:00/);
    await press('Orders');
    assert.equal(hosts('Pressable').filter(node => node.props.accessibilityLabel === queuedOrder).length, 1, 'the queue has one home in the time tray');
    assert.match(text(renderer.root), /Quiet landing → Distant anchor/);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    delete globals[key];
    if (priorAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', priorAct);
    else delete globals.IS_REACT_ACT_ENVIRONMENT;
  }
});
