import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import type { Fleet } from '../game/simulation';
import type { HaulerChange } from '../game/transport';

const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
const { create, act } = require('react-test-renderer');

test('navigator orders preserve the route, expose pending timing, and enforce cancellation controls', async () => {
  const priorAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let renderer: any;
  try {
    const output = await build({
      entryPoints: [new URL('./HaulerOrders.tsx', import.meta.url).pathname],
      bundle: true, write: false, platform: 'node', format: 'esm',
      plugins: [{ name: 'navigator-hosts', setup(builder) {
        builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
        builder.onResolve({ filter: /^react-native$/ }, args => ({ path: args.path, namespace: 'navigator-host' }));
        builder.onLoad({ filter: /.*/, namespace: 'navigator-host' }, () => ({ contents: `export const View='View',Text='Text',TextInput='TextInput',Pressable='Pressable',StyleSheet={create:x=>x};` }));
      } }],
    });
    const { HaulerOrders } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`) as typeof import('./HaulerOrders');
    const fleet: Fleet = { id: 42, owner: 'you', from: 'a', to: 'b', drones: 5, departed: 0, arrives: 10,
      specialists: [{ id: 'nav', kind: 'navigator', owner: 'you' }],
      pendingCourse: { owner: 'you', to: 'c', executeAt: 25 / 6 } };
    const commands: HaulerChange[] = [];
    const base = { fleets: [fleet], rocks: [{ id: 'a', name: 'Origin' }, { id: 'b', name: 'Current' }, { id: 'c', name: 'Requested' }], hour: 4, enabled: true, courseDelay: true, onCommand: (command: HaulerChange) => commands.push(command), onNavigate: () => assert.fail('Pending course cannot be replaced') };
    const render = async (overrides: Partial<React.ComponentProps<typeof HaulerOrders>> = {}) => {
      await act(async () => {
        const element = React.createElement(HaulerOrders, { ...base, ...overrides });
        if (renderer) renderer.update(element); else renderer = create(element);
      });
    };
    const text = (node: any): string => typeof node === 'string' ? node : (node.children ?? []).map(text).join('');
    const button = (label: string) => renderer.root.findAll((node: any) => node.type === 'Pressable' && text(node) === label)[0];
    const disabled = (label: string, expected: boolean) => {
      assert.equal(button(label).props.disabled, expected);
      assert.equal(button(label).props.accessibilityState.disabled, expected);
    };
    await render();
    assert.match(text(renderer.root), /Origin → Current/);
    assert.match(text(renderer.root), /Course change requested: Requested · effective D01 · 04:10/);
    assert.match(text(renderer.root), /current course continues/);
    disabled('Change course on chart', true);
    disabled('Cancel course change', false);
    await act(async () => button('Cancel course change').props.onPress());
    assert.deepEqual(commands, [{ action: 'cancel-course', fleet: 42 }]);
    await render({ enabled: false }); disabled('Cancel course change', true);
    await render({ hour: 25 / 6 }); disabled('Cancel course change', true);
    await render({ hour: 5 }); disabled('Cancel course change', true);
    await render({ scheduledAt: 4 });
    disabled('Schedule at D01 · 04:00: Cancel course change', false);
    await act(async () => button('Schedule at D01 · 04:00: Cancel course change').props.onPress());
    assert.deepEqual(commands[1], { action: 'cancel-course', fleet: 42 });
    const { pendingCourse, ...withoutPending } = fleet;
    await render({ fleets: [withoutPending], courseDelay: undefined });
    disabled('Change course on chart', false);
    const cooling = { ...withoutPending, specialists: [{ id: 'nav', owner: 'you' as const, kind: 'navigator' as const, lastCourseAt: 0 }] };
    await render({ fleets: [cooling], hour: 8 - 1 / 6 - 1e-9 });
    disabled('Change course on chart', true);
    await render({ fleets: [cooling], hour: 8 - 1 / 6 });
    disabled('Change course on chart', false);
    await render({ fleets: [cooling], hour: 8 - 1 / 6, courseDelay: false });
    disabled('Change course on chart', true);
    assert.doesNotMatch(text(renderer.root), /Course changes take effect after ten minutes|Course change requested/);
    assert.equal(button('Cancel course change'), undefined);
    assert.match(text(renderer.root), /Course changes take effect immediately, with an eight-hour cooldown/);
    await render({ fleets: [withoutPending] });
    assert.match(text(renderer.root), /Course changes take effect after ten minutes/);
    disabled('Change course on chart', false);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (priorAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', priorAct);
    else delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  }
});
