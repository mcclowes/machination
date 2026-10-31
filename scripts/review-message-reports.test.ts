import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reviewMessageReports } from './review-message-reports';

const origin = 'https://review.example.test';
const session = 'fixture.header.signature';
const caseId = 'a'.repeat(32);
const summary = { id: caseId, gameId: 'b'.repeat(24), reporter: 'you', author: 'vesper', reason: 'harassment', receivedAt: 1000, status: 'open', revision: 0 };
const detail = { ...summary, target: { kind: 'channel', channelId: 'public', id: 'd'.repeat(32) }, detail: 'Player context', evidence: { from: 'vesper', text: 'Canonical message', sentAt: 900 }, reviews: [] };
const exec = promisify(execFile);
const script = join(import.meta.dirname, 'review-message-reports.ts');

async function httpsFixture(t: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'machination-review-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const certificate = join(directory, 'certificate.pem');
  const key = join(directory, 'key.pem');
  await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', certificate, '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1']);
  const server: Server = createServer({ key: await readFile(key), cert: await readFile(certificate) }, handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  return { certificate, origin: `https://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function runCli(fixture: { certificate: string; origin: string }, command: string, ...options: string[]) {
  return exec(process.execPath, ['--import', 'tsx', script, command, `--origin=${fixture.origin}`, ...options], { timeout: 12_000, env: { ...process.env, NODE_OPTIONS: '', MACHINATION_OPERATOR_SESSION: session, NODE_EXTRA_CA_CERTS: fixture.certificate, NODE_TLS_REJECT_UNAUTHORIZED: '1' } });
}

test('CLI never accepts an untrusted TLS endpoint even when Node TLS defaults are disabled', async t => {
  let requests = 0;
  const fixture = await httpsFixture(t, (_request, response) => {
    requests++;
    response.end(JSON.stringify({ reports: [] }));
  });
  await assert.rejects(exec(process.execPath, ['--import', 'tsx', script, 'list', `--origin=${fixture.origin}`], { env: { ...process.env, NODE_OPTIONS: '', MACHINATION_OPERATOR_SESSION: session, NODE_EXTRA_CA_CERTS: '', NODE_TLS_REJECT_UNAUTHORIZED: '0' } }), error => {
    const failure = error as Error & { stderr: string; stdout: string };
    assert.equal(failure.stdout, '');
    assert.match(failure.stderr, /Operator request failed/);
    assert.ok(!failure.stderr.includes(session));
    return true;
  });
  assert.equal(requests, 0);
});

test('real HTTPS CLI lists, opens, and acknowledges review data without printing its session token', async t => {
  const seen: { method?: string; path?: string; authorization?: string; body: string }[] = [];
  const fixture = await httpsFixture(t, (request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      seen.push({ method: request.method, path: request.url, authorization: request.headers.authorization, body });
      response.setHeader('Content-Type', 'application/json');
      if (request.method === 'POST') {
        const input = JSON.parse(body);
        response.end(JSON.stringify({ ...detail, status: input.status, revision: input.revision + 1, reviews: [{ ...input, actor: 'user_reviewer', revision: input.revision + 1, reviewedAt: 1100 }] }));
      } else response.end(JSON.stringify(request.url?.endsWith(caseId) ? { ...detail, detail: session } : { reports: [summary] }));
    });
  });
  assert.deepEqual(JSON.parse((await runCli(fixture, 'list')).stdout), { reports: [summary] });
  const opened = await runCli(fixture, 'show', `--id=${caseId}`);
  assert.equal(JSON.parse(opened.stdout).detail, '[redacted operator session]');
  assert.ok(!opened.stdout.includes(session));
  const reviewed = await runCli(fixture, 'review', `--id=${caseId}`, '--request-id=operator-review-request-one', '--revision=0', '--status=reviewed', '--note=Reviewed');
  assert.equal(JSON.parse(reviewed.stdout).revision, 1);
  assert.ok(seen.every(request => request.authorization === `Bearer ${session}`));
  assert.deepEqual(seen.map(request => [request.method, request.path]), [['GET', '/v1/operator/message-reports'], ['GET', `/v1/operator/message-reports/${caseId}`], ['POST', `/v1/operator/message-reports/${caseId}`]]);
});

test('real HTTPS CLI caps response data and does not follow redirects or print server errors', async t => {
  let mode = 'large';
  let calls = 0;
  const fixture = await httpsFixture(t, (_request, response) => {
    calls++;
    if (mode === 'large') response.end(JSON.stringify({ privateContent: 'x'.repeat(65_536) }));
    else if (mode === 'redirect') { response.writeHead(302, { Location: `https://untrusted.example.test/${session}` }); response.end('{}'); }
    else { response.writeHead(401); response.end(JSON.stringify({ privateContent: session })); }
  });
  for (mode of ['large', 'redirect', 'refused']) {
    await assert.rejects(runCli(fixture, 'list'), error => {
      const failure = error as Error & { stdout: string; stderr: string };
      assert.equal(failure.stdout, '');
      assert.ok(!failure.stderr.includes(session));
      assert.ok(!failure.stderr.includes('privateContent'));
      assert.match(failure.stderr, mode === 'large' ? /Operator request failed/ : /Operator API refused/);
      return true;
    });
  }
  assert.equal(calls, 3);
});

