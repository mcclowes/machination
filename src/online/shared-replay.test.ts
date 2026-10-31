import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportSharedReplay } from './shared-replay';
import { SHARED_REPLAY_LIMITS } from '../replay/timeline';
import { RejectedCommand } from './network';

const session = { url: 'https://example.test', token: 'a'.repeat(64), id: 'b'.repeat(24) };
test('replay requests advertise their decoder and preserve an upgrade refusal', async t => {
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get('Accept'), 'application/vnd.machination.v2+json, application/json');
    return new Response(JSON.stringify({ issues: [{ message: { detail: 'Update Machination.' } }] }), { status: 503 });
  });
  await assert.rejects(exportSharedReplay(session, 0, 0), error => error instanceof Error && !(error instanceof RejectedCommand) && error.message === 'Update Machination.');
});
test('replay client refuses invalid bounds before fetching', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch'); });
  for (const [from, through] of [[NaN, 0], [0, Infinity], [2, 1], [-1, 0]]) {
    await assert.rejects(exportSharedReplay(session, from!, through!), /finite, ordered/);
  }
});
test('replay client checks declared and streamed byte bounds before decoding', async t => {
  let read = false;
  const mock = t.mock.method(globalThis, 'fetch', async () => ({ ok: true,
    headers: new Headers({ 'content-length': String(SHARED_REPLAY_LIMITS.bytes + 1) }),
    text: async () => { read = true; return '{}'; } }) as Response);
  await assert.rejects(exportSharedReplay(session, 0, 0), /byte limit/); assert.equal(read, false);
  // Error responses are independently bounded, including multibyte text.
  mock.mock.mockImplementation(async () => ({ ok: false, headers: new Headers(), text: async () => 'é'.repeat(4097) }) as Response);
  await assert.rejects(exportSharedReplay(session, 0, 0), /byte limit/);
  let canceled = false;
  mock.mock.mockImplementation(async () => ({ ok: false, headers: new Headers(), body: new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(8193)); }, cancel() { canceled = true; },
  }) }) as Response);
  await assert.rejects(exportSharedReplay(session, 0, 0), /byte limit/); assert.equal(canceled, true);
});
test('replay client strictly decodes untrusted JSON and preserves structured refusal', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ game: {}, commands: [{ type: 'launch' }] })));
  await assert.rejects(exportSharedReplay(session, 0, 0), /Invalid shared replay/);
  mock.mock.mockImplementation(async () => new Response(JSON.stringify({ issues: [{ message: { detail: 'Seat required.' } }] }), { status: 401 }));
  await assert.rejects(exportSharedReplay(session, 0, 0), (e: unknown) => e instanceof RejectedCommand && e.status === 401 && e.message === 'Seat required.');
});
