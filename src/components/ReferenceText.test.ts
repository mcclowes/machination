import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import type { ObjectReference } from '../contracts/protocol';
import { encodeObjectReference } from '../online/object-references';

// Replace native host views, retaining the real component and its event handlers.
async function loadReferenceText() {
  const output = await build({
    entryPoints: [new URL('./ReferenceText.tsx', import.meta.url).pathname],
    bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'native-hosts', setup(builder) {
      builder.onResolve({ filter: /^expo-clipboard$/ }, () => ({ path: 'clipboard', namespace: 'clipboard-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'clipboard-test' }, () => ({ contents: 'export const setStringAsync=async () => true;' }));
      builder.onResolve({ filter: /^react-native$/ }, () => ({ path: 'native-hosts', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const View="View", Text="Text", Pressable="Pressable", StyleSheet={create: value => value};' }));
    } }],
  });
  return (await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`)).ReferenceText;
}

type Element = { type: string; props: { children?: unknown; onPress?: () => void; selectable?: boolean; accessibilityLabel?: string; value?: string } };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}

const reference: ObjectReference = { version: 1, gameId: 'a'.repeat(24), kind: 'hauler', ref: 'b'.repeat(64), hour: 1e-300 };

test('inspection is explicit and readable while forwarding preserves the exact reference', async () => {
  const ReferenceText = await loadReferenceText();
  const text = `Contact ${encodeObjectReference(reference)} <b>literal</b>`;
  const calls: unknown[] = [];
  const rendered = elements(ReferenceText({ text, onInspect: (...args: unknown[]) => calls.push(args) }));
  assert.deepEqual(calls, []);
  const shown = rendered.find(node => node.type === 'Text' && node.props.selectable)?.props.children as string;
  assert.match(shown, /Contact.*hauler.*<b>literal<\/b>/);
  assert.ok(!shown.includes(reference.ref), 'Opaque wire identity stays out of readable chat');
  assert.equal(rendered.find(node => node.props.value)?.props.value, encodeObjectReference(reference));
  const buttons = rendered.filter(node => node.type === 'Pressable');
  assert.equal(buttons.length, 2);
  assert.match(buttons[0]!.props.accessibilityLabel!, /copied hour 1e-300/);
  buttons[0]!.props.onPress!();
  buttons[1]!.props.onPress!();
  assert.deepEqual(calls, [[reference, 'observed'], [reference, 'now']]);
});

test('missing inspection callbacks and malformed tokens remain raw selectable text', async () => {
  const ReferenceText = await loadReferenceText();
  for (const props of [{ text: encodeObjectReference(reference) }, { text: '[[machination:v99:bad]] https://example.com', onInspect: () => assert.fail('No inspection during render') }]) {
    const rendered = elements(ReferenceText(props));
    assert.equal(rendered.filter(node => node.type === 'Pressable').length, 0);
    assert.equal(rendered.find(node => node.type === 'Text' && node.props.selectable)?.props.children, props.text);
  }
});
