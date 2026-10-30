import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createApi } from './http';
import { GameService } from './service';

async function start(t: TestContext, options?: Parameters<typeof createApi>[3]) {
  const directory = await mkdtemp(join(tmpdir(), 'machination-http-limits-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const api = createApi(await GameService.open(join(directory, 'games.json')), undefined, undefined, options);
  await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => api.close(error => error ? reject(error) : resolve())));
  return `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
}

test('health probes stay available without spending or depending on the gameplay request budget', async t => {
  const base = await start(t);
  for (let i = 0; i < 125; i++) {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  }
  for (let i = 0; i < 120; i++) {
    const response = await fetch(`${base}/missing`);
    await response.arrayBuffer();
    assert.equal(response.status, 404);
  }
  const throttled = await fetch(`${base}/missing`);
  assert.equal(throttled.status, 429);
  assert.equal((await throttled.json()).issues[0].issue, 'request.rate_limit.exceeded');
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
});

test('Railway ingress clients have independent budgets and forwarding chains cannot choose a bucket', async t => {
  const base = await start(t, { clientIp: 'railway' });
  for (let i = 0; i < 120; i++) {
    const response = await fetch(`${base}/missing`, { headers: { 'X-Real-IP': '192.0.2.1' } });
    await response.arrayBuffer();
    assert.equal(response.status, 404);
  }
  const throttled = await fetch(`${base}/missing`, { headers: { 'X-Real-IP': '192.0.2.1', 'X-Forwarded-For': '192.0.2.99' } });
  assert.equal(throttled.status, 429);
  assert.equal((await throttled.json()).issues[0].issue, 'request.rate_limit.exceeded');
  const other = await fetch(`${base}/missing`, { headers: { 'X-Real-IP': '192.0.2.2' } });
  await other.arrayBuffer();
  assert.equal(other.status, 404);
});

test('direct connections ignore client-supplied forwarding headers', async t => {
  const base = await start(t);
  for (let i = 0; i < 120; i++) {
    const response = await fetch(`${base}/missing`, { headers: { 'X-Real-IP': `192.0.2.${i + 1}`, 'X-Forwarded-For': `192.0.2.${i + 1}` } });
    await response.arrayBuffer();
    assert.equal(response.status, 404);
  }
  const response = await fetch(`${base}/missing`, { headers: { 'X-Real-IP': '198.51.100.1', Forwarded: 'for=198.51.100.2' } });
  assert.equal(response.status, 429);
  await response.arrayBuffer();
});

test('missing, malformed, and duplicate trusted headers share the direct-peer fallback budget', async t => {
  const base = await start(t, { clientIp: 'railway' });
  for (let i = 0; i < 120; i++) {
    const response = await fetch(`${base}/missing`);
    await response.arrayBuffer();
    assert.equal(response.status, 404);
  }
  for (const address of ['', 'unknown', '192.0.2.1, 192.0.2.2', '192.0.2.1:8080', '::1%lo0', '[2001:db8::1]', '999.1.2.3']) {
    const response = await fetch(`${base}/missing`, { headers: { 'X-Real-IP': address, 'X-Forwarded-For': '198.51.100.1' } });
    assert.equal(response.status, 429, address);
    await response.arrayBuffer();
  }
  await new Promise<void>((resolve, reject) => {
    const incoming = request(`${base}/missing`, { headers: { 'X-Real-IP': ['192.0.2.1', '192.0.2.1'] } }, response => {
      response.resume();
      response.on('end', () => {
        try { assert.equal(response.statusCode, 429); resolve(); } catch (error) { reject(error); }
      });
    });
    incoming.on('error', reject);
    incoming.end();
  });
});

test('equivalent IPv6 spellings and IPv4-mapped addresses cannot multiply budgets', async t => {
  for (const [primary, alias] of [
    ['2001:db8::ab', '2001:0DB8:0000:0000:0000:0000:0000:00AB'],
    ['192.0.2.1', '::ffff:c000:201'],
    ['::ffff:192.0.2.2', '192.0.2.2'],
  ] as const) {
    const base = await start(t, { clientIp: 'railway' });
    for (let i = 0; i < 120; i++) {
      const response = await fetch(`${base}/missing`, { headers: { 'X-Real-IP': primary } });
      await response.arrayBuffer();
      assert.equal(response.status, 404);
    }
    const response = await fetch(`${base}/missing`, { headers: { 'X-Real-IP': alias } });
    assert.equal(response.status, 429, alias);
    await response.arrayBuffer();
  }
});

test('rate-limit retries report the remaining window and expose it to an allowed browser', async t => {
  let now = 0;
  const base = await start(t, { clock: () => now });
  for (let i = 0; i < 120; i++) {
    const response = await fetch(`${base}/missing`);
    await response.arrayBuffer();
    assert.equal(response.status, 404);
  }
  now = 59_500;
  const limited = await fetch(`${base}/missing`, { headers: { Origin: 'http://localhost:8081' } });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '1');
  assert.ok(limited.headers.get('Access-Control-Expose-Headers')?.includes('Retry-After'));
  const failure = await limited.json();
  assert.equal(failure.issues[0].issue, 'request.rate_limit.exceeded');
  assert.equal(failure.issues[0].correlationId, limited.headers.get('X-Correlation-ID'));
  now = 60_000;
  const renewed = await fetch(`${base}/missing`);
  await renewed.arrayBuffer();
  assert.equal(renewed.status, 404);
});

test('health probes retain the browser origin gate', async t => {
  const base = await start(t);
  const refused = await fetch(`${base}/health`, { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).issues[0].issue, 'request.forbidden.origin');
});
