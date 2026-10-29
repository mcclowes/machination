import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const React = require('react');
const { create, act } = require('react-test-renderer');

async function withTimeMachine(compact: boolean, check: (host: any) => Promise<void>) {
  const key = `__timeMachine_${randomUUID().replaceAll('-', '')}`;
  const globals = globalThis as typeof globalThis & Record<string, any>;
  const priorAct = Object.getOwnPropertyDescriptor(globals, 'IS_REACT_ACT_ENVIRONMENT');
  const calls: unknown[] = [];
  globals[key] = { dismiss: () => calls.push('dismiss') };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer: any;
  try {
    const output = await build({ entryPoints: [new URL('./TimeMachine.tsx', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'time-machine-host', setup(builder) {
      builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
      builder.onResolve({ filter: /^react-native$/ }, args => ({ path: args.path, namespace: 'native-host' }));
      builder.onLoad({ filter: /.*/, namespace: 'native-host' }, () => ({ contents: `export const View='View',Text='Text',TextInput='TextInput',Pressable='Pressable',StyleSheet={create:x=>x},PanResponder={create:x=>({panHandlers:x})},Keyboard={dismiss:()=>globalThis.${key}.dismiss()};` }));
    } }] });
    const { TimeMachine } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`);
    const flush = async (action: () => void) => { await act(async () => { action(); }); };
    const props = { hour: 2, inspectedHour: null as number | null, historyStart: 0, compact, events: [1, 3], onChange: (hour: number | null) => calls.push(hour) };
    await flush(() => { renderer = create(React.createElement(TimeMachine, props)); });
    const find = (type: string, label: string) => renderer.root.findAll((node: any) => node.type === type && node.props.accessibilityLabel === label)[0];
    const press = async (label: string) => {
      const button = find('Pressable', label);
      assert.ok(button, `Missing button: ${label}`);
      assert.equal(!!button.props.disabled, false);
      await flush(() => button.props.onPress());
    };
    const input = () => find('TextInput', 'Go to hours from now');
    if (compact) await press('Time Machine');
    await check({ calls, find, press, input, flush, setEntry: (entry: string) => flush(() => input().props.onChangeText(entry)), update: (next: Partial<typeof props>) => flush(() => { Object.assign(props, next); renderer.update(React.createElement(TimeMachine, props)); }), text: () => renderer.root.findAllByType('Text').map((node: any) => node.children.filter((child: unknown) => typeof child === 'string').join('')).join('\n') });
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    delete globals[key];
    if (priorAct) Object.defineProperty(globals, 'IS_REACT_ACT_ENVIRONMENT', priorAct);
    else delete globals.IS_REACT_ACT_ENVIRONMENT;
  }
}

for (const compact of [true, false]) test(`inspected time shows its relative direction as live time advances, compact=${compact}`, async () => {
  await withTimeMachine(compact, async ({ update, text, calls, press }) => {
    if (compact) await press('Close time controls');
    calls.splice(0);
    await update({ hour: 0, inspectedHour: 8.5 });
    assert.match(text(), /Forecast · D01 · 08:30/);
    assert.match(text(), /8\.5 hours from now/);
    await update({ hour: 7.5 });
    assert.match(text(), /1\.0 hour from now/);
    await update({ hour: 8.5 - 40 / 60 });
    assert.match(text(), /40\.0 minutes from now/);
    await update({ hour: 8 });
    assert.match(text(), /30\.0 minutes from now/);
    assert.match(text(), /D01 · 08:30/, 'polling preserves the inspected timestamp');
    await update({ hour: 8.5 });
    assert.match(text(), /Live · D01 · 08:30/);
    assert.doesNotMatch(text(), /(?:\d|Less than 1) (?:minutes?|hours?) (?:from now|ago)/);
    await update({ hour: 9 });
    assert.match(text(), /History · D01 · 08:30/);
    assert.match(text(), /30\.0 minutes ago/);
    for (const [hour, direction] of [[8.5 - 1 / 3600, 'from now'], [8.5 + 1 / 3600, 'ago']] as const) {
      await update({ hour });
      assert.ok(text().includes(`Less than 1 minute ${direction}`));
      assert.doesNotMatch(text(), /Live ·/);
    }
    assert.deepEqual(calls, [], 'display updates issue no time changes');
  });
});

for (const compact of [true, false]) for (const submit of ['button', 'keyboard']) test(`precise time inspection releases the keyboard via ${submit}, compact=${compact}`, async () => {
  await withTimeMachine(compact, async ({ calls, input, setEntry, flush, press }) => {
    await setEntry('8.25');
    if (submit === 'button') await press('Inspect');
    else await flush(() => input().props.onSubmitEditing());
    assert.deepEqual(calls, ['dismiss', 10.25], 'release keyboard before changing the forecast');
    assert.equal(!!input(), !compact, 'compact inspection restores chart space');
  });
});

test('invalid precise time retains its editor and bounded history remains inspectable', async () => {
  await withTimeMachine(true, async ({ calls, input, setEntry, flush, find, press }) => {
    for (const entry of ['', '-3', '169', 'NaN', 'Infinity']) {
      await setEntry(entry);
      assert.equal(find('Pressable', 'Inspect').props.disabled, true);
      await flush(() => input().props.onSubmitEditing());
      assert.deepEqual(calls, [], 'invalid submission neither blurs nor changes time');
      assert.ok(input());
    }
    await setEntry('-2');
    await press('Inspect');
    assert.deepEqual(calls, ['dismiss', 0]);
    await press('Time Machine');
    await setEntry('0');
    await press('Inspect');
    assert.deepEqual(calls, ['dismiss', 0, 'dismiss', null]);
  });
});

test('time presets, steps, events, scrubbing, and closing release the editor keyboard', async () => {
  await withTimeMachine(true, async ({ calls, find, press, flush }) => {
    for (const [label, hour] of [['+6h', 8], ['+1h', 3], ['Next event', 3], ['Previous event', 1], ['History start', 0], ['Now', null]] as const) {
      await press(label);
      assert.deepEqual(calls.splice(0), ['dismiss', hour]);
    }
    const track = find('View', 'Operation timeline');
    await flush(() => track.props.onPanResponderGrant({ nativeEvent: { locationX: 0 } }));
    assert.deepEqual(calls.splice(0), ['dismiss', 0]);
    await press('Close time controls');
    assert.deepEqual(calls, ['dismiss']);
  });
});