test('real HTTPS CLI bounds an unfinished response and preserves uncertain-review retry instructions', async t => {
  const fixture = await httpsFixture(t, (_request, response) => { response.writeHead(200); response.write('{'); });
  const started = performance.now();
  await assert.rejects(runCli(fixture, 'list'), error => {
    const failure = error as Error & { stdout: string; stderr: string };
    assert.equal(failure.stdout, '');
    assert.match(failure.stderr, /Reuse the same request ID and payload/);
    assert.ok(!failure.stderr.includes(session));
    return true;
  });
  assert.ok(performance.now() - started < 10_000);
});

test('operator listing sends only the selected bounded query and returns validated summaries', async () => {
  const calls: unknown[] = [];
  const result = await reviewMessageReports(['list', `--origin=${origin}`, '--status=open', `--after=${'c'.repeat(32)}`], session, async (url, request) => {
    calls.push({ url: url.toString(), method: request.method, authorization: request.headers.Authorization, body: request.body });
    return { status: 200, body: { reports: [summary], next: caseId } };
  });
  assert.deepEqual(result, { reports: [summary], next: caseId });
  assert.deepEqual(calls, [{ url: `${origin}/v1/operator/message-reports?status=open&after=${'c'.repeat(32)}`, method: 'GET', authorization: `Bearer ${session}`, body: undefined }]);
});

test('listing refuses oversized, private, or out-of-filter responses rather than printing them', async () => {
  const args = ['list', `--origin=${origin}`, '--status=open'];
  for (const body of [
    { reports: [{ ...summary, status: 'reviewed' }] },
    { reports: [detail] },
    { reports: [], rooms: [{ credential: session }] },
    { reports: Array.from({ length: 26 }, (_, index) => ({ ...summary, id: index.toString(16).padStart(32, '0') })) },
  ]) await assert.rejects(reviewMessageReports(args, session, async () => ({ status: 200, body })), /Unsupported operator response/);
});

test('operator detail is restricted to the requested case and rejects full room data', async () => {
  const args = ['show', `--origin=${origin}`, `--id=${caseId}`];
  const result = await reviewMessageReports(args, session, async (url, request) => {
    assert.equal(url.toString(), `${origin}/v1/operator/message-reports/${caseId}`);
    assert.equal(request.method, 'GET');
    return { status: 200, body: detail };
  });
  assert.deepEqual(result, detail);
  for (const body of [{ ...detail, id: 'e'.repeat(32) }, { ...detail, rooms: [{ credential: 'private-room-state' }] }]) {
    await assert.rejects(reviewMessageReports(args, session, async () => ({ status: 200, body })), /response/);
  }
});

test('review commands send an explicit retry identity and require its durable review receipt', async () => {
  const requestId = 'operator-review-request-one';
  const review = { actor: 'user_reviewer', requestId, revision: 1, status: 'reviewed', note: 'Reviewed without enforcement.', reviewedAt: 1100 };
  const current = { ...detail, status: 'escalated', revision: 2, reviews: [review, { ...review, requestId: 'operator-review-request-two', revision: 2, status: 'escalated', reviewedAt: 1200 }] };
  const args = ['review', `--origin=${origin}`, `--id=${caseId}`, `--request-id=${requestId}`, '--revision=0', '--status=reviewed', `--note=${review.note}`];
  const result = await reviewMessageReports(args, session, async (url, request) => {
    assert.equal(url.toString(), `${origin}/v1/operator/message-reports/${caseId}`);
    assert.equal(request.method, 'POST');
    assert.deepEqual(JSON.parse(request.body!), { requestId, revision: 0, status: 'reviewed', note: review.note });
    return { status: 200, body: current };
  });
  assert.deepEqual(result, current, 'an exact retry may return a later current state');
  for (const reviews of [[], [{ ...review, note: 'Different intent' }], [{ ...review, revision: 2 }]]) {
    await assert.rejects(reviewMessageReports(args, session, async () => ({ status: 200, body: { ...current, reviews } })), /Unsupported operator response/);
  }
});

test('invalid arguments, credential-bearing origins, and oversized requests fail before sending', async () => {
  let calls = 0;
  const send = async () => { calls++; return { status: 200, body: { reports: [] } }; };
  const list = ['list', `--origin=${origin}`];
  const review = ['review', `--origin=${origin}`, `--id=${caseId}`, '--request-id=operator-request-one', '--revision=0', '--status=reviewed', '--note='];
  const invalid: { args: string[]; token?: string }[] = [
    { args: list },
    { args: list, token: 'private-token\r\nInjected: secret' },
    { args: list, token: 'a'.repeat(9000) + '.b.c' },
    ...['http://example.test', 'https://private-token@example.test', `${origin}/path`, `${origin}/?secret=value`, `${origin}/#secret`].map(target => ({ args: ['list', `--origin=${target}`], token: session })),
    { args: [...list, '--token=private-token'], token: session },
    { args: [...list, `--origin=${origin}`], token: session },
    { args: [...list, '--status=unknown'], token: session },
    { args: [...list, '--after=unknown'], token: session },
    { args: ['show', `--origin=${origin}`], token: session },
    { args: review.filter(arg => !arg.startsWith('--request-id=')), token: session },
    { args: review.map(arg => arg === '--revision=0' ? '--revision=1.5' : arg), token: session },
    { args: review.map(arg => arg === '--note=' ? `--note=${'x'.repeat(501)}` : arg), token: session },
  ];
  for (const input of invalid) {
    await assert.rejects(reviewMessageReports(input.args, input.token, send), error => {
      assert.ok(!(error as Error).message.includes('private-token'));
      return true;
    });
    assert.equal(calls, 0);
  }
});
