import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expoPushProvider, pushConfiguration } from './expo-push';
import type { PushMessage } from './notifications';

type Handler = (body: unknown, req: IncomingMessage, res: ServerResponse) => void;
async function standIn(t: TestContext) {
  const seen: { path: string; body: unknown; authorization?: string }[] = [];
  let handler: Handler = (_b, _q, res) => res.end('{}');
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    seen.push({ path: req.url!, body, authorization: req.headers.authorization });
    handler(body, req, res);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { seen, endpoints: { send: `${base}/send`, receipts: `${base}/receipts` }, handle: (next: Handler) => { handler = next; } };
}
const message = (to: string): PushMessage => ({ to, title: 'Machination', body: 'New transmission received.', channelId: 'machination-messages', collapseId: 'a'.repeat(32), tag: 'a'.repeat(32), ttl: 60,
  data: { kind: 'machination.message', version: 1, gameId: 'b'.repeat(24), bindingId: 'c'.repeat(32), notificationId: 'a'.repeat(32) } });
const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };

test('operator configuration is off by default and only an explicit 1 enables delivery', () => {
  assert.deepEqual(pushConfiguration({}), { enabled: false });
  assert.deepEqual(pushConfiguration({ MACHINATION_PUSH_ENABLED: '0', EXPO_ACCESS_TOKEN: 'ignored' }), { enabled: false });
  assert.deepEqual(pushConfiguration({ MACHINATION_PUSH_ENABLED: '1' }), { enabled: true });
  assert.deepEqual(pushConfiguration({ MACHINATION_PUSH_ENABLED: ' 1 ', EXPO_ACCESS_TOKEN: ' secret ' }), { enabled: true, accessToken: 'secret' });
  for (const value of ['true', 'yes', '2']) assert.throws(() => pushConfiguration({ MACHINATION_PUSH_ENABLED: value }), /must be 1/);
});

test('sends an array batch over HTTP and maps ok, per-message error, and malformed tickets in order', async t => {
  const { seen, endpoints, handle } = await standIn(t);
  const provider = expoPushProvider({ endpoints, accessToken: 'expo-access' });
  handle((_b, _q, res) => json(res, 200, { data: [{ status: 'ok', id: 'r1' }, { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } }, { status: 'ok' }] }));
  const sent = await provider.send([message('ExponentPushToken[a]'), message('ExponentPushToken[b]'), message('ExponentPushToken[c]')], new AbortController().signal);
  assert.deepEqual(sent, { kind: 'tickets', tickets: [{ status: 'ok', id: 'r1' }, { status: 'error', error: 'DeviceNotRegistered' }, { status: 'malformed' }] });
  assert.equal(seen[0]!.path, '/send'); assert.equal(seen[0]!.authorization, 'Bearer expo-access');
  assert.ok(Array.isArray(seen[0]!.body)); assert.equal((seen[0]!.body as PushMessage[])[0]!.collapseId, 'a'.repeat(32));

  handle((_b, _q, res) => json(res, 200, { data: { status: 'ok', id: 'single' } }));
  assert.deepEqual(await provider.send([message('ExponentPushToken[a]')], new AbortController().signal), { kind: 'tickets', tickets: [{ status: 'ok', id: 'single' }] });
  handle((_b, _q, res) => json(res, 200, { data: [{ status: 'ok', id: 'only-one' }] }));
  assert.deepEqual(await provider.send([message('ExponentPushToken[a]'), message('ExponentPushToken[b]')], new AbortController().signal), { kind: 'retry', reason: 'malformed' });
  const unauthenticated = expoPushProvider({ endpoints });
  await unauthenticated.send([message('ExponentPushToken[a]')], new AbortController().signal);
  assert.equal(seen.at(-1)!.authorization, undefined);
});

test('request failures distinguish retryable, rejected, malformed, network, and aborted outcomes', async t => {
  const { endpoints, handle } = await standIn(t);
  const provider = expoPushProvider({ endpoints, timeoutMs: 200 });
  const signal = new AbortController().signal;
  const batch = [message('ExponentPushToken[a]')];
  handle((_b, _q, res) => json(res, 429, { errors: [{ code: 'TOO_MANY_REQUESTS', message: 'slow' }] }, { 'retry-after': '7' }));
  assert.deepEqual(await provider.send(batch, signal), { kind: 'retry', reason: 'TOO_MANY_REQUESTS', retryAfterMs: 7000 });
  handle((_b, _q, res) => json(res, 503, {}));
  assert.deepEqual(await provider.send(batch, signal), { kind: 'retry', reason: 'http_503' });
  handle((_b, _q, res) => json(res, 400, { errors: [{ code: 'PUSH_TOO_MANY_NOTIFICATIONS', message: 'x' }] }));
  assert.deepEqual(await provider.send(batch, signal), { kind: 'reject', reason: 'PUSH_TOO_MANY_NOTIFICATIONS' });
  handle((_b, _q, res) => { res.writeHead(200); res.end('not json'); });
  assert.deepEqual(await provider.send(batch, signal), { kind: 'retry', reason: 'malformed' });
  handle(() => undefined);
  assert.deepEqual(await provider.send(batch, signal), { kind: 'retry', reason: 'network' }, 'timeouts are retryable');
  const controller = new AbortController(); controller.abort();
  assert.deepEqual(await provider.send(batch, controller.signal), { kind: 'retry', reason: 'aborted' });
  assert.deepEqual(await expoPushProvider({ endpoints: { send: 'http://127.0.0.1:1/x', receipts: 'http://127.0.0.1:1/y' } }).send(batch, signal), { kind: 'retry', reason: 'network' });
});

test('receipts request at most the claimed IDs and omit missing or malformed entries', async t => {
  const { seen, endpoints, handle } = await standIn(t);
  const provider = expoPushProvider({ endpoints });
  handle((_b, _q, res) => json(res, 200, { data: { r1: { status: 'ok' }, r2: { status: 'error', details: { error: 'MessageRateExceeded' } }, r3: 'junk', other: { status: 'ok' } } }));
  assert.deepEqual(await provider.receipts(['r1', 'r2', 'r3', 'r4'], new AbortController().signal),
    { kind: 'receipts', receipts: { r1: { status: 'ok' }, r2: { status: 'error', error: 'MessageRateExceeded' } } });
  assert.deepEqual(seen[0]!.body, { ids: ['r1', 'r2', 'r3', 'r4'] }); assert.equal(seen[0]!.path, '/receipts');
  handle((_b, _q, res) => json(res, 200, { data: [] }));
  assert.deepEqual(await provider.receipts(['r1'], new AbortController().signal), { kind: 'retry', reason: 'malformed' });
});
