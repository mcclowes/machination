/** @format */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createConfiguredGame, createGame } from '../game/world';
import { fitPlayerCamera, type MapCamera } from '../game/chart-camera';
import { createArchive } from '../game/replay';
import { encodeOperation } from '../game/operation-save';
import {
  OPERATION_MOTION_NATIVE,
  OPERATION_MOTION_PREFERENCE,
} from '../test-support/operation-motion-host';

const require = createRequire(import.meta.url);
const React = require('react');
const { create, act } = require('react-test-renderer');

test('solo camera follows adoption, preserving manual pan through commands and clocks', async () => {
  const epoch = Date.parse('2026-10-13T12:00:00Z');
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, epoch, 314159);
  assert.notDeepEqual(fitPlayerCamera(game, 'you'), fitPlayerCamera(createGame(epoch), 'you'));
  const bytes = new Map([
    [
      'machination.game.v1',
      encodeOperation({ game, archive: createArchive(game, { rivals: true }) }, epoch),
    ],
  ]);
  const key = `__soloCamera_${randomUUID().replaceAll('-', '')}`;
  const globals = globalThis as typeof globalThis & Record<string, any>;
  const previousAct = Object.getOwnPropertyDescriptor(globals, 'IS_REACT_ACT_ENVIRONMENT');
  let now = epoch,
    failProfile = false;
  const timers = new Map<number, () => void>();
  const original = {
    now: Date.now,
    random: Math.random,
    interval: globalThis.setInterval,
    clear: globalThis.clearInterval,
    fetch: globalThis.fetch,
  };
  globals[key] = {
    storage: {
      async getItem(name: string) {
        if (name === 'machination.profile.v1' && failProfile)
          throw new Error('Fixture profile read failed');
        return bytes.get(name) ?? null;
      },
      async setItem(name: string, value: string) {
        bytes.set(name, value);
      },
    },
  };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer: any;
  try {
    const output = await build({
      entryPoints: [new URL('../../App.tsx', import.meta.url).pathname],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      loader: { '.png': 'dataurl' },
      plugins: [
        {
          name: 'solo-camera-host',
          setup(builder) {
            builder.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
              path: pathToFileURL(require.resolve(args.path)).href,
              external: true,
            }));
            const components: Record<string, string> = {
              BeltMap: `export const BeltMap='Chart';`,
              OperationShell: `import React from 'react'; export const OperationShell=props=>React.createElement('Shell',props,props.chart,props.timeline,props.panels.asset.content,props.panels.settings.content);`,
              TimeMachine: `export const TimeMachine='TimeMachine';`,
              StartScreen: `export const StartScreen=({children})=>children;`,
              FieldManual: `export const FieldManual=()=>null;`,
              PlayerProfile: `export const PlayerProfile=()=>null;`,
              SpaceBackground: `export const SpaceBackground=()=>null;`,
              ReplayExport: `export const ReplayExport=()=>null;`,
              OnlineOperation: `export const OnlineOperation=()=>{throw Error('Unexpected multiplayer');};`,
              MultiplayerAccount: `export const useAccountAccess=()=>null;`,
              'notification-wiring': `export const launchDeps=undefined;`,
              'use-ambient-motion': OPERATION_MOTION_PREFERENCE,
            };
            builder.onResolve(
              {
                filter:
                  /\/(BeltMap|OperationShell|TimeMachine|StartScreen|FieldManual|PlayerProfile|SpaceBackground|ReplayExport|OnlineOperation|MultiplayerAccount|notification-wiring|use-ambient-motion)$/,
              },
              (args) => ({ path: args.path.split('/').at(-1)!, namespace: 'camera-host' }),
            );
            const modules: Record<string, string> = {
              'react-native': `export const View='View',Text='Text',Image='Image',Pressable='Pressable',ScrollView='ScrollView',TextInput='TextInput',KeyboardAvoidingView='KeyboardAvoidingView';
            export const Modal=({visible,children})=>visible?children:null;
            export const StyleSheet={create:x=>x,absoluteFillObject:{},hairlineWidth:1},Platform={OS:'web',select:x=>x.web??x.default};
            export const useWindowDimensions=()=>({width:1200,height:800,scale:1,fontScale:1}),Dimensions={get:()=>({width:1200,height:800})},PanResponder={create:x=>({panHandlers:x})};
            export const AppState={currentState:'active',addEventListener:()=>({remove(){}})},Keyboard={dismiss(){},addListener:()=>({remove(){}})};
            ${OPERATION_MOTION_NATIVE}`,
              'react-native-svg': `export default 'Svg'; export const Circle='Circle',Ellipse='Ellipse',G='G',Line='Line',Path='Path',Text='SvgText',Defs='Defs',LinearGradient='LinearGradient',RadialGradient='RadialGradient',Rect='Rect',Stop='Stop';`,
              'react-native-safe-area-context': `export const SafeAreaProvider='SafeAreaProvider',SafeAreaView='SafeAreaView';`,
              'expo-status-bar': `export const StatusBar='StatusBar';`,
              'expo-crypto': `export const randomUUID=()=> 'camera-command-identity',getRandomBytesAsync=async()=>{throw Error('Unexpected credential generation');};`,
              'expo-secure-store': `const fail=async()=>{throw Error('Unexpected credential access');}; export const getItemAsync=fail,setItemAsync=fail,deleteItemAsync=fail;`,
              'expo-clipboard': `export const setStringAsync=async()=>{};`,
              '@react-native-async-storage/async-storage': `export default globalThis[${JSON.stringify(key)}].storage;`,
            };
            builder.onResolve(
              {
                filter:
                  /^(react-native(?:-svg|-safe-area-context)?|expo-status-bar|expo-crypto|expo-secure-store|expo-clipboard|@react-native-async-storage\/async-storage)$/,
              },
              (args) => ({ path: args.path, namespace: 'camera-host' }),
            );
            builder.onResolve({ filter: /\/audio\/sound$/ }, () => ({
              path: 'silent',
              namespace: 'camera-host',
            }));
            builder.onResolve({ filter: /replay\/files$/ }, () => ({
              path: 'files',
              namespace: 'camera-host',
            }));
            builder.onLoad({ filter: /.*/, namespace: 'camera-host' }, (args) => ({
              contents:
                components[args.path] ??
                modules[args.path] ??
                (args.path === 'silent'
                  ? `export const playSound=()=>{},useSoundCues=()=>{},useSoundEnabled=()=>false,setSoundEnabled=()=>{};`
                  : `export const pickSharedReplay=async()=>{throw Error('Unexpected replay import');},saveSharedReplay=async()=>{throw Error('Unexpected replay export');};`),
            }));
          },
        },
      ],
    });
    const { default: App } = await import(
      `data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}#${key}`
    );
    Date.now = () => now;
    Math.random = () => 0.5;
    let nextTimer = 0;
    globalThis.setInterval = ((callback: () => void) => {
      timers.set(++nextTimer, callback);
      return nextTimer;
    }) as typeof setInterval;
    globalThis.clearInterval = ((id: number) => {
      timers.delete(id);
    }) as typeof clearInterval;
    globalThis.fetch = (async () => {
      throw new Error('Unexpected network request');
    }) as typeof fetch;
    const flush = async (action: () => unknown) => {
      await act(async () => {
        await action();
        await new Promise((resolve) => setImmediate(resolve));
      });
    };
    const text = (node: any): string =>
      typeof node === 'string' ? node : node.children.map(text).join('');
    const press = async (label: string) => {
      const button = renderer.root.findAll(
        (node: any) =>
          node.type === 'Pressable' && (node.props.accessibilityLabel ?? text(node)) === label,
      )[0];
      assert.ok(button, `Missing control: ${label}`);
      assert.ok(!button.props.disabled, `Disabled control: ${label}`);
      await flush(() => button.props.onPress());
    };
    const chart = () => renderer.root.findByType('Chart').props;
    const stored = () => JSON.parse(bytes.get('machination.game.v1')!).game;
    const pan = async (camera: MapCamera) => flush(() => chart().viewport.onChange(camera));
    await flush(() => {
      renderer = create(React.createElement(App));
    });
    await press('Resume solo operation');
    assert.equal(stored().rules.map.seed, 314159);
    assert.ok(
      chart().game.rocks.some((r: any) => r.id === game.rocks.find((r) => r.coreOf === 'you')!.id),
    );
    assert.deepEqual(
      chart().viewport.camera,
      fitPlayerCamera(game, 'you'),
      'Restoration must frame the adopted map even when the placeholder epoch is equal',
    );

    const camera = { scale: 2, x: 11, y: -17 };
    await pan(camera);
    await press('Disable shields');
    assert.equal(chart().game.rocks.find((r: any) => r.coreOf === 'you').shieldsDisabled, true);
    assert.deepEqual(chart().viewport.camera, camera, 'An accepted command preserves manual pan');
    now += 15_000;
    await flush(() => [...timers.values()].forEach((callback) => callback()));
    assert.ok(chart().game.hour > 0);
    assert.deepEqual(chart().viewport.camera, camera, 'A clock tick preserves manual pan');
    await press('Advance simulation +6h');
    assert.ok(chart().game.hour >= 6);
    assert.deepEqual(chart().viewport.camera, camera, 'Manual catch-up preserves manual pan');

    now = epoch;
    await press('Reset');
    failProfile = true;
    await press('Replace operation');
    assert.equal(stored().rules.map.seed, 314159);
    assert.deepEqual(
      chart().viewport.camera,
      camera,
      'Failed replacement preserves the current operation and camera',
    );
    failProfile = false;
    await press('Replace operation');
    assert.equal(stored().epoch, epoch);
    assert.notEqual(stored().rules.map.seed, 314159);
    assert.deepEqual(
      chart().viewport.camera,
      fitPlayerCamera(stored(), 'you'),
      'Explicit replacement refits at the same epoch',
    );
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    Date.now = original.now;
    Math.random = original.random;
    globalThis.setInterval = original.interval;
    globalThis.clearInterval = original.clear;
    globalThis.fetch = original.fetch;
    delete globals[key];
    if (previousAct) Object.defineProperty(globals, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else delete globals.IS_REACT_ACT_ENVIRONMENT;
  }
});
