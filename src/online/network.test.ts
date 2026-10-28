import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { api, RejectedCommand } from './network';

test('rate limits preserve uncertain pending commands while definitive rejections can clear them', async t => {
  const server = createServer((req, res) => {
    const status = req.url?.endsWith('rate-limit') ? 429 : 409;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ issues: [{ message: { detail: status === 429 ? 'Try again in a minute.' : 'Order rejected.' } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
  const session = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token: 'local-test-token' };
  await assert.rejects(() => api(session, 'rate-limit', {}), error => error instanceof Error && !(error instanceof RejectedCommand));
  await assert.rejects(() => api(session, 'reject', {}), error => error instanceof RejectedCommand && error.status === 409);
});

test('history uses its own authenticated envelope and requested metadata rather than terminal game hour', async t => {
  const { historicalApi } = await import('./network');
  const session = { url: 'https://belt.example', token: 'seat-secret', id: 'operation' };
  const frame = { id: session.id, faction: 'you', visibility: 'sensors.v1', history: { from: 0, through: 12, at: 10.25 }, game: { scheduled: [], hour: 9 } };
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, 'https://belt.example/v1/games/operation/history?hour=10.25');
    assert.equal(options.method, 'GET');
    assert.equal((options.headers as Record<string, string>).Authorization, 'Bearer seat-secret');
    assert.equal(options.body, undefined);
    return new Response(JSON.stringify(frame), { status: 200 });
  });
  assert.deepEqual(await historicalApi(session, 10.25), frame);
  await assert.rejects(api(session, 'games/operation/history?hour=10.25'), /Unsupported server response/);
  for (const invalid of [
    { ...frame, history: undefined }, { ...frame, id: 'another-operation' },
    { ...frame, history: { from: 11, through: 12, at: 10.25 } },
    { ...frame, history: { from: 0, through: 10, at: 10.25 } },
    { ...frame, history: { from: 0, through: 12, at: 8 } },
    { ...frame, visibility: 'all' }, { ...frame, faction: 'unknown' },
  ]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(invalid)));
    await assert.rejects(historicalApi(session, 10.25), /Unsupported historical/);
  }
});

test('history preserves 401 rejection status and supports caller cancellation', async t => {
  const { historicalApi } = await import('./network');
  const session = { url: 'https://belt.example', token: 'revoked', id: 'operation' };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ issues: [{ message: { detail: 'Seat revoked.' } }] }), { status: 401 }));
  await assert.rejects(historicalApi(session, 1), error => error instanceof RejectedCommand && error.status === 401 && error.message === 'Seat revoked.');
  await assert.rejects(historicalApi(session, Infinity), /finite historical hour/);
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(new Error('Canceled.')));
  }));
  const pending = historicalApi(session, 1, controller.signal);
  controller.abort();
  await assert.rejects(pending, /Canceled/);
});
