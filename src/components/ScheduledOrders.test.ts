import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import type { ScheduledOrder } from '../game/orders';

const require = createRequire(import.meta.url);
const React = require('react');
const { create, act } = require('react-test-renderer');

async function withQueue(check: (host: any) => Promise<void>) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let renderer: any;
  try {
    const output = await build({ entryPoints: [new URL('./ScheduledOrders.tsx', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'queue-host', setup(builder) {
      builder.onResolve({ filter: /^react$/ }, () => ({ path: pathToFileURL(require.resolve('react')).href, external: true }));
      builder.onResolve({ filter: /^react-native$/ }, () => ({ path: 'native', namespace: 'host' }));
      builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: "export const View='View',Text='Text',TextInput='TextInput',Pressable='Pressable',ScrollView='ScrollView',StyleSheet={create:x=>x};" }));
    } }] });
    const { ScheduledOrders } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`);
    const plans: ScheduledOrder[] = [
      { id: 'later', owner: 'you', from: 'a', to: 'b', drones: 12, executeAt: 8 },
      { id: 'first', owner: 'you', from: 'b', to: 'a', drones: 7, executeAt: 4 },
      { id: 'ally', owner: 'vesper', from: 'a', to: 'b', drones: 9, executeAt: 6 },
    ];
    const calls: unknown[] = [];
    const props = { owner: 'you', compact: true, plans, hour: 2, rocks: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }], disabled: false, units: [], preparation: true, onInspect: (at: number) => calls.push(['inspect', at]), onEdit: (edit: unknown) => calls.push(['edit', edit]), onCancel: (id: string) => calls.push(['cancel', id]) };
    const flush = async (action: () => void) => act(async () => { action(); });
    await flush(() => { renderer = create(React.createElement(ScheduledOrders, props)); });
    const find = (type: string, label: string) => renderer.root.findAll((node: any) => node.type === type && node.props.accessibilityLabel === label)[0];
    const press = async (label: string) => { const control = find('Pressable', label); assert.ok(control, `Missing ${label}`); assert.ok(!control.props.disabled, `Disabled ${label}`); await flush(control.props.onPress); };
    await check({ calls, find, press, flush, renderer, update: (next: Partial<typeof props>) => flush(() => { Object.assign(props, next); renderer.update(React.createElement(ScheduledOrders, props)); }) });
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (prior) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', prior);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
}

test('selecting a concise order inspects its time and reveals only its launch editor', async () => {
  await withQueue(async ({ calls, find, press, flush, update }) => {
    assert.equal(find('TextInput', 'Scheduled launch drones'), undefined);
    await press('Inspect scheduled order: Beta → Alpha');
    assert.deepEqual(calls, [['inspect', 4]]);
    await update({ hour: 2.5 });
    const input = find('TextInput', 'Scheduled launch drones');
    assert.ok(input, 'selection survives refreshed order data');
    await flush(() => input.props.onChangeText('15'));
    await press('Save launch manifest');
    assert.deepEqual(calls.at(-1), ['edit', { planId: 'first', drones: 15 }]);
    await press('Cancel scheduled order: Beta → Alpha');
    assert.deepEqual(calls.at(-1), ['cancel', 'first']);
    await update({ plans: [] });
    assert.equal(find('TextInput', 'Scheduled launch drones'), undefined);
  });
});

test('collapsing the queue and canceling a row never changes the inspected time', async () => {
  await withQueue(async ({ calls, find, press }) => {
    await press('Hide scheduled orders');
    assert.equal(find('Pressable', 'Inspect scheduled order: Beta → Alpha'), undefined);
    await press('Show scheduled orders');
    await press('Cancel scheduled order: Beta → Alpha');
    assert.deepEqual(calls, [['cancel', 'first']]);
    assert.equal(find('TextInput', 'Scheduled launch drones'), undefined);
  });
});

test('teammate and historical launches remain inspectable with read-only manifests', async () => {
  await withQueue(async ({ calls, find, press, update, renderer }) => {
    await update({ plans: [{ id: 'ally', owner: 'vesper', from: 'a', to: 'b', drones: 9, executeAt: 6 }] });
    await press('Inspect scheduled order: Alpha → Beta');
    assert.deepEqual(calls, [['inspect', 6]]);
    assert.equal(find('TextInput', 'Scheduled launch drones').props.editable, false);
    assert.equal(find('Pressable', 'Save launch manifest').props.disabled, true);
    assert.equal(find('Pressable', 'Cancel scheduled order: Alpha → Beta').props.disabled, true);
    await update({ owner: 'vesper', disabled: true });
    assert.equal(find('TextInput', 'Scheduled launch drones').props.editable, false);
    assert.equal(find('Pressable', 'Save launch manifest').props.disabled, true);
    const rows = renderer.root.findAll((node: any) => node.type === 'Pressable' && node.props.accessibilityLabel?.startsWith('Inspect scheduled order:'));
    assert.equal(rows.length, 1);
  });
});
