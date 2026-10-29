import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
// Renderer has no installed TS declarations; hooks still come from the real React instance.
const { create, act } = require('react-test-renderer');
type Node = { type: unknown; props: Record<string, any>; children: (Node | string)[]; findAll: (predicate: (node: Node) => boolean) => Node[] };
const text = (node: Node | string): string => typeof node === 'string' ? node : node.children.map(text).join('');

// Host-stub integration evidence only: this does not establish native/browser layout or gesture acceptance.
test('App practice isolates live lifecycles and awards only actual capture, with a clean retry', async () => {
  const key = `__practiceIntegration_${randomUUID().replaceAll('-', '')}`;
  const globals = globalThis as typeof globalThis & Record<string, any>;
  const priorAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  const soloKey = 'machination.game.v1', onlineKey = 'machination.online.v1', progressKey = 'machination.training-progress.v1';
  const seeded = [[soloKey, 'recognizable solo archive bytes'], [onlineKey, 'recognizable online credentials bytes']] as const;
  const bytes = new Map<string, string>([...seeded, ['machination.briefing.v1', '1']]);
  const reads: string[] = [], writes: string[] = [], subscriptions: string[] = [];
  let mounts = 0, network = 0, intervals = 0, now = 1_800_000_000_000;
  globals[key] = {
    storage: { getItem: async (name: string) => { reads.push(name); return bytes.get(name) ?? null; }, setItem: async (name: string, value: string) => { writes.push(name); bytes.set(name, value); } },
    subscribe: (name: string) => { subscriptions.push(name); return { remove() {} }; },
    online: () => { mounts++; throw new Error('Online boundary mounted during practice'); },
    replayFile: () => { throw new Error('Replay file boundary reached before an explicit action'); },
  };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  const originalNow = Date.now, originalInterval = globalThis.setInterval, originalFetch = globalThis.fetch;
  let renderer: any;
  try {
    const output = await build({
      entryPoints: [new URL('../../App.tsx', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.png': 'dataurl' },
      plugins: [{ name: 'practice-native-hosts', setup(builder) {
        builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
        const stubs: Record<string, string> = {
          'react-native': `import React from 'react';
            export const View='View',Text='Text',Image='Image',Pressable='Pressable',ScrollView='ScrollView',TextInput='TextInput',KeyboardAvoidingView='KeyboardAvoidingView';
            export const Modal=({visible,children,...props})=>visible?React.createElement('Modal',props,children):null;
            export const StyleSheet={create:x=>x,absoluteFillObject:{},hairlineWidth:1},Platform={OS:'web',select:x=>x.web??x.default};
            export const useWindowDimensions=()=>({width:1200,height:800,scale:1,fontScale:1});
            export const Dimensions={get:()=>({width:1200,height:800})},PanResponder={create:x=>({panHandlers:x})};
            export const AppState={currentState:'active',addEventListener:(name)=>globalThis[${JSON.stringify(key)}].subscribe(name)},Keyboard={dismiss(){},addListener:name=>globalThis[${JSON.stringify(key)}].subscribe(name)};`,
          'react-native-safe-area-context': `export const SafeAreaProvider='SafeAreaProvider',SafeAreaView='SafeAreaView';`,
          'expo-status-bar': `export const StatusBar='StatusBar';`,
          'expo-crypto': `export const randomUUID=()=> 'practice-host-uuid';`,
          'expo-clipboard': `export const setStringAsync=async()=>true;`,
          '@react-native-async-storage/async-storage': `export default globalThis[${JSON.stringify(key)}].storage;`,
          'react-native-svg': `export default 'Svg'; export const Circle='Circle',Ellipse='Ellipse',G='G',Line='Line',Path='Path',Text='SvgText';`,
        };
        builder.onResolve({ filter: /OnlineOperation$/ }, () => ({ path: 'online-boundary', namespace: 'practice-host' }));
        builder.onResolve({ filter: /\/audio\/sound$/ }, () => ({ path: 'silent-audio', namespace: 'practice-host' }));
        builder.onResolve({ filter: /replay\/files$/ }, () => ({ path: 'replay-files', namespace: 'practice-host' }));
        builder.onResolve({ filter: /^(react-native(?:-svg|-safe-area-context)?|expo-status-bar|expo-crypto|expo-clipboard|@react-native-async-storage\/async-storage)$/ }, args => ({ path: args.path, namespace: 'practice-host' }));
        builder.onLoad({ filter: /.*/, namespace: 'practice-host' }, args => ({ contents: args.path === 'silent-audio' ? `export const playSound=()=>{},useSoundCues=()=>{},useSoundEnabled=()=>false,setSoundEnabled=()=>{};` : args.path === 'online-boundary' ? `export const OnlineOperation=()=>globalThis[${JSON.stringify(key)}].online();` : args.path === 'replay-files' ? `export const pickSharedReplay=()=>globalThis[${JSON.stringify(key)}].replayFile(),saveSharedReplay=()=>globalThis[${JSON.stringify(key)}].replayFile();` : stubs[args.path]! }));
      } }],
    });
    const { default: App } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`);
    Date.now = () => now;
    globalThis.setInterval = ((..._args: unknown[]) => { intervals++; throw new Error('Practice started a live interval'); }) as typeof setInterval;
    globalThis.fetch = (async () => { network++; throw new Error('Practice made a network request'); }) as typeof fetch;
    const flush = async (action: () => void) => { await act(async () => { action(); await Promise.resolve(); }); };
    const hosts = (type: string) => renderer.root.findAll((node: Node) => node.type === type) as Node[];
    const press = async (label: string | RegExp) => {
      const matches = hosts('Pressable').filter(node => typeof label === 'string' ? (node.props.accessibilityLabel ?? text(node)) === label : label.test(node.props.accessibilityLabel ?? text(node)));
      assert.ok(matches.length, `Missing control: ${label}`);
      assert.ok(!matches[0]!.props.disabled, `Disabled control: ${label}`);
      await flush(() => matches[0]!.props.onPress());
    };
    const input = async (label: string, value: string) => {
      const node = hosts('TextInput').find(node => node.props.accessibilityLabel === label);
      assert.ok(node, `Missing input: ${label}`);
      await flush(() => node.props.onChangeText(value));
    };
    const visible = () => text(renderer.root);
    const mapSite = (name: string) => hosts('Pressable').find(node => node.props.accessibilityLabel?.startsWith(`${name},`))!;
    const quiet = () => {
      assert.equal(mounts, 0); assert.equal(network, 0); assert.equal(intervals, 0); assert.deepEqual(subscriptions, []);
      assert.ok(reads.every(name => name === progressKey || name === 'machination.briefing.v1'), `Unexpected reads: ${reads}`);
      assert.ok(writes.every(name => name === progressKey), `Unexpected writes: ${writes}`);
      for (const [name, value] of seeded) assert.equal(bytes.get(name), value);
    };
    await flush(() => { renderer = create(React.createElement(App)); });
    assert.match(visible(), /Machination/); assert.deepEqual(reads, ['machination.briefing.v1']); assert.deepEqual(writes, []);
    assert.equal(hosts('Pressable').some(node => node.props.accessibilityLabel?.startsWith('Foundry,')), false);
    quiet();
    await press('Open shared replay');
    assert.match(visible(), /Shared replays/); quiet();
    await press('Exit replay library');
    await press('Practice');
    await press('Start: Open a foothold');
    assert.match(visible(), /Welcome to the quiet belt, Captain/);
    assert.equal(hosts('Modal').length, 1);
    await press('Continue dialogue');
    assert.match(visible(), /Another captain hiding behind the admiral/);
    await press('Continue dialogue');
    await press('Take command');
    assert.equal(hosts('Modal').length, 0);
    await press('Replay briefing');
    assert.match(visible(), /Welcome to the quiet belt, Captain/);
    await press('Skip dialogue');
    assert.equal(hosts('Modal').length, 0);
    assert.match(visible(), /Launch drones from Foundry/);
    assert.equal(hosts('Pressable').find(node => text(node) === 'Resolve orders')?.props.disabled, true, 'An empty plan cannot resolve an exercise');
    assert.match(mapSite('Quiet landing').props.accessibilityLabel, /unclaimed, 4 drones/);
    await press(/^Quiet landing,/);
    await press('Units');
    assert.match(visible(), /Next recruitment:/, 'global recruitment remains available while a non-owned site is selected');
    await press('Inspect site Core berth');
    assert.match(visible(), /Core berth/);
    assert.equal(hosts('TextInput').find(node => node.props.accessibilityLabel === 'Drones to dispatch')!.props.value, '0');
    quiet();
    await press('Chart');
    await press(/^Foundry,/);
    await input('Drones to dispatch', '6');
    await press('Plan transfer ↗');
    await press(/^Quiet landing,/);
    await press('Prepare launch · 10m');
    await press(/hauler, preparing launch, 6 drones/);
    await press('Jump to hauler arrival');
    assert.match(visible(), /Forecast/);
    assert.match(mapSite('Quiet landing').props.accessibilityLabel, /Mnemosyne, 2 drones/);
    assert.doesNotMatch(visible(), /Exercise complete/);
    assert.equal(hosts('Modal').length, 0, 'Forecasts never trigger a live-progress transmission');
    assert.equal(bytes.has(progressKey), false); assert.deepEqual(writes, []);
    now += 72 * 3_600_000;
    await flush(() => {});
    assert.doesNotMatch(visible(), /Exercise complete/); quiet();
    await press('Now');
    assert.match(mapSite('Quiet landing').props.accessibilityLabel, /unclaimed, 4 drones/);
    await press('Advance +15m');
    assert.match(visible(), /The clock is running, Captain/);
    await press('Return to chart');
    assert.equal(hosts('Modal').length, 0);
    assert.doesNotMatch(visible(), /Exercise complete/);
    assert.equal(bytes.has(progressKey), false);
    for (let i = 0; i < 5 && !visible().includes('Exercise complete'); i++) await press('Advance +1h');
    assert.match(visible(), /Exercise complete/);
    assert.match(visible(), /A deserted rock and you call it a victory/);
    await press('Continue dialogue');
    assert.match(visible(), /Foothold secured/);
    await press('Return to chart');
    assert.match(mapSite('Quiet landing').props.accessibilityLabel, /Mnemosyne, 2 drones/);
    assert.deepEqual(JSON.parse(bytes.get(progressKey)!), { version: 1, contentVersion: 1, completed: ['first-launch'] });
    assert.deepEqual(writes, [progressKey]);
    const completedBytes = bytes.get(progressKey);
    await press('Time Machine');
    await press('History start');
    assert.match(visible(), /History · D01 · 00:00/);
    await press('Units');
    const historicalHires = hosts('Pressable').filter(node => /^Hire /.test(node.props.accessibilityLabel ?? ''));
    assert.ok(historicalHires.length > 0 && historicalHires.every(node => node.props.disabled));
    await press('Inspect site Core berth');
    assert.match(visible(), /History · D01 · 00:00/, 'roster navigation preserves the inspected historical frame');
    await press(/^Foundry,/);
    const historicalTransfer = hosts('Pressable').find(node => text(node) === 'Plan transfer ↗');
    assert.ok(historicalTransfer?.props.disabled, 'Historical dispatch must be disabled');
    const historicalChart = hosts('View').find(node => node.props.testID === 'belt-map')!;
    const historicalSite = mapSite('Foundry').props.style[1];
    historicalChart.props.onStartShouldSetPanResponderCapture({ nativeEvent: { touches: [{ pageX: parseFloat(historicalSite.left) * 4, pageY: parseFloat(historicalSite.top) * 4.8 }] } });
    assert.equal(historicalChart.props.onMoveShouldSetPanResponderCapture({ nativeEvent: { touches: [{}] } }, { x0: 200, y0: 240, dx: 100, dy: 100 }), false, 'Historical maps never start transfer gestures');
    await press('Retry exercise');
    assert.match(visible(), /Welcome to the quiet belt, Captain/, 'Retry resets briefing playback');
    await press('Skip dialogue');
    assert.match(visible(), /Live · D01 · 00:00/);
    assert.doesNotMatch(visible(), /Exercise complete|Forecast/);
    assert.match(mapSite('Quiet landing').props.accessibilityLabel, /unclaimed, 4 drones/);
    assert.match(mapSite('Foundry').props.accessibilityLabel, /30 drones/);
    assert.equal(hosts('Pressable').some(node => /hauler,/.test(node.props.accessibilityLabel ?? '')), false);
    assert.equal(hosts('TextInput').some(node => node.props.accessibilityLabel === 'Drones to dispatch'), false, 'Retry closes the manifest drawer');
    await press(/^Foundry,/);
    assert.equal(hosts('TextInput').find(node => node.props.accessibilityLabel === 'Drones to dispatch')!.props.value, '15');
    assert.equal(bytes.get(progressKey), completedBytes);
    await press('Close Foundry');
    const chart = hosts('View').find(node => node.props.testID === 'belt-map')!;
    assert.ok(chart, 'The map exposes the real gesture surface');
    const point = (name: string) => {
      const style = mapSite(name).props.style[1];
      return { x: parseFloat(style.left) * 4, y: parseFloat(style.top) * 4.8 };
    };
    const from = point('Foundry'), to = point('Quiet landing');
    const gesture = { x0: from.x, y0: from.y, moveX: to.x, moveY: to.y, dx: to.x - from.x, dy: to.y - from.y };
    const touch = { nativeEvent: { touches: [{ pageX: to.x, pageY: to.y }] } };
    chart.props.onStartShouldSetPanResponderCapture?.({ nativeEvent: { touches: [{ pageX: from.x, pageY: from.y }] } });
    assert.equal(chart.props.onMoveShouldSetPanResponderCapture(touch, { ...gesture, x0: 0, y0: 0 }), true, 'Capture uses the initial touch, before native PanResponder populates x0/y0');
    await flush(() => chart.props.onPanResponderGrant(touch, gesture));
    await flush(() => chart.props.onPanResponderMove(touch, gesture));
    await flush(() => chart.props.onPanResponderRelease(touch, gesture));
    assert.match(visible(), /Foundry → Quiet landing/);
    assert.match(visible(), /Quiet landing/);
    assert.equal(hosts('TextInput').find(node => node.props.accessibilityLabel === 'Drones to dispatch')!.props.value, '15');
    await press('Send all drones');
    assert.equal(hosts('TextInput').find(node => node.props.accessibilityLabel === 'Drones to dispatch')!.props.value, '30');
    await press('Cancel');
    assert.equal(hosts('Pressable').some(node => /hauler,/.test(node.props.accessibilityLabel ?? '')), false, 'A drag only prepares a transfer; cancel never submits it');
    await press('Close Foundry');
    const canceled = { ...gesture, moveX: -100, moveY: -100 };
    await flush(() => chart.props.onPanResponderGrant(touch, gesture));
    await flush(() => chart.props.onPanResponderRelease(touch, canceled));
    assert.equal(hosts('TextInput').some(node => node.props.accessibilityLabel === 'Drones to dispatch'), false, 'Releasing outside a site cancels the route');
    const reverse = { ...gesture, x0: to.x, y0: to.y, moveX: from.x, moveY: from.y };
    chart.props.onStartShouldSetPanResponderCapture({ nativeEvent: { touches: [{ pageX: to.x, pageY: to.y }] } });
    assert.equal(chart.props.onMoveShouldSetPanResponderCapture(touch, reverse), false, 'Unclaimed sites cannot originate orders');
    chart.props.onStartShouldSetPanResponderCapture({ nativeEvent: { touches: [{ pageX: from.x, pageY: from.y }] } });
    await flush(() => chart.props.onPanResponderGrant(touch, gesture));
    await flush(() => chart.props.onPanResponderMove({ nativeEvent: { touches: [{ pageX: from.x, pageY: from.y }, { pageX: to.x, pageY: to.y }] } }, gesture));
    await flush(() => chart.props.onPanResponderRelease(touch, gesture));
    assert.equal(hosts('TextInput').some(node => node.props.accessibilityLabel === 'Drones to dispatch'), false, 'Adding a second finger cancels transfer selection');
    const pinchStart = { nativeEvent: { touches: [{ pageX: from.x, pageY: from.y }, { pageX: from.x + 50, pageY: from.y }] } };
    await flush(() => chart.props.onPanResponderGrant(touch, gesture));
    await flush(() => chart.props.onPanResponderStart(pinchStart, gesture));
    await flush(() => chart.props.onPanResponderEnd(touch, gesture));
    await flush(() => chart.props.onPanResponderRelease(touch, gesture));
    assert.equal(hosts('TextInput').some(node => node.props.accessibilityLabel === 'Drones to dispatch'), false, 'A stationary second finger cancels before any pinch movement');
    await flush(() => chart.props.onPanResponderGrant(pinchStart, gesture));
    await flush(() => chart.props.onPanResponderMove({ nativeEvent: { touches: [{ pageX: from.x, pageY: from.y }, { pageX: from.x + 150, pageY: from.y }] } }, gesture));
    const scale = () => { const a = point('Foundry'), b = point('Quiet landing'); return Math.hypot(a.x - b.x, a.y - b.y); };
    const pinchedScale = scale();
    await flush(() => chart.props.onPanResponderEnd(touch, gesture));
    await flush(() => chart.props.onPanResponderMove(touch, { ...gesture, dx: gesture.dx + 10 }));
    assert.ok(Math.abs(scale() - pinchedScale) < 1e-9, 'Continuing a pinch with one finger preserves the zoom');
    await flush(() => chart.props.onPanResponderRelease(touch, gesture));
    await press('Map controls');
    await press('Focus your territory');
    await flush(() => chart.props.onPanResponderGrant(touch, gesture));
    await flush(() => chart.props.onPanResponderRelease(touch, gesture));
    const cargo = hosts('View').find(node => node.props.accessibilityLabel === 'Drone cargo')!;
    await flush(() => cargo.props.onLayout({ nativeEvent: { layout: { width: 200 } } }));
    await flush(() => cargo.props.onPanResponderGrant({ nativeEvent: { locationX: 40 } }));
    assert.equal(hosts('TextInput').find(node => node.props.accessibilityLabel === 'Drones to dispatch')!.props.value, '6');
    await press('Prepare launch · 10m');
    assert.ok(hosts('Pressable').some(node => /hauler, preparing launch, 6 drones/.test(node.props.accessibilityLabel ?? '')), 'The drag-based command submits the adjusted manifest');
    await press(/hauler, preparing launch, 6 drones/);
    await press('Jump to hauler arrival');
    assert.match(visible(), /Forecast/);
    await press('Resolve orders');
    assert.match(visible(), /Exercise complete/);
    assert.doesNotMatch(visible(), /Forecast/, 'Resolving returns to the actual outcome');
    assert.match(mapSite('Quiet landing').props.accessibilityLabel, /Mnemosyne, 2 drones/);
    assert.equal(hosts('Pressable').some(node => text(node) === 'Resolve orders'), false, 'Completed attempts cannot resolve twice');
    if (hosts('Modal').length) await press('Skip dialogue');
    await press('All exercises');
    assert.match(visible(), /1\. Open a foothold · completed/);
    assert.deepEqual(writes, [progressKey]); quiet();
    await press('Start: Break the perimeter');
    assert.match(visible(), /Vesper has fortified Quiet landing/);
    await press('Skip dialogue');
    await press('Advance +1h');
    await press('Return to chart');
    await press('Advance +1h');
    assert.equal(hosts('Modal').length, 0, 'Dismissed backchat does not repeat on every clock step');
    for (let i = 0; i < 4; i++) await press('Advance +1h');
    assert.match(visible(), /You brought drones to a shield fight/);
    await press('Continue dialogue');
    assert.match(visible(), /The position held/);
    await press('Return to chart');
    assert.deepEqual(writes, [progressKey], 'Failure dialogue never awards completion');
    quiet();
    await press('Retry exercise');
    await press('Skip dialogue');
    await press(/^Foundry,/);
    await input('Drones to dispatch', '8');
    await press('Plan transfer ↗');
    await press(/^Quiet landing,/);
    await press('Prepare launch · 10m');
    await press('Resolve orders');
    assert.match(visible(), /Try another plan/);
    assert.match(visible(), /D01 · 06:00/, 'An unsuccessful plan resolves to the deadline');
    assert.equal(hosts('Pressable').some(node => text(node) === 'Resolve orders'), false);
    assert.deepEqual(writes, [progressKey], 'Resolving an unsuccessful plan never awards completion');
    quiet();
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    Date.now = originalNow; globalThis.setInterval = originalInterval; globalThis.fetch = originalFetch;
    delete globals[key];
    if (priorAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', priorAct); else delete globals.IS_REACT_ACT_ENVIRONMENT;
  }
});
