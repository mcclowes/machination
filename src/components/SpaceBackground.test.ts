import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const React = require('react');
const { create, act } = require('react-test-renderer');

test('space sky honors motion preferences, foreground state, and unmount cleanup', async () => {
  const globals = globalThis as typeof globalThis & Record<string, any>;
  const priorAct = Object.getOwnPropertyDescriptor(globals, 'IS_REACT_ACT_ENVIRONMENT');
  const listeners = new Map<string, (value: any) => void>();
  const running = new Set<object>();
  let resolveMotion!: (reduced: boolean) => void;
  const motion = new Promise<boolean>(resolve => { resolveMotion = resolve; });
  globals.__spaceSkyHost = {
    motion, running,
    subscribe: (name: string, callback: (value: any) => void) => {
      listeners.set(name, callback);
      return { remove: () => listeners.delete(name) };
    },
  };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer: any;
  try {
    const output = await build({ entryPoints: [new URL('./SpaceBackground.tsx', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'sky-hosts', setup(builder) {
      builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
      builder.onResolve({ filter: /^react-native(?:-svg)?$/ }, args => ({ path: args.path, namespace: 'sky-hosts' }));
      builder.onLoad({ filter: /.*/, namespace: 'sky-hosts' }, args => ({ contents: args.path === 'react-native-svg'
        ? `export default 'Svg'; export const Defs='Defs',RadialGradient='RadialGradient',Stop='Stop',Rect='Rect';`
        : `const host=globalThis.__spaceSkyHost;
          export const View='View',StyleSheet={create:x=>x,absoluteFillObject:{position:'absolute',top:0,left:0,right:0,bottom:0}},Platform={OS:'ios'};
          export const AccessibilityInfo={isReduceMotionEnabled:()=>host.motion,addEventListener:host.subscribe};
          export const AppState={currentState:'active',addEventListener:host.subscribe};
          export const Easing={linear:x=>x,inOut:x=>x,ease:x=>x};
          const animation=()=>({start(){host.running.add(this)},stop(){host.running.delete(this)}});
          export const Animated={View:'AnimatedView',Value:class{constructor(value){this.value=value}setValue(value){this.value=value}interpolate(){return this}},timing:(_value,config)=>{if(config.isInteraction!==false||config.useNativeDriver!==true)throw Error('Sky must not block interactions or use per-frame native JS');return animation()},sequence:animation,parallel:animation,loop:animation};` }));
    } }] });
    const { SpaceBackground } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`);
    const flush = async (fn: () => void) => { await act(async () => { fn(); await Promise.resolve(); }); };
    await flush(() => { renderer = create(React.createElement(SpaceBackground)); });
    assert.equal(running.size, 0, 'Stay still until the motion preference is known');
    const decoration = renderer.root.findByProps({ testID: 'space-background' });
    assert.equal(decoration.props.pointerEvents, 'none');
    assert.equal(decoration.props.accessibilityElementsHidden, true);
    assert.equal(decoration.props.importantForAccessibility, 'no-hide-descendants');
    await flush(() => resolveMotion(false));
    assert.ok(running.size > 0, 'Foreground sky animates');
    await flush(() => listeners.get('change')!('background'));
    assert.equal(running.size, 0, 'Background sky stops');
    await flush(() => listeners.get('change')!('active'));
    assert.ok(running.size > 0, 'Returning to the app resumes the sky');
    await flush(() => listeners.get('reduceMotionChanged')!(true));
    assert.equal(running.size, 0, 'Reduced motion leaves a static sky');
    await flush(() => listeners.get('reduceMotionChanged')!(false));
    assert.ok(running.size > 0);
    await flush(() => renderer.unmount());
    assert.equal(running.size, 0);
    assert.equal(listeners.size, 0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    delete globals.__spaceSkyHost;
    if (priorAct) Object.defineProperty(globals, 'IS_REACT_ACT_ENVIRONMENT', priorAct);
    else delete globals.IS_REACT_ACT_ENVIRONMENT;
  }
});
