import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { checkReplayText, ReplayFileError } from './file-errors';
import { SHARED_REPLAY_LIMITS } from './timeline';
import * as web from './files.web';

const limit = SHARED_REPLAY_LIMITS.bytes;
const isCode = (code: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === code;

test('UTF-8 limit includes multibyte characters and accepts the exact boundary', () => {
  checkReplayText('a'.repeat(limit));
  assert.throws(() => checkReplayText('😀'.repeat(limit / 4) + 'a'), isCode('oversize'));
});

test('web user actions reject before read, handle cancellation, and clean download URLs', async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let input: any;
  let reads = 0;
  let removed = 0;
  let clicked = 0;
  const revoked: string[] = [];
  const downloads: any[] = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    body: { appendChild() {} },
    createElement(tag: string) {
      const element = { remove() { removed++; }, click() { clicked++; } };
      if (tag === 'input') input = element;
      else downloads.push(element);
      return element;
    },
  } });
  URL.createObjectURL = blob => { assert.equal((blob as Blob).size, 2); return 'blob:test'; };
  URL.revokeObjectURL = url => { revoked.push(url); };
  try {
    const tooLarge = web.pickSharedReplay();
    assert.equal(clicked, 1); // Picker activation happens synchronously in the gesture.
    input.files = [{ size: limit + 1, text() { reads++; } }];
    await input.onchange();
    await assert.rejects(tooLarge, isCode('oversize'));
    assert.equal(reads, 0);
    const canceled = web.pickSharedReplay();
    input.oncancel();
    assert.equal(await canceled, null);
    const changedSize = web.pickSharedReplay();
    input.files = [{ size: 1, async text() { return 'a'.repeat(limit + 1); } }];
    await input.onchange();
    await assert.rejects(changedSize, isCode('oversize'));
    assert.equal(await web.saveSharedReplay('{}', '../../bad.json'), 'saved');
    assert.match(downloads[0].download, /^[a-zA-Z0-9_-]+\.json$/);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(revoked, ['blob:test']);
    assert.equal(removed, 4);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test('native local import and sharing enforce boundaries and cleanup without native UI', async () => {
  const state: any = { available: true, size: 2, raw: '{}', deletes: 0, reads: 0, shares: 0 };
  const built = await build({ entryPoints: ['src/replay/files.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{
    name: 'native-test-boundary',
    setup(builder) {
      builder.onResolve({ filter: /^expo-/ }, args => ({ path: args.path, namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'expo-document-picker'
        ? 'export const getDocumentAsync = async options => { state.options = options; return state.result; };'
        : args.path === 'expo-crypto' ? 'export const randomUUID = () => "unique";'
        : args.path === 'expo-sharing' ? 'export const isAvailableAsync = async () => state.available; export const shareAsync = async () => { state.shares++; if(state.shareError) throw Error("private/path"); };'
        : `export const Paths = { cache: {uri: 'file:///cache/'} };
           export class Directory { exists = true; constructor(...args) {state.directory = args;} create() {} delete() {state.deletes++; if(state.cleanupError) throw Error('private/path');} }
           export class File { uri = 'file:///cache/generated.json'; exists = true; get size() {return state.size;} constructor(...args) {state.file = args;} create() {} write(raw) {state.written = raw;} async text() {state.reads++; return state.raw;} delete() {state.deletes++; if(state.cleanupError) throw Error('private/path');} }`, loader: 'js' }));
    },
  }] });
  const module = { exports: {} as any };
  new Function('module', 'state', built.outputFiles[0]!.text)(module, state);
  const native = module.exports;
  state.result = { canceled: true };
  assert.equal(await native.pickSharedReplay(), null);
  state.result = { canceled: false, assets: [{ uri: 'https://example.com/replay' }] };
  await assert.rejects(native.pickSharedReplay(), isCode('io'));
  assert.equal(state.reads, 0);
  state.result.assets[0] = { uri: 'file:///cache/picked.json', size: limit + 1 };
  await assert.rejects(native.pickSharedReplay(), isCode('oversize'));
  assert.equal(state.reads, 0);
  assert.equal(state.deletes, 1);
  state.result.assets[0].size = 2;
  state.size = limit + 1;
  await assert.rejects(native.pickSharedReplay(), isCode('oversize'));
  assert.equal(state.reads, 0);
  state.size = 2;
  assert.equal(await native.pickSharedReplay(), '{}');
  assert.equal(state.options.copyToCacheDirectory, true);
  state.raw = 'a'.repeat(limit + 1);
  await assert.rejects(native.pickSharedReplay(), isCode('oversize'));
  state.available = false;
  await assert.rejects(native.saveSharedReplay('{}', 'test'), isCode('unavailable'));
  assert.equal(state.shares, 0);
  state.available = true;
  assert.equal(await native.saveSharedReplay('{}', '../test'), 'saved');
  assert.equal(state.written, '{}');
  assert.match(state.file[1], /^[a-zA-Z0-9_-]+\.json$/);
  state.shareError = true;
  await assert.rejects(native.saveSharedReplay('{}', 'test'), (error: any) => error.code === 'io' && !error.message.includes('private'));
  state.shareError = false;
  state.cleanupError = true;
  await assert.rejects(native.saveSharedReplay('{}', 'test'), isCode('io'));
});
