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
