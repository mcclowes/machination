import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const React = require('react');
const { create, act } = require('react-test-renderer');

async function motionHost(platform: string, check: (host: any) => Promise<void>) {
  const globals = globalThis as typeof globalThis & Record<string, any>;
  const previous = Object.getOwnPropertyDescriptor(globals, 'IS_REACT_ACT_ENVIRONMENT');
  const running = new Set<object>();
  const listeners = new Map<string, Set<(value: any) => void>>();
  let resolveMotion!: (value: boolean) => void;
  globals.__operationAnimationHost = {
    running, motion: new Promise<boolean>(resolve => { resolveMotion = resolve; }),
    subscribe(name: string, callback: (value: any) => void) {
      const group = listeners.get(name) ?? new Set();
      listeners.set(name, group); group.add(callback);
      return { remove: () => group.delete(callback) };
    },
  };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer: any;
  try {
    const output = await build({
      stdin: { contents: `export {ShipMarker} from './ShipMarker'; export {OperationShell} from './OperationShell';`, resolveDir: new URL('.', import.meta.url).pathname },
      bundle: true, write: false, format: 'esm', platform: 'node',
      plugins: [{ name: 'operation-motion', setup(builder) {
        builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
        builder.onResolve({ filter: /^(react-native(?:-svg)?)$|\/PlayerIdentity$/ }, args => ({ path: args.path, namespace: 'motion-host' }));
        builder.onLoad({ filter: /.*/, namespace: 'motion-host' }, args => ({ contents: args.path.endsWith('PlayerIdentity')
          ? `export const PlayerPortraits={Provider:({children})=>children};`
          : args.path === 'react-native-svg'
            ? `export default 'Svg'; export const Circle='Circle',G='G',Line='Line',Path='Path';`
            : `const host=globalThis.__operationAnimationHost;
              export const View='View',Text='Text',Pressable='Pressable',ScrollView='ScrollView',KeyboardAvoidingView='KeyboardAvoidingView';
              export const StyleSheet={create:x=>x},Platform={OS:${JSON.stringify(platform)}},useWindowDimensions=()=>({width:1200});
              export const AccessibilityInfo={isReduceMotionEnabled:()=>host.motion,addEventListener:host.subscribe};
              export const AppState={currentState:'active',addEventListener:host.subscribe};
              export const Easing={ease:x=>x,cubic:x=>x,out:x=>x,inOut:x=>x};
              const animation=()=>({start(){host.running.add(this)},stop(){host.running.delete(this)}});
              export const Animated={View:'AnimatedView',Value:class{constructor(value){this.value=value}setValue(value){this.value=value}interpolate(){return this}},
                timing:(value,config)=>{if(config.isInteraction!==false||config.useNativeDriver!==${platform !== 'web'})throw Error('Motion must not block input or use per-frame native JS');return animation()},sequence:animation,loop:animation};` }));
      } }],
    });
    const components = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}#${randomUUID()}`);
    const flush = async (fn: () => void) => { await act(async () => { fn(); }); };
    await check({ ...components, running, flush,
      render: async (component: any, props: object) => flush(() => {
        if (renderer) renderer.update(React.createElement(component, props));
        else renderer = create(React.createElement(component, props));
      }),
      root: () => renderer.root,
      resolve: async (value: boolean) => flush(() => resolveMotion(value)),
      emit: async (name: string, value: any) => flush(() => listeners.get(name)?.forEach(callback => callback(value))),
      unmount: async () => flush(() => renderer.unmount()),
    });
    await flush(() => renderer?.unmount());
    assert.equal(running.size, 0, 'Unmount stops every animation');
    assert.equal([...listeners.values()].reduce((sum, group) => sum + group.size, 0), 0, 'Unmount releases preference and app-state listeners');
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    delete globals.__operationAnimationHost;
    if (previous) Object.defineProperty(globals, 'IS_REACT_ACT_ENVIRONMENT', previous);
    else delete globals.IS_REACT_ACT_ENVIRONMENT;
  }
}

for (const platform of ['web', 'ios']) test(`hauler animation respects flight state, motion preference, and foreground on ${platform}`, async () => {
  await motionHost(platform, async host => {
    const props = { color: '#73d6dc', drones: 12, heading: 90 };
    await host.render(host.ShipMarker, props);
    assert.equal(host.running.size, 0, 'Wait for the motion preference');
    await host.resolve(false);
    assert.ok(host.running.size > 0, 'In-flight engines pulse');
    await host.render(host.ShipMarker, { ...props, preparing: true });
    assert.equal(host.running.size, 0, 'Docked ships have no engine animation');
    await host.render(host.ShipMarker, { ...props, enginesDisabled: true });
    assert.equal(host.running.size, 0, 'Disabled engines stay still');
    await host.render(host.ShipMarker, { ...props, enginesDisabled: true, selected: true });
    assert.ok(host.running.size > 0, 'Selection remains visible on a disabled ship');
    await host.emit('change', 'background');
    assert.equal(host.running.size, 0);
    await host.emit('change', 'active');
    assert.ok(host.running.size > 0);
    await host.emit('reduceMotionChanged', true);
    assert.equal(host.running.size, 0, 'Reduced motion stops all decorative motion');
    assert.equal(host.root().findAllByProps({ testID: 'ship-selection' }).length, 1, 'The static selection cue remains');
    await host.emit('reduceMotionChanged', false);
    assert.ok(host.running.size > 0);
  });
});

for (const platform of ['web', 'ios']) test(`operation drawer enters on section changes and stays readable without motion on ${platform}`, async () => {
  await motionHost(platform, async host => {
    const panels = Object.fromEntries(['asset', 'orders', 'units', 'signals', 'intel', 'settings'].map(key => [key, { title: key, content: React.createElement('Text', {}, key) }]));
    const props = { chart: null, timeline: null, status: null, section: null, onSection() {}, panels };
    await host.render(host.OperationShell, props);
    await host.resolve(false);
    assert.equal(host.running.size, 0, 'A closed drawer does not animate');
    await host.render(host.OperationShell, { ...props, section: 'orders' });
    assert.equal(host.running.size, 1, 'Opening a section animates its drawer');
    await host.render(host.OperationShell, { ...props, section: 'units' });
    assert.equal(host.running.size, 1, 'Switching sections cancels the previous entrance');
    await host.emit('reduceMotionChanged', true);
    assert.equal(host.running.size, 0);
    const drawer = host.root().findByProps({ testID: 'operation-drawer' });
    assert.equal(drawer.props.style.flat().find((style: any) => style.opacity)?.opacity.value, 1, 'Reduced motion shows the complete drawer immediately');
    await host.emit('reduceMotionChanged', false);
    assert.equal(host.running.size, 1);
    await host.emit('change', 'background');
    assert.equal(host.running.size, 0);
    await host.render(host.OperationShell, props);
    assert.equal(host.root().findAllByProps({ testID: 'operation-drawer' }).length, 0, 'Closing removes the drawer immediately');
  });
});
