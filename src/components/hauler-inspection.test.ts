import { OPERATION_MOTION_NATIVE, operationMotionPreferencePlugin } from '../test-support/operation-motion-host';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { constrainCamera, type MapCamera } from '../game/chart-camera';

const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
const { create, act } = require('react-test-renderer');

test('measured hauler inspection reveals, allows manual pan, resizes, and releases legacy bounds', async () => {
  const priorAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let renderer: any;
  try {
    const bundle = await build({ entryPoints: [new URL('./BeltMap.tsx', import.meta.url).pathname], bundle: true, write: false,
      format: 'esm', platform: 'node', loader: { '.png': 'dataurl' }, plugins: [operationMotionPreferencePlugin, { name: 'inspection-hosts', setup(builder) {
        builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
        builder.onResolve({ filter: /\/SpaceBackground$/ }, () => ({ path: 'sky', namespace: 'inspection-hosts' }));
        builder.onResolve({ filter: /^(react-native|react-native-svg|expo-clipboard)$/ }, args => ({ path: args.path, namespace: 'inspection-hosts' }));
        builder.onLoad({ filter: /.*/, namespace: 'inspection-hosts' }, args => ({ contents: args.path === 'sky' ? 'export const SpaceBackground=()=>null;'
          : args.path === 'react-native' ? `${OPERATION_MOTION_NATIVE}
export const View='View',Text='Text',Image='Image',Pressable='Pressable',ScrollView='ScrollView'; export const Platform={OS:'ios'}; export const StyleSheet={create:x=>x}; export const PanResponder={create:x=>({panHandlers:x})};`
          : args.path === 'react-native-svg' ? `export default 'Svg'; export const Circle='Circle',Ellipse='Ellipse',G='G',Line='Line',Path='Path',Text='SvgText';`
          : 'export const setStringAsync=async()=>{};' }));
      } }] });
    const { BeltMap } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`);
    for (const torus of [false, true]) {
      let camera: MapCamera = { scale: 2, x: 0, y: -50 }, changes = 0;
      const game = { epoch: 1, hour: 0, rocks: [
        { id: 'a', name: 'Source', kind: 'factory', owner: 'you', x: 50, y: 95, drones: 0 },
        { id: 'b', name: 'Target', kind: 'factory', owner: 'you', x: 50, y: 100, drones: 0 }],
        fleets: [{ id: 1, owner: 'you', from: 'a', to: 'b', drones: 2, departed: 0, arrives: 10 }],
        ...(torus ? { rules: { map: { width: 100, height: 100, topology: 'torus' as const } } } : {}) };
      function Harness() {
        const [state, setState] = React.useState(camera);
        camera = state;
        return React.createElement(BeltMap, { game, selected: '', inspectFleet: { request: 1, id: 1 },
          player: 'you', onSelect() {}, viewport: { camera: state, onChange: (next: MapCamera) => { changes++; setState(next); } } });
      }
      const flush = async (action: () => void) => { await act(async () => { action(); }); };
      await flush(() => { renderer = create(React.createElement(Harness)); });
      const host = (id: string) => renderer.root.findAll((node: any) => node.type === 'View' && node.props.testID === id)[0];
      const card = () => renderer.root.findAll((node: any) => node.type === 'ScrollView' && node.props.testID === 'hauler-inspector')[0];
      const layout = (height: number) => ({ nativeEvent: { layout: { width: 393, height } } });
      await flush(() => host('belt-map').props.onLayout(layout(616)));
      const before = changes;
      await flush(() => card().props.onLayout(layout(330)));
      assert.equal(changes, before + 1, 'actual card measurement triggers the reveal');
      const visibleY = () => renderer.root.findAll((node: any) => node.type === 'Pressable' && /hauler,/.test(node.props.accessibilityLabel ?? ''))
        .map((node: any) => parseFloat(node.props.style[1].top) / 100 * 616).filter((y: number) => y >= 22 && y <= 254);
      assert.ok(visibleY().length, 'a visible fleet copy clears the measured card');
      const y = visibleY()[0];
      await flush(() => host('belt-map').props.onPanResponderGrant({ nativeEvent: { touches: [{ pageX: 0, pageY: 0 }] } }, { x0: 0, y0: 0, dx: 0, dy: 0 }));
      await flush(() => host('belt-map').props.onPanResponderMove({ nativeEvent: { touches: [{ pageX: 0, pageY: 40 }] } }, { dx: 0, dy: 40, moveX: 0, moveY: 40 }));
      assert.ok(Math.abs(visibleY()[0] - y - 40) < 1e-6, 'manual pan remains in effect');
      const afterPan = changes;
      await flush(() => card().props.onLayout(layout(330)));
      assert.equal(changes, afterPan, 'remeasuring unchanged content does not undo manual pan');
      await flush(() => host('belt-map').props.onLayout(layout(120)));
      assert.equal(card().props.style[1].maxHeight, 56, 'a small chart retains a clear band and scrolls the details');
      await flush(() => card().props.onLayout(layout(56)));
      assert.equal(camera.scale, 2, 'inspection preserves zoom');
      const close = renderer.root.findAll((node: any) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Close hauler details')[0];
      await flush(() => close.props.onPress());
      assert.equal(card(), undefined);
      const beforeCloseClamp = camera;
      const grant = host('belt-map').props.onPanResponderGrant;
      await flush(() => grant({ nativeEvent: { touches: [{ pageX: 0, pageY: 0 }] } }, { x0: 0, y0: 0, dx: 0, dy: 0 }));
      await flush(() => host('belt-map').props.onPanResponderMove({ nativeEvent: { touches: [{ pageX: 0, pageY: 0 }] } }, { dx: 0, dy: 0, moveX: 0, moveY: 0 }));
      assert.deepEqual(camera, constrainCamera(game, beforeCloseClamp), 'closing releases the temporary legacy pan allowance');
      await flush(() => renderer.unmount()); renderer = undefined;
    }
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (priorAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', priorAct);
    else delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
  }
});
