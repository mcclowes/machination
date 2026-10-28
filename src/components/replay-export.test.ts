import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import type { SharedReplay } from '../replay/timeline';
const require = createRequire(import.meta.url);
const React = require('react');
const { create, act } = require('react-test-renderer');
function fixture(from = 0, through = 2): SharedReplay {
  const scene = (hour: number) => ({ hour, rocks: [], fleets: [], coverage: [], cargo: {}, eliminated: [], winner: null });
  return { kind: 'machination.observed-timeline', schemaVersion: 1, presentationVersion: 1, history: 'canonical-events', perspective: 'you', from, through,
    groups: [{ hour: from, states: [scene(from)] }, ...(through > from ? [{ hour: through, states: [scene(through)] }] : [])],
    spans: through > from ? [{ from, through, scene: scene(from) }] : [] };
}
// Real React effects and handlers, with file/device hosts replaced before loading.
test('export requires disclosure, preserves gesture and bytes, and rejects stale lifecycle work', async () => {
  const globals = globalThis as typeof globalThis & Record<string, any>;
  const priorAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer: any, gesture = false, saves = 0, calls = 0, forbidden = 0;
  let saveResult: () => Promise<string> = async () => 'saved';
  let source: (from: number, through: number) => SharedReplay | Promise<SharedReplay> = fixture;
  const saved: { raw: string; name: string }[] = [];
  globals.__replayExportTest = { os: 'web', save(raw: string, name: string) { assert.equal(gesture, true); saves++; saved.push({ raw, name }); return saveResult(); }, forbidden() { forbidden++; throw Error('Forbidden I/O'); } };
  const originalFetch = globalThis.fetch;
  try {
    const output = await build({ entryPoints: [new URL('./ReplayExport.tsx', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.png': 'dataurl' }, plugins: [{ name: 'hosts', setup(builder) {
      builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
      builder.onResolve({ filter: /replay\/files$/ }, () => ({ path: 'files', namespace: 'hosts' }));
      builder.onResolve({ filter: /^(react-native|react-native-svg)$/ }, args => ({ path: args.path, namespace: 'hosts' }));
      builder.onResolve({ filter: /(?:\/online\/|\/hooks\/|\/Operation$|^expo-)/ }, () => ({ path: 'forbidden', namespace: 'hosts' }));
      builder.onLoad({ filter: /.*/, namespace: 'hosts' }, args => ({ contents: args.path === 'files' ? 'export const saveSharedReplay=(...args)=>globalThis.__replayExportTest.save(...args);' : args.path === 'react-native' ? `export const View='View',Text='Text',Image='Image',TextInput='TextInput',Pressable='Pressable'; export const StyleSheet={create:x=>x}; export const Platform={get OS(){return globalThis.__replayExportTest.os}};` : args.path === 'react-native-svg' ? `export default 'Svg'; export const Circle='Circle',Path='Path';` : 'globalThis.__replayExportTest.forbidden();' }));
    } }] });
    const { ReplayExport } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`);
    globalThis.fetch = globals.__replayExportTest.forbidden;
    const props = { historyStart: 0, hour: 2, createReplay(from: number, through: number) { calls++; return source(from, through); } };
    const flush = async (fn: () => void) => { await act(async () => { fn(); await Promise.resolve(); }); };
    const hosts = (type: string) => renderer.root.findAll((node: any) => node.type === type);
    const button = (label: string) => hosts('Pressable').find((node: any) => node.props.accessibilityLabel === label);
    const press = async (label: string) => { await flush(() => { gesture = true; try { button(label).props.onPress(); } finally { gesture = false; } }); };
    const visible = (): string => { const read = (node: any): string => typeof node === 'string' ? node : node.children.map(read).join(''); return read(renderer.root); };
    const change = (index: number, value: string) => flush(() => hosts('TextInput')[index].props.onChangeText(value));
    await flush(() => { renderer = create(React.createElement(ReplayExport, props)); });
    assert.equal(calls, 0); assert.equal(saves, 0); assert.equal(button('Save replay'), undefined);
    const original = fixture(); source = () => original;
    await press('Prepare replay'); assert.equal(calls, 1); assert.equal(saves, 0);
    assert.match(visible(), /Recipients can inspect and redistribute/); assert.match(visible(), /Included interval: 0 through 2/); assert.match(visible(), /Visible event boundaries: 2/);
    assert.ok(hosts('Image').length > 0);
    original.perspective = 'vesper'; original.groups[0]!.states[0]!.cargo.you = 99;
    await flush(() => renderer.update(React.createElement(ReplayExport, { ...props, hour: 8 })));
    await press('Save replay'); assert.equal(JSON.parse(saved[0]!.raw).perspective, 'you'); assert.deepEqual(JSON.parse(saved[0]!.raw).groups[0].states[0].cargo, {});
    assert.match(saved[0]!.name, /^machination-replay-0-2\.json$/); assert.match(visible(), /File handed to this device/);
    await change(1, '3'); assert.equal(button('Save replay'), undefined); assert.equal(button('Prepare replay').props.disabled, true);
    await change(1, '1'); source = fixture; await press('Prepare replay');
    assert.match(visible(), /Included interval: 0 through 1/); await press('Save replay');
    assert.equal(JSON.parse(saved[saved.length - 1]!.raw).through, 1);
    await press('Cancel'); assert.equal(button('Save replay'), undefined);
    for (const invalid of ['', 'NaN', 'Infinity', '-1', '9']) { await change(0, invalid); assert.equal(button('Prepare replay').props.disabled, true); }
    await change(0, '0');
    let resolve!: (value: SharedReplay) => void;
    source = () => new Promise(done => { resolve = done; });
    const before = calls;
    await flush(() => { const handler = button('Prepare replay').props.onPress; handler(); handler(); }); assert.equal(calls, before + 1);
    await change(1, '2'); await flush(() => resolve(fixture(0, 1))); assert.equal(button('Save replay'), undefined);
    await press('Prepare replay'); await press('Cancel'); await flush(() => resolve(fixture())); assert.equal(button('Save replay'), undefined);
    source = () => { throw Error('secret file:///private/token'); }; await press('Prepare replay'); assert.match(visible(), /could not be prepared/); assert.doesNotMatch(visible(), /secret|private\/token/);
    source = () => Promise.reject({ code: 'replay-capacity', message: 'secret' }); await press('Prepare replay'); assert.match(visible(), /Choose a shorter interval/);
    source = () => fixture(0, 1); await press('Prepare replay'); assert.equal(button('Save replay'), undefined);
    source = fixture; await press('Prepare replay');
    let finishSave!: (value: string) => void;
    saveResult = () => new Promise(done => { finishSave = done; });
    const beforeSave = saves;
    await flush(() => { gesture = true; try { const handler = button('Save replay').props.onPress; handler(); handler(); } finally { gesture = false; } }); assert.equal(saves, beforeSave + 1);
    await press('Cancel'); await flush(() => finishSave('saved')); assert.equal(button('Save replay'), undefined); assert.doesNotMatch(visible(), /File handed/);
    saveResult = async () => { throw Error('secret path'); }; await press('Prepare replay'); await press('Save replay'); assert.equal(button('Save replay'), undefined); assert.doesNotMatch(visible(), /secret path/);
    saveResult = async () => 'cancelled'; await press('Prepare replay'); await press('Save replay'); assert.equal(button('Save replay'), undefined);
    globals.__replayExportTest.os = 'ios'; saveResult = async () => 'saved'; await press('Prepare replay'); await press('Save replay'); assert.match(visible(), /Share sheet closed/);
    await flush(() => renderer.update(React.createElement(ReplayExport, { ...props, historyStart: 1 }))); assert.equal(button('Save replay'), undefined);
    await change(0, '1'); source = () => new Promise(done => { resolve = done; }); await press('Prepare replay');
    await flush(() => renderer.unmount()); renderer = undefined; await flush(() => resolve(fixture(1, 2)));
    await flush(() => { renderer = create(React.createElement(ReplayExport, props)); });
    source = fixture; await press('Prepare replay');
    await flush(() => renderer.update(React.createElement(ReplayExport, { ...props, disabled: true })));
    const blockedSaves = saves; await press('Save replay'); assert.equal(saves, blockedSaves);
    await flush(() => renderer.update(React.createElement(ReplayExport, props)));
    saveResult = () => new Promise(done => { finishSave = done; }); await press('Save replay');
    await flush(() => renderer.unmount()); renderer = undefined; await flush(() => finishSave('saved'));
    assert.equal(forbidden, 0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    globalThis.fetch = originalFetch; delete globals.__replayExportTest;
    if (priorAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', priorAct); else delete globals.IS_REACT_ACT_ENVIRONMENT;
  }
});
