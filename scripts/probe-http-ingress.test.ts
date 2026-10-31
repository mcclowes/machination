import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApi } from '../server/http';
import { GameService } from '../server/service';
import { probeIngress, requireNativeFamily, type ProbeRequest } from './probe-http-ingress';

async function edge(t: TestContext, mode: 'direct' | 'railway' = 'railway', overwrite = true) {
  const directory = await mkdtemp(join(tmpdir(), 'machination-ingress-probe-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const api = createApi(await GameService.open(join(directory, 'games.json')), undefined, undefined, { clientIp: mode });
  await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => api.close(error => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  const calls: { family: number; path: string }[] = [];
  // Only this edge adapter is synthetic; the HTTP limiter and JSON failures are real.
  const request: ProbeRequest = async (family, path, headers = {}) => {
    calls.push({ family, path });
    const response = await fetch(base + path, { headers: {
      ...headers,
      ...(overwrite || !headers['X-Real-IP'] ? { 'X-Real-IP': family === 4 ? '192.0.2.1' : '2001:db8::1' } : {}),
    } });
    return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.json() };
  };
  return { request, calls };
}

test('ingress acceptance proves separate budgets, spoof refusal, and health without touching game routes', async t => {
  const { request, calls } = await edge(t);
  const result = await probeIngress(request, { dualStack: true });
  assert.equal(result.checksPassed, true);
  assert.equal(calls.length, 131);
  assert.ok(calls.every(call => call.path === '/health' || /^\/v1\/ingress-probe-[a-f0-9-]+$/.test(call.path)));
  assert.equal(new Set(calls.filter(call => call.path !== '/health').map(call => call.path)).size, 1);
  assert.equal(result.probePath, calls.find(call => call.path !== '/health')!.path);
  assert.equal(result.allowedBeforeLimit, 120);
  assert.equal(result.spoofRefusals, 4);
});

test('the CLI defaults to a no-network plan and refuses credentials or non-origin URLs', async () => {
  const exec = promisify(execFile);
  const script = join(import.meta.dirname, 'probe-http-ingress.ts');
  const plan = await exec(process.execPath, ['--import', 'tsx', script, '--origin=https://unresolvable.invalid']);
  assert.equal(JSON.parse(plan.stdout).execution, 'not requested');
  assert.equal(JSON.parse(plan.stdout).maxRequests, 128);
  assert.match(JSON.parse(plan.stdout).effect, /throttle ALL players/);
  for (const origin of ['http://example.com', 'https://secret:credential@example.com', 'https://example.com/private', 'https://example.com/?token=secret', 'https://example.com/#secret']) {
    await assert.rejects(exec(process.execPath, ['--import', 'tsx', script, `--origin=${origin}`]), error => {
      const result = error as Error & { stderr: string };
      assert.match(result.stderr, /HTTPS origin/);
      assert.ok(!result.stderr.includes('secret'));
      return true;
    });
  }
  await assert.rejects(exec(process.execPath, ['--import', 'tsx', script, '--execute', '--preflight']), error => {
    assert.match((error as Error & { stderr: string }).stderr, /one execution mode/);
    return true;
  });
});

test('a shared proxy budget cannot produce a passing ingress result', async t => {
  const { request } = await edge(t, 'direct');
  await assert.rejects(probeIngress(request, { dualStack: true }), /Expected Machination 404/);
});

test('caller-controlled client IP headers cannot produce a passing ingress result', async t => {
  const { request, calls } = await edge(t, 'railway', false);
  await assert.rejects(probeIngress(request), /Expected Machination 429/);
  assert.equal(calls.length, 123);
});

test('a partially consumed budget stops the probe before claiming a clean acceptance window', async t => {
  const { request, calls } = await edge(t);
  await request(4, '/missing');
  await assert.rejects(probeIngress(request), /Expected Machination 404/);
  assert.equal(calls.length, 122);
});

test('a slow response crossing the deadline cannot be accepted as a new window', async t => {
  const { request, calls } = await edge(t);
  let now = 0;
  await assert.rejects(probeIngress(async (...args) => {
    const response = await request(...args);
    if (calls.length === 10) now = 45_000;
    return response;
  }, { clock: () => now }), /45 seconds/);
  assert.equal(calls.length, 10);
});

test('single-source acceptance remains useful without claiming independent budgets', async t => {
  const { request, calls } = await edge(t);
  const result = await probeIngress(request);
  assert.equal(result.checksPassed, true);
  assert.equal(result.independentBudget, 'unverified');
  assert.equal(calls.length, 128);
  assert.ok(calls.every(call => call.family === 4));
});

test('IPv4-mapped sockets and missing addresses cannot masquerade as a native IPv6 witness', () => {
  const native = { localFamily: 'IPv6', remoteFamily: 'IPv6', localAddress: '2001:db8::1', remoteAddress: '2001:db8::2' };
  requireNativeFamily(6, native);
  requireNativeFamily(4, { localFamily: 'IPv4', remoteFamily: 'IPv4', localAddress: '192.0.2.1', remoteAddress: '192.0.2.2' });
  for (const address of ['::ffff:192.0.2.1', '0:0:0:0:0:ffff:c000:201', undefined]) {
    assert.throws(() => requireNativeFamily(6, { ...native, localAddress: address }), /native IPv6/);
    assert.throws(() => requireNativeFamily(6, { ...native, remoteAddress: address }), /native IPv6/);
  }
  assert.throws(() => requireNativeFamily(4, native), /native IPv4/);
});

test('proxy-generated throttles and invalid retry metadata do not certify the application limiter', async t => {
  for (const damaged of ['body', 'correlation', 'retry'] as const) {
    const { request } = await edge(t);
    await assert.rejects(probeIngress(async (...args) => {
      const response = await request(...args);
      if (response.status === 429) {
        if (damaged === 'body') response.body = { error: 'proxy throttle' };
        else response.headers[damaged === 'retry' ? 'retry-after' : 'x-correlation-id'] = '0';
      }
      return response;
    }), /ingress acceptance failed|valid Retry-After/);
  }
});

test('CLI preflight never accepts an untrusted TLS server even when the caller disables Node TLS defaults', async t => {
  const exec = promisify(execFile);
  const directory = await mkdtemp(join(tmpdir(), 'machination-ingress-tls-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-subj', '/CN=localhost']);
  const server = createHttpsServer({ key: await readFile(join(directory, 'key.pem')), cert: await readFile(join(directory, 'cert.pem')) }, (_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ status: 'ok' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  await assert.rejects(exec(process.execPath, ['--import', 'tsx', join(import.meta.dirname, 'probe-http-ingress.ts'), `--origin=https://127.0.0.1:${(server.address() as AddressInfo).port}`, '--preflight'], { env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' } }), error => {
    assert.match((error as Error & { stderr: string }).stderr, /HTTPS probe failed/);
    return true;
  });
});
