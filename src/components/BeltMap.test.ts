import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import type { Fleet } from '../game/simulation';

const require = createRequire(import.meta.url);
const React = require('react');
const { create, act } = require('react-test-renderer');

for (const platform of ['web', 'ios']) test(`chart zoom controls and wheel lifecycle on ${platform}`, async () => {
  const globals = globalThis as typeof globalThis & Record<string, any>;
  const priorAct = Object.getOwnPropertyDescriptor(globals, 'IS_REACT_ACT_ENVIRONMENT');
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  const listeners = new Map<string, (event: any) => void>();
  let registrations = 0, removals = 0;
  const host = {
    measureInWindow: (callback: (...values: number[]) => void) => callback(0, 0, 400, 480),
    addEventListener: (name: string, handler: (event: any) => void, options: { passive: boolean }) => {
      assert.equal(options.passive, false, 'chart zoom must prevent page scrolling');
      registrations++; listeners.set(name, handler);
    },
    removeEventListener: (name: string, handler: (event: any) => void) => {
      assert.equal(listeners.get(name), handler); removals++; listeners.delete(name);
    },
  };
  let renderer: any;
  try {
    const output = await build({ entryPoints: [new URL('./BeltMap.tsx', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.png': 'dataurl' }, plugins: [{ name: 'chart-hosts', setup(builder) {
      builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
      builder.onResolve({ filter: /\/(?:SpaceBackground|CopyObjectReference|PlayerIdentity)$/ }, args => ({ path: args.path, namespace: 'chart-leaves' }));
      builder.onLoad({ filter: /.*/, namespace: 'chart-leaves' }, () => ({ contents: 'export const SpaceBackground=()=>null,CopyObjectReference=()=>null,PlayerIdentity=()=>null,usePlayerRoster=()=>()=>({color:"white"});' }));
      builder.onResolve({ filter: /^react-native(?:-svg)?$/ }, args => ({ path: args.path, namespace: 'chart-hosts' }));
      builder.onLoad({ filter: /.*/, namespace: 'chart-hosts' }, args => ({ contents: args.path === 'react-native-svg'
        ? `export default 'Svg'; export const Circle='Circle',G='G',Line='Line',Path='Path',Text='SvgText';`
        : `export const View='View',Pressable='Pressable',ScrollView='ScrollView',Text='Text',Image='Image',StyleSheet={create:x=>x},PanResponder={create:x=>({panHandlers:x})},Platform={OS:${JSON.stringify(platform)}};` }));
    } }] });
    const { BeltMap } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`);
    const flush = async (fn: () => void) => { await act(async () => { fn(); }); };
    let camera = { scale: 2, x: 0, y: 0 };
    const game: { hour: number; rocks: never[]; fleets: Fleet[] } = { hour: 0, rocks: [], fleets: [] };
    let inspectFleet: { id: number; request: number } | undefined;
    function Chart() {
      const [value, setValue] = React.useState(camera);
      return React.createElement(BeltMap, { game, selected: '', inspectFleet, onSelect() {}, viewport: { camera: value, onChange(next: typeof camera) { camera = next; setValue(next); } } });
    }
    await flush(() => { renderer = create(React.createElement(Chart), { createNodeMock: (element: any) => element.props.testID === 'belt-map' ? host : null }); });
    const button = (label: string) => renderer.root.findAll((node: any) => node.type === 'Pressable' && node.props.accessibilityLabel === label)[0];
    const layout = async (height: number) => {
      const chart = renderer.root.findAll((node: any) => node.type === 'View' && node.props.testID === 'belt-map')[0];
      await flush(() => chart.props.onLayout({ nativeEvent: { layout: { width: 800, height } } }));
    };
    const shownScale = () => {
      const group = renderer.root.findAll((node: any) => node.type === 'G' && node.props.transform?.startsWith('translate('))[0];
      // A centered camera's SVG translation reveals the real pixel scale.
      return (800 / 2 - Number(group.props.transform.match(/translate\(([^,]+)/)[1])) / 50;
    };
    await layout(0);
    await layout(480);
    const beforeTimeChange = shownScale();
    assert.equal(beforeTimeChange, 9.6, 'the first measured layout sets the opening fit');
    for (const [hour, height] of [[11, 462], [12, 480], [13, 462]] as const) {
      game.hour = hour;
      await flush(() => renderer.update(React.createElement(Chart)));
      await layout(height);
      assert.equal(shownScale(), beforeTimeChange, 'time-dependent panel height must not change rendered chart zoom');
      assert.deepEqual(camera, { scale: 2, x: 0, y: 0 });
    }
    assert.equal(!!button('Zoom in'), platform === 'web', 'web controls are discoverable; native controls stay compact');
    if (platform === 'ios') {
      assert.equal(listeners.size, 0);
      await flush(() => button('Map controls').props.onPress());
      assert.ok(button('Zoom in'));
      const chart = renderer.root.findAll((node: any) => node.type === 'View' && node.props.testID === 'belt-map')[0];
      const gesture = { dx: 0, dy: 0 };
      await flush(() => chart.props.onPanResponderGrant({ nativeEvent: { touches: [{ pageX: 0, pageY: 0 }, { pageX: 100, pageY: 0 }] } }, gesture));
      await flush(() => chart.props.onPanResponderMove({ nativeEvent: { touches: [{ pageX: 0, pageY: 0 }, { pageX: 150, pageY: 0 }] } }, gesture));
      assert.equal(camera.scale, 3, 'native pinch still zooms');
    } else {
      assert.equal(registrations, 1);
      let prevented = false;
      const wheel = async (deltaY: number, deltaMode = 0, overlay = false) => {
        prevented = false;
        await flush(() => listeners.get('wheel')!({ deltaY, deltaMode, target: { closest: () => overlay ? {} : null }, preventDefault() { prevented = true; } }));
      };
      await wheel(-100);
      assert.ok(camera.scale > 2);
      assert.equal(prevented, true);
      const zoomed = camera.scale;
      await wheel(100);
      assert.ok(Math.abs(camera.scale - 2) < 1e-9);
      await wheel(-100, 0, true);
      assert.equal(camera.scale, 2, 'scrolling an overlay leaves the chart alone');
      assert.equal(prevented, false);
      await wheel(0);
      assert.equal(prevented, false, 'horizontal scrolling is not swallowed');
      await wheel(-6.25, 1);
      assert.equal(camera.scale, zoomed, 'line and pixel wheel events have consistent sensitivity');
      for (let i = 0; i < 20; i++) await wheel(-100, 2);
      assert.equal(camera.scale, 4);
      assert.equal(button('Zoom in').props.disabled, true);
      for (let i = 0; i < 20; i++) await wheel(100);
      assert.equal(camera.scale, 1);
      assert.equal(button('Zoom out').props.disabled, true);
      await flush(() => button('Zoom in').props.onPress());
      assert.equal(camera.scale, 1.5);
      await flush(() => {
        listeners.get('wheel')!({ deltaY: -100, deltaMode: 0, preventDefault() {} });
        listeners.get('wheel')!({ deltaY: -100, deltaMode: 0, preventDefault() {} });
      });
      assert.ok(Math.abs(camera.scale - 1.5 * Math.exp(0.4)) < 1e-9, 'wheel bursts accumulate before React renders');
      await flush(() => button('Fit chart').props.onPress());
      game.fleets.push({ id: 1, owner: 'you', from: 'a', to: 'b', drones: 10, departed: 0, arrives: 10, route: { from: { x: 50, y: 95 }, to: { x: 50, y: 100 } } });
      inspectFleet = { id: 1, request: 1 };
      await flush(() => renderer.update(React.createElement(Chart)));
      const card = renderer.root.findAll((node: any) => node.type === 'ScrollView' && node.props.testID === 'hauler-inspector')[0];
      await flush(() => card.props.onLayout({ nativeEvent: { layout: { height: 300 } } }));
      assert.ok(camera.y < 0, 'the legacy bottom-edge hauler is lifted above its card');
      await wheel(-100);
      assert.ok(camera.y < -(camera.scale - 1) * 50, 'wheel zoom preserves the open legacy card allowance');
      await flush(() => button('Zoom in').props.onPress());
      assert.ok(camera.y < -(camera.scale - 1) * 50, 'button zoom preserves the same allowance');
      assert.equal(registrations, 1, 'rerenders do not accumulate wheel listeners');
    }
    await layout(600);
    await flush(() => button('Fit chart').props.onPress());
    assert.equal(shownScale(), 6, 'Fit explicitly uses the current viewport');
    await layout(360);
    await flush(() => button('Focus your territory').props.onPress());
    assert.equal(shownScale(), 3.6, 'Home explicitly uses the current viewport');
    await flush(() => renderer.unmount());
    renderer = undefined;
    assert.equal(listeners.size, 0);
    assert.equal(removals, platform === 'web' ? 1 : 0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (priorAct) Object.defineProperty(globals, 'IS_REACT_ACT_ENVIRONMENT', priorAct);
    else delete globals.IS_REACT_ACT_ENVIRONMENT;
  }
});
