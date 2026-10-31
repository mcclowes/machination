import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createServer, request as httpRequest } from 'node:http';
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import postgres from 'postgres';

const testDatabase = process.env.MACHINATION_TEST_DATABASE_URL;
const tlsDatabase = process.env.MACHINATION_TEST_DATABASE_TLS_URL;
const databaseCa = process.env.MACHINATION_TEST_DATABASE_CA;

async function isolatedPostgres(t, databaseUrl = testDatabase, ssl = false) {
  const sql = postgres(databaseUrl, { ssl, max: 1, prepare: false, onnotice: () => {} });
  const schema = `machination_runtime_${randomBytes(8).toString('hex')}`;
  try { await sql.unsafe(`create schema "${schema}"`); }
  catch (error) { await sql.end({ timeout: 1 }); throw error; }
  t.after(async () => {
    try { await sql.unsafe(`drop schema "${schema}" cascade`); }
    finally { await sql.end({ timeout: 1 }); }
  });
  const url = new URL(databaseUrl);
  url.searchParams.set('options', `-c search_path=${schema}`);
  return { url: url.toString(), sql, schema };
}

async function start(entry, dataFile, configuration = {}) {
  let output = '';
  const child = spawn(process.execPath, [entry], { cwd: tmpdir(), env: { ...process.env, NODE_OPTIONS: '', NODE_ENV: 'production', MACHINATION_STORAGE: undefined, DATABASE_URL: '', MACHINATION_DATABASE_TLS: 'verify-full', MACHINATION_DATABASE_CA: '', MACHINATION_DATABASE_RECOVERY: undefined, CLERK_SECRET_KEY: '', CLERK_JWT_KEY: '', CLERK_ISSUER: '', MACHINATION_OPERATOR_CLERK_ISSUER: undefined, MACHINATION_OPERATOR_CLERK_JWT_KEY: undefined, MACHINATION_OPERATOR_ACCOUNTS: undefined, MACHINATION_REPORTING_ENABLED: undefined, MACHINATION_PUSH_ENABLED: '0', MACHINATION_CLIENT_IP: 'direct', MACHINATION_HOST: '127.0.0.1', PORT: '0', MACHINATION_DATA: dataFile, ...configuration } });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.stderr.on('data', chunk => { output += chunk; });
  let startupTimer;
  const ready = new Promise((resolve, reject) => {
    startupTimer = setTimeout(() => reject(new Error(`Startup timed out: ${output}`)), 10_000);
    child.once('error', reject);
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/listening on 127\.0\.0\.1:(\d+)/);
      if (match) resolve(`http://127.0.0.1:${match[1]}`);
    });
    child.once('exit', () => reject(new Error(`Service exited before readiness: ${output}`)));
  });
  let origin;
  try { origin = await ready; } catch (error) { child.kill('SIGKILL'); await exited; throw error; }
  finally { clearTimeout(startupTimer); }
  let stopping = false;
  return { origin, signal() { child.kill('SIGTERM'); }, async beginShutdown() {
    const observed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.stdout.off('data', inspect); reject(new Error('Shutdown was not acknowledged.')); }, 3000);
      function inspect() { if (output.includes('draining active requests')) { clearTimeout(timer); child.stdout.off('data', inspect); resolve(); } }
      child.stdout.on('data', inspect);
    });
    stopping = true; child.kill('SIGTERM'); await observed;
  }, async stop({ timeoutMs = 5000, expectedCode = 0 } = {}) {
    if (!stopping && child.exitCode === null && child.signalCode === null) { stopping = true; child.kill('SIGTERM'); }
    let stopTimer;
    try {
      const result = await Promise.race([exited, new Promise((_, reject) => { stopTimer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Graceful shutdown timed out.')); }, timeoutMs); })]);
      assert.deepEqual(result, { code: expectedCode, signal: null }, output);
    } finally { clearTimeout(stopTimer); }
  } };
}

async function damagedFileFixture(entry, file) {
  const tokens = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
  const runtime = await start(entry, file);
  const rooms = [];
  try {
    for (const token of tokens) {
      const response = await fetch(`${runtime.origin}/v1/games`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 200); rooms.push(await response.json());
    }
  } finally { await runtime.stop(); }
  const database = JSON.parse(await readFile(file, 'utf8'));
  database.rooms[0].game.version = 999;
  database.rooms[0].messages.push({ id: 1, from: 'you', to: 'vesper', sentAt: 1000, text: 'Quarantined transmission must remain private.' });
  const source = JSON.stringify(database, null, 2);
  await writeFile(file, source);
  return { tokens, damaged: rooms[0], healthy: rooms[1], source };
}

test('standalone bundle serves and restores an offline operation without project dependencies', { timeout: 20_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-bundle-'));
  const entry = join(dir, 'main.mjs'), dataFile = join(dir, 'state', 'games.json');
  let runtime;
  try {
    await copyFile(new URL('../dist-server/main.mjs', import.meta.url), entry);
    runtime = await start(entry, dataFile);
    assert.equal((await fetch(`${runtime.origin}/health`)).status, 200);
    const tokens = Array.from({ length: 3 }, () => randomBytes(32).toString('hex'));
    const request = async (path, seat = 0, body) => {
      const response = await fetch(`${runtime.origin}/v1/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${tokens[seat]}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const snapshot = await response.json(); assert.equal(response.status, 200, JSON.stringify(snapshot)); return snapshot;
    };
    let view = await request('games', 0, {});
    await request('join', 1, { invite: view.invite }); await request('join', 2, { invite: view.invite });
    const path = `games/${view.id}`;
    view = await request(`${path}/start`, 0, {});
    const from = view.game.rocks.find(r => r.owner === 'you' && r.drones >= 5);
    assert.ok(from, 'the fixture needs an owned station with a funded manifest');
    const to = view.game.rocks.find(r => r.owner === 'you' && r.id !== from.id);
    assert.ok(to, 'the fixture needs a friendly reinforcement destination');
    const elapsedHours = 1.5;
    view = await request(`${path}/schedules`, 0, { requestId: randomUUID(), revision: view.revision, from: from.id, to: to.id, drones: 5, executeAt: 1 });
    assert.equal(view.game.scheduled.length, 1);
    await runtime.stop(); runtime = undefined;
    const stored = JSON.parse(await readFile(dataFile, 'utf8'));
    stored.rooms[0].startedAt = Date.now() - elapsedHours * 3_600_000;
    stored.rooms[0].game.epoch = stored.rooms[0].startedAt;
    if (stored.rooms[0].replay) stored.rooms[0].replay.baseline.epoch = stored.rooms[0].startedAt;
    await writeFile(dataFile, JSON.stringify(stored));
    runtime = await start(entry, dataFile);
    const resumed = await request(path);
    assert.equal(resumed.id, view.id); assert.equal(resumed.faction, 'you');
    assert.equal(resumed.visibility, 'sensors.v1');
    assert.ok(resumed.game.hour >= elapsedHours && resumed.game.hour < elapsedHours + 0.1);
    assert.equal(resumed.game.scheduled.length, 0);
    const fleet = resumed.game.fleets.find(f => f.owner === 'you' && f.from === from.id && f.to === to.id);
    assert.ok(fleet, 'the funded scheduled reinforcement survives offline catch-up');
    assert.equal(fleet.drones, 5);
    assert.equal(fleet.preparing, undefined);
    assert.ok(fleet.departed >= 1 && fleet.departed < resumed.game.hour && fleet.arrives > resumed.game.hour);
    let incoming;
    const response = new Promise((resolve, reject) => {
      incoming = httpRequest(`${runtime.origin}/v1/games`, { method: 'POST', headers: { Authorization: `Bearer ${randomBytes(32).toString('hex')}`, 'Content-Type': 'application/json', 'Content-Length': '2', Expect: '100-continue', Connection: 'close' } }, result => {
        let raw = ''; result.on('data', chunk => { raw += chunk; });
        result.on('end', () => { try { assert.equal(result.statusCode, 200); resolve(JSON.parse(raw)); } catch (error) { reject(error); } });
      });
      incoming.on('error', reject);
    });
    try {
      const accepted = new Promise(resolve => incoming.once('continue', resolve));
      incoming.flushHeaders(); await accepted; incoming.write('{');
      await runtime.beginShutdown(); incoming.end('}');
      const completed = await response;
      await runtime.stop(); runtime = undefined;
      const persisted = JSON.parse(await readFile(dataFile, 'utf8'));
      assert.ok(persisted.rooms.some(room => room.id === completed.id), 'an accepted in-flight command is durable before shutdown');
    } finally { incoming.destroy(); }
  } finally { if (runtime) await runtime.stop(); await rm(dir, { recursive: true, force: true }); }
});

test('required Postgres storage refuses a missing URL before reading the legacy file', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-required-postgres-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'games.json');
  const source = 'Legacy source must not be read or replaced.';
  await writeFile(file, source);
  for (const url of [undefined, '', ' \t\n ']) {
    await assert.rejects(() => promisify(execFile)(process.execPath, [fileURLToPath(new URL('../dist-server/main.mjs', import.meta.url))], {
      timeout: 5000, killSignal: 'SIGKILL', env: { ...process.env, NODE_OPTIONS: '', PORT: '0', DATABASE_URL: url, MACHINATION_STORAGE: 'postgres', MACHINATION_DATABASE_RECOVERY: 'strict', MACHINATION_CLIENT_IP: 'direct', MACHINATION_PUSH_ENABLED: '0', MACHINATION_DATA: file },
    }), error => error.code === 1 && !error.killed && /DATABASE_URL is required when MACHINATION_STORAGE=postgres/.test(error.stderr));
    assert.equal(await readFile(file, 'utf8'), source);
  }
});

test('invalid host port configuration fails explicitly before listening', async () => {
  for (const port of ['not-a-port', '', '-1', '65536']) {
    await assert.rejects(() => promisify(execFile)(process.execPath, [fileURLToPath(new URL('../dist-server/main.mjs', import.meta.url))], {
      timeout: 5000, env: { ...process.env, NODE_OPTIONS: '', MACHINATION_STORAGE: undefined, PORT: port, MACHINATION_HOST: '127.0.0.1' },
    }), error => error.code === 1 && /PORT must be an integer/.test(error.stderr));
  }
});

test('invalid storage backend selection fails before opening either store', async () => {
  for (const mode of ['', 'auto', 'Postgres', 'sqlite']) {
    await assert.rejects(() => promisify(execFile)(process.execPath, [fileURLToPath(new URL('../dist-server/main.mjs', import.meta.url))], {
      timeout: 5000, killSignal: 'SIGKILL', env: { ...process.env, NODE_OPTIONS: '', PORT: '0', MACHINATION_STORAGE: mode, DATABASE_URL: 'credential-bearing-invalid-url', MACHINATION_DATA: '/not-a-real-directory/games.json', MACHINATION_CLIENT_IP: 'direct', MACHINATION_PUSH_ENABLED: '0' },
    }), error => error.code === 1 && !error.killed && /MACHINATION_STORAGE must be file or postgres/.test(error.stderr) && !error.stderr.includes('credential-bearing-invalid-url'));
  }
});

test('explicit file storage refuses a configured Postgres URL instead of ignoring either setting', async () => {
  await assert.rejects(() => promisify(execFile)(process.execPath, [fileURLToPath(new URL('../dist-server/main.mjs', import.meta.url))], {
    timeout: 5000, killSignal: 'SIGKILL', env: { ...process.env, NODE_OPTIONS: '', PORT: '0', MACHINATION_STORAGE: 'file', DATABASE_URL: 'credential-bearing-invalid-url', MACHINATION_DATA: '/not-a-real-directory/games.json', MACHINATION_CLIENT_IP: 'direct', MACHINATION_PUSH_ENABLED: '0' },
  }), error => error.code === 1 && !error.killed && /DATABASE_URL must be unset when MACHINATION_STORAGE=file/.test(error.stderr) && !error.stderr.includes('credential-bearing-invalid-url'));
});

test('invalid client IP trust configuration fails explicitly before opening storage', async () => {
  for (const mode of ['', 'true', 'forwarded', 'Railway']) {
    await assert.rejects(() => promisify(execFile)(process.execPath, [fileURLToPath(new URL('../dist-server/main.mjs', import.meta.url))], {
      timeout: 5000, env: { ...process.env, NODE_OPTIONS: '', MACHINATION_STORAGE: undefined, PORT: '0', MACHINATION_CLIENT_IP: mode, MACHINATION_DATA: '/not-a-real-directory/games.json' },
    }), error => error.code === 1 && /MACHINATION_CLIENT_IP must be direct or railway/.test(error.stderr));
  }
});

test('report collection refuses invalid or missing operator setup before opening storage', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-report-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'games.json');
  const source = 'Operator configuration must be checked before reading this file.';
  await writeFile(file, source);
  for (const flag of ['', 'true', 'yes', '1']) {
    await assert.rejects(() => promisify(execFile)(process.execPath, [fileURLToPath(new URL('../dist-server/main.mjs', import.meta.url))], {
      timeout: 5000, killSignal: 'SIGKILL', env: { ...process.env, NODE_OPTIONS: '', PORT: '0', MACHINATION_STORAGE: undefined, DATABASE_URL: '', CLERK_ISSUER: '', CLERK_JWT_KEY: '', CLERK_SECRET_KEY: '', MACHINATION_OPERATOR_CLERK_ISSUER: undefined, MACHINATION_OPERATOR_CLERK_JWT_KEY: undefined, MACHINATION_OPERATOR_ACCOUNTS: undefined, MACHINATION_REPORTING_ENABLED: flag, MACHINATION_DATA: file },
    }), error => error.code === 1 && !error.killed && /MACHINATION_REPORTING_ENABLED|separately configured operator/.test(error.stderr));
    assert.equal(await readFile(file, 'utf8'), source);
  }
});

test('standalone operator authentication reviews reports without changing guest creation or player snapshots', { timeout: 20_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-report-bundle-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const issuer = 'https://operator.clerk.accounts.dev';
  const configuration = { MACHINATION_REPORTING_ENABLED: '1', MACHINATION_OPERATOR_CLERK_ISSUER: issuer, MACHINATION_OPERATOR_CLERK_JWT_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString(), MACHINATION_OPERATOR_ACCOUNTS: 'user_operator' };
  const entry = fileURLToPath(new URL('../dist-server/main.mjs', import.meta.url));
  const runtime = await start(entry, join(directory, 'games.json'), configuration);
  t.after(() => runtime.stop());
  const host = 'a'.repeat(64), guest = 'b'.repeat(64);
  async function request(token, path, payload) {
    const response = await fetch(runtime.origin+'/v1/'+path, { method: payload === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/vnd.machination.v2+json, application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    assert.equal(response.headers.get('Content-Type'), 'application/vnd.machination.v2+json');
    return { status: response.status, body: await response.json() };
  }
  const room = await request(host, 'games', { options: { playerCount: 2, mode: 'domination' } });
  assert.equal(room.status, 200);
  assert.equal((await request(guest, 'join', { invite: room.body.invite })).status, 200);
  const gamePath = `games/${room.body.id}`;
  await request(guest, gamePath+'/messages', { requestId: randomUUID(), to: 'you', text: 'Private runtime evidence' });
  const before = (await request(host, gamePath)).body;
  assert.equal((await request(host, gamePath+'/reporting')).body.available, true);
  const report = { requestId: randomUUID(), target: { kind: 'private', id: before.messages[0].id }, reason: 'spam', detail: '' };
  const accepted = await request(host, gamePath+'/message-reports', report);
  assert.equal(accepted.status, 200);
  assert.equal((await request(host, 'operator/message-reports')).status, 401);
  function session(sub) {
    const now = Math.floor(Date.now()/1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'fixture' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: issuer, sub, sid: 'sess_operator', iat: now, nbf: now-1, exp: now+120 })).toString('base64url');
    const content = header+'.'+payload;
    return content+'.'+sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64url');
  }
  assert.equal((await request(session('user_other'), 'operator/message-reports')).status, 403);
  const operator = session('user_operator');
  const path = `operator/message-reports/${accepted.body.caseId}`;
  const detail = await request(operator, path);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.evidence.text, 'Private runtime evidence');
  const review = { requestId: randomUUID(), revision: 0, status: 'reviewed', note: 'Runtime review recorded.' };
  const reviewed = await request(operator, path, review);
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.reviews[0].actor, 'user_operator');
  assert.deepEqual(await request(operator, path, review), reviewed);
  const after = (await request(host, gamePath)).body;
  assert.ok(after.serverTime >= before.serverTime);
  assert.deepEqual({ ...after, serverTime: before.serverTime }, before);
  assert.deepEqual(await request(host, gamePath+'/message-reports', report), accepted);
});

test('standalone bundle separates Railway client budgets and keeps health available when throttled', { timeout: 20_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-ingress-bundle-'));
  let runtime;
  try {
    const entry = join(dir, 'main.mjs');
    await copyFile(new URL('../dist-server/main.mjs', import.meta.url), entry);
    runtime = await start(entry, join(dir, 'games.json'), { MACHINATION_CLIENT_IP: 'railway' });
    for (let i = 0; i < 120; i++) {
      const response = await fetch(`${runtime.origin}/missing`, { headers: { 'X-Real-IP': '192.0.2.1' } });
      await response.arrayBuffer();
      assert.equal(response.status, 404);
    }
    const limited = await fetch(`${runtime.origin}/missing`, { headers: { 'X-Real-IP': '192.0.2.1' } });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).issues[0].issue, 'request.rate_limit.exceeded');
    const other = await fetch(`${runtime.origin}/missing`, { headers: { 'X-Real-IP': '192.0.2.2' } });
    await other.arrayBuffer();
    assert.equal(other.status, 404);
    const health = await fetch(`${runtime.origin}/health`, { headers: { 'X-Real-IP': '192.0.2.1' } });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
  } finally { if (runtime) await runtime.stop(); await rm(dir, { recursive: true, force: true }); }
});


test('standalone bundle verifies Clerk sessions and restores an account without runtime dependencies', { timeout: 20_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-clerk-bundle-'));
  const entry = join(dir, 'main.mjs');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const issuer = 'https://clerk.example.com';
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'bundle-test' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: issuer, sub: 'user_bundle', sid: 'sess_bundle', iat: now, nbf: now - 1, exp: now + 60 })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const token = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
  let runtime;
  try {
    await copyFile(new URL('../dist-server/main.mjs', import.meta.url), entry);
    runtime = await start(entry, join(dir, 'games.json'), { CLERK_ISSUER: issuer, CLERK_JWT_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString(), MACHINATION_ORIGINS: 'https://belt.example.com' });
    const anonymous = await fetch(`${runtime.origin}/v1/games`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(anonymous.status, 401);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const created = await fetch(`${runtime.origin}/v1/games`, { method: 'POST', headers, body: '{}' });
    const snapshot = await created.json();
    assert.equal(created.status, 200, JSON.stringify(snapshot));
    const restored = await fetch(`${runtime.origin}/v1/account/session`, { headers });
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).snapshot.id, snapshot.id);
  } finally { if (runtime) await runtime.stop(); await rm(dir, { recursive: true, force: true }); }
});

test('standalone default recovery preserves raw files and serves healthy operations while strict boot refuses damage', { timeout: 30_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-recovery-bundle-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const entry = join(dir, 'main.mjs'), file = join(dir, 'games.json');
  await copyFile(new URL('../dist-server/main.mjs', import.meta.url), entry);
  const { tokens, damaged, healthy, source } = await damagedFileFixture(entry, file);
  await assert.rejects(start(entry, file, { MACHINATION_DATABASE_RECOVERY: 'strict' }), /This save is damaged/);
  assert.equal(await readFile(file, 'utf8'), source);
  await assert.rejects(readdir(`${file}.quarantine`), { code: 'ENOENT' });
  let runtime;
  try {
    runtime = await start(entry, file);
    const headers = token => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
    assert.equal((await fetch(`${runtime.origin}/health`)).status, 200);
    const resumed = await fetch(`${runtime.origin}/v1/games/${healthy.id}`, { headers: headers(tokens[1]) });
    assert.equal(resumed.status, 200); assert.equal((await resumed.json()).id, healthy.id);
    const unavailable = await fetch(`${runtime.origin}/v1/games/${damaged.id}`, { headers: headers(tokens[0]) });
    const text = await unavailable.text(); assert.equal(unavailable.status, 503);
    assert.equal(JSON.parse(text).issues[0].issue, 'game.unavailable.recovery');
    assert.ok(!text.includes('Quarantined transmission') && !text.includes('Reset the operation'));
    const retried = await fetch(`${runtime.origin}/v1/games`, { method: 'POST', headers: headers(tokens[0]), body: '{}' });
    assert.equal(retried.status, 503); await retried.arrayBuffer();
    const created = await fetch(`${runtime.origin}/v1/games`, { method: 'POST', headers: headers(randomBytes(32).toString('hex')), body: '{}' });
    assert.equal(created.status, 200); await created.arrayBuffer();
    await runtime.stop(); runtime = undefined;
    const [archive] = await readdir(`${file}.quarantine`);
    assert.equal(await readFile(join(`${file}.quarantine`, archive, 'database.json'), 'utf8'), source);
    runtime = await start(entry, file);
    const after = await fetch(`${runtime.origin}/v1/games/${damaged.id}`, { headers: headers(tokens[0]) });
    assert.equal(after.status, 503); await after.arrayBuffer();
    assert.equal((await readdir(`${file}.quarantine`)).length, 1);
  } finally { if (runtime) await runtime.stop(); }
});

test('invalid database recovery policy fails before storage opens', async () => {
  for (const mode of ['', 'reset', 'true']) {
    await assert.rejects(() => promisify(execFile)(process.execPath, [fileURLToPath(new URL('../dist-server/main.mjs', import.meta.url))], {
      timeout: 5000, killSignal: 'SIGKILL', env: { ...process.env, NODE_OPTIONS: '', MACHINATION_STORAGE: undefined, PORT: '0', DATABASE_URL: '', MACHINATION_DATABASE_RECOVERY: mode, MACHINATION_CLIENT_IP: 'direct', MACHINATION_PUSH_ENABLED: '0', MACHINATION_DATA: '/not-a-real-directory/games.json' },
    }), error => error.code === 1 && !error.killed && /MACHINATION_DATABASE_RECOVERY must be strict or quarantine/.test(error.stderr));
  }
});

test('standalone Postgres storage requirement prevents stale and empty file fallback after later SQL writes', { timeout: 30_000, skip: !testDatabase && 'Set MACHINATION_TEST_DATABASE_URL to run.' }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-postgres-requirement-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const entry = join(directory, 'main.mjs'), file = join(directory, 'games.json');
  await copyFile(new URL('../dist-server/main.mjs', import.meta.url), entry);
  const { url, sql, schema } = await isolatedPostgres(t);
  const token = randomBytes(32).toString('hex'), guest = randomBytes(32).toString('hex');
  const configuration = { MACHINATION_STORAGE: 'postgres', DATABASE_URL: url, MACHINATION_DATABASE_TLS: 'local' };
  let runtime;
  const request = async (path, body, credential = token) => {
    const response = await fetch(`${runtime.origin}/v1/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const view = await response.json(); assert.equal(response.status, 200, JSON.stringify(view)); return view;
  };
  const stored = async () => ({
    rooms: await sql.unsafe(`select id, data::text as data from "${schema}".machination_rooms order by ordinal`),
    state: await sql.unsafe(`select key, data::text as data from "${schema}".machination_state order by key`),
    archives: await sql.unsafe(`select id, data::text as data from "${schema}".machination_quarantine order by id`),
  });
  const refuse = (settings, expected) => assert.rejects(() => promisify(execFile)(process.execPath, [entry], {
    cwd: tmpdir(), timeout: 5000, killSignal: 'SIGKILL', env: { ...process.env, NODE_OPTIONS: '', PORT: '0', MACHINATION_CLIENT_IP: 'direct', MACHINATION_DATABASE_RECOVERY: 'strict', MACHINATION_PUSH_ENABLED: '0', MACHINATION_DATA: file, ...settings },
  }), error => error.code === 1 && !error.killed && expected.test(error.stderr));
  try {
    runtime = await start(entry, file, { MACHINATION_STORAGE: 'file' });
    const room = await request('games', {});
    await request('join', { invite: room.invite }, guest);
    await runtime.stop(); runtime = undefined;
    const legacy = await readFile(file, 'utf8');
    runtime = await start(entry, file, configuration);
    assert.equal((await request(`games/${room.id}`)).id, room.id);
    const command = { requestId: randomUUID(), to: 'vesper', text: 'Accepted only in authoritative Postgres.' };
    const accepted = await request(`games/${room.id}/messages`, command);
    assert.equal(accepted.messages.filter(message => message.text === command.text).length, 1);
    await runtime.stop(); runtime = undefined;
    const before = await stored();
    assert.equal(await readFile(file, 'utf8'), legacy);
    assert.equal(JSON.parse(legacy).rooms[0].messages.length, 0);
    for (const missing of [undefined, '', ' \t ']) {
      await refuse({ ...configuration, DATABASE_URL: missing }, /DATABASE_URL is required when MACHINATION_STORAGE=postgres/);
      assert.deepEqual(await stored(), before);
      assert.equal(await readFile(file, 'utf8'), legacy);
    }
    await refuse({ ...configuration, MACHINATION_STORAGE: 'file' }, /DATABASE_URL must be unset when MACHINATION_STORAGE=file/);
    assert.deepEqual(await stored(), before);
    assert.equal(await readFile(file, 'utf8'), legacy);
    const absent = join(directory, 'absent', 'games.json');
    await refuse({ ...configuration, DATABASE_URL: undefined, MACHINATION_DATA: absent }, /DATABASE_URL is required when MACHINATION_STORAGE=postgres/);
    await assert.rejects(readFile(absent), { code: 'ENOENT' });
    await assert.rejects(readdir(join(directory, 'absent')), { code: 'ENOENT' });
    assert.deepEqual(await stored(), before);
    runtime = await start(entry, file, configuration);
    const retried = await request(`games/${room.id}/messages`, command);
    assert.equal(retried.messages.filter(message => message.text === command.text).length, 1);
    assert.equal((await request(`games/${room.id}`, undefined, guest)).messages[0].text, command.text);
    assert.equal(await readFile(file, 'utf8'), legacy);
    await runtime.stop(); runtime = undefined;
  } finally { if (runtime) await runtime.stop(); }
});

test('standalone Postgres recovery imports an archived legacy source once without rewriting it', { timeout: 30_000, skip: !testDatabase && 'Set MACHINATION_TEST_DATABASE_URL to run.' }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-recovery-import-bundle-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const entry = join(dir, 'main.mjs'), file = join(dir, 'games.json');
  await copyFile(new URL('../dist-server/main.mjs', import.meta.url), entry);
  const { tokens, damaged, healthy, source } = await damagedFileFixture(entry, file);
  const { url, sql, schema } = await isolatedPostgres(t);
  const configuration = { DATABASE_URL: url, MACHINATION_DATABASE_TLS: 'local' };
  let runtime;
  try {
    runtime = await start(entry, file, configuration);
    const good = await fetch(`${runtime.origin}/v1/games/${healthy.id}`, { headers: { Authorization: `Bearer ${tokens[1]}` } });
    assert.equal(good.status, 200); assert.equal((await good.json()).id, healthy.id);
    const bad = await fetch(`${runtime.origin}/v1/games/${damaged.id}`, { headers: { Authorization: `Bearer ${tokens[0]}` } });
    assert.equal(bad.status, 503); await bad.arrayBuffer();
    await runtime.stop(); runtime = undefined;
    assert.equal(await readFile(file, 'utf8'), source);
    const archives = await sql.unsafe(`select data::text as data from "${schema}".machination_quarantine`);
    assert.equal(archives.length, 1);
    assert.equal(JSON.parse(archives[0].data).source, source);
    assert.equal(JSON.parse(archives[0].data).format, 'json-import.v1');
    runtime = await start(entry, file, { ...configuration, MACHINATION_DATABASE_RECOVERY: 'strict' });
    const resumed = await fetch(`${runtime.origin}/v1/games/${healthy.id}`, { headers: { Authorization: `Bearer ${tokens[1]}` } });
    assert.equal(resumed.status, 200); await resumed.arrayBuffer();
    assert.equal((await sql.unsafe(`select 1 from "${schema}".machination_quarantine`)).length, 1);
  } finally { if (runtime) await runtime.stop(); }
});

test('standalone Postgres TLS verifies its CA and hostname and restores stored state', { timeout: 30_000, skip: !tlsDatabase && 'Run npm run test:postgres-tls for the disposable TLS server.' }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-postgres-tls-bundle-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { url, sql, schema } = await isolatedPostgres(t, tlsDatabase, { ca: databaseCa, rejectUnauthorized: true });
  const entry = join(dir, 'main.mjs'), file = join(dir, 'games.json');
  await copyFile(new URL('../dist-server/main.mjs', import.meta.url), entry);
  const configuration = { DATABASE_URL: url, MACHINATION_DATABASE_CA: databaseCa };
  await assert.rejects(start(entry, file, { ...configuration, MACHINATION_DATABASE_CA: '' }), /unable to verify the first certificate/);
  const mismatch = new URL(url); mismatch.hostname = '127.0.0.1';
  await assert.rejects(start(entry, file, { ...configuration, DATABASE_URL: mismatch.toString() }), /does not match certificate/);
  const token = randomBytes(32).toString('hex');
  let runtime;
  try {
    runtime = await start(entry, file, configuration);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const created = await fetch(`${runtime.origin}/v1/games`, { method: 'POST', headers, body: '{}' });
    assert.equal(created.status, 200);
    const snapshot = await created.json();
    const damagedToken = randomBytes(32).toString('hex');
    const extra = await fetch(`${runtime.origin}/v1/games`, { method: 'POST', headers: { Authorization: `Bearer ${damagedToken}`, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(extra.status, 200);
    const damaged = await extra.json();
    await runtime.stop(); runtime = undefined;
    const [row] = await sql.unsafe(`select data::text as data from "${schema}".machination_rooms where id = $1`, [damaged.id]);
    const data = JSON.parse(row.data); data.game.version = 999;
    const original = JSON.stringify(data, null, 2);
    await sql.unsafe(`update "${schema}".machination_rooms set data = $1::text::json where id = $2`, [original, damaged.id]);
    runtime = await start(entry, file, configuration);
    const restored = await fetch(`${runtime.origin}/v1/games/${snapshot.id}`, { headers });
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).id, snapshot.id);
    const unavailable = await fetch(`${runtime.origin}/v1/games/${damaged.id}`, { headers: { Authorization: `Bearer ${damagedToken}` } });
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).issues[0].issue, 'game.unavailable.recovery');
    const [archive] = await sql.unsafe(`select data::text as data from "${schema}".machination_quarantine`);
    assert.equal(JSON.parse(archive.data).rooms[0].data, original);
  } finally { if (runtime) await runtime.stop(); }
});

test('invalid database TLS configuration fails without exposing credentials', async () => {
  for (const configuration of [{ MACHINATION_DATABASE_TLS: 'require' }, { MACHINATION_DATABASE_TLS: 'local' }, { MACHINATION_DATABASE_CA: '/private/secret-ca.pem' }]) {
    await assert.rejects(() => promisify(execFile)(process.execPath, [fileURLToPath(new URL('../dist-server/main.mjs', import.meta.url))], {
      timeout: 5000, killSignal: 'SIGKILL', env: { ...process.env, NODE_OPTIONS: '', MACHINATION_STORAGE: undefined, PORT: '0', MACHINATION_DATABASE_TLS: 'verify-full', MACHINATION_DATABASE_CA: '', DATABASE_URL: 'postgres://private-user:private-password@db.example.test/game', CLERK_SECRET_KEY: '', CLERK_JWT_KEY: '', CLERK_ISSUER: '', MACHINATION_PUSH_ENABLED: '0', MACHINATION_CLIENT_IP: 'direct', ...configuration },
    }), error => error.code === 1 && !error.killed && /MACHINATION_DATABASE_(TLS|CA)/.test(error.stderr) && !/private-user|private-password|secret-ca/.test(error.stderr));
  }
});

test('standalone Postgres drains accepted work, closes connections, and restores retry history', { timeout: 30_000, skip: !testDatabase && 'Set MACHINATION_TEST_DATABASE_URL to run.' }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-postgres-runtime-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { url } = await isolatedPostgres(t);
  const entry = join(dir, 'main.mjs'), dataFile = join(dir, 'games.json');
  await copyFile(new URL('../dist-server/main.mjs', import.meta.url), entry);
  const tokens = Array.from({ length: 3 }, () => randomBytes(32).toString('hex'));
  let runtime;
  const request = async (path, seat, body) => {
    const response = await fetch(`${runtime.origin}/v1/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${tokens[seat]}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  };
  try {
    runtime = await start(entry, dataFile, { DATABASE_URL: url, MACHINATION_DATABASE_TLS: 'local' });
    let view = await request('games', 0, { options: { playerCount: 2, mode: 'pulse' } });
    await request('join', 1, { invite: view.invite });
    const path = `games/${view.id}`;
    view = await request(`${path}/start`, 0, {});
    await request(`${path}/messages`, 0, { requestId: randomUUID(), to: 'vesper', text: 'Preserve this message.' });
    view = await request(path, 0);
    const from = view.game.rocks.find(r => r.owner === 'you' && r.drones >= 5);
    const to = view.game.rocks.find(r => r.owner === 'you' && r.id !== from?.id);
    assert.ok(from && to);
    const order = { requestId: randomUUID(), revision: view.revision, from: from.id, to: to.id, drones: 5, executeAt: 1 };
    const accepted = await request(`${path}/schedules`, 0, order);
    assert.equal(accepted.game.scheduled.length, 1);
    let incoming;
    const response = new Promise((resolve, reject) => {
      incoming = httpRequest(`${runtime.origin}/v1/games`, { method: 'POST', headers: { Authorization: `Bearer ${tokens[2]}`, 'Content-Type': 'application/json', 'Content-Length': '2', Expect: '100-continue', Connection: 'close' } }, result => {
        let raw = ''; result.on('data', chunk => { raw += chunk; });
        result.on('end', () => { try { assert.equal(result.statusCode, 200); resolve(JSON.parse(raw)); } catch (error) { reject(error); } });
      });
      incoming.on('error', reject);
    });
    let late;
    try {
      const continued = new Promise(resolve => incoming.once('continue', resolve));
      incoming.flushHeaders(); await continued; incoming.write('{');
      await runtime.beginShutdown(); runtime.signal(); incoming.end('}');
      late = await response;
      await runtime.stop(); runtime = undefined;
    } finally { incoming.destroy(); }
    runtime = await start(entry, dataFile, { DATABASE_URL: url, MACHINATION_DATABASE_TLS: 'local' });
    const resumed = await request(path, 0);
    assert.equal(resumed.game.scheduled.length, 1);
    assert.equal(resumed.messages[0].text, 'Preserve this message.');
    const retried = await request(`${path}/schedules`, 0, order);
    assert.equal(retried.revision, accepted.revision, 'the original command ID remains accepted without another revision');
    assert.deepEqual(retried.game.scheduled, accepted.game.scheduled, 'retry preserves one original plan');
    assert.deepEqual(retried.messages, accepted.messages);
    assert.ok(retried.serverTime >= accepted.serverTime, 'retry returns the current snapshot');
    assert.equal((await request(path, 0)).game.scheduled.length, 1);
    assert.equal((await request(`games/${late.id}`, 2)).id, late.id, 'work accepted while draining is committed before storage closes');
    await runtime.stop(); runtime = undefined;
  } finally { if (runtime) await runtime.stop().catch(() => {}); }
});

test('standalone Postgres closes its client when startup import fails', { timeout: 15_000, skip: !testDatabase && 'Set MACHINATION_TEST_DATABASE_URL to run.' }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-postgres-startup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { url } = await isolatedPostgres(t);
  const file = join(dir, 'damaged.json');
  await writeFile(file, '{damaged');
  await assert.rejects(() => promisify(execFile)(process.execPath, [fileURLToPath(new URL('../dist-server/main.mjs', import.meta.url))], {
    timeout: 5000, killSignal: 'SIGKILL', env: { ...process.env, NODE_OPTIONS: '', MACHINATION_STORAGE: undefined, PORT: '0', DATABASE_URL: url, MACHINATION_DATABASE_TLS: 'local', MACHINATION_DATABASE_CA: '', CLERK_SECRET_KEY: '', CLERK_JWT_KEY: '', CLERK_ISSUER: '', MACHINATION_HOST: '127.0.0.1', MACHINATION_DATA: file, MACHINATION_PUSH_ENABLED: '0', MACHINATION_CLIENT_IP: 'direct' },
  }), error => error.code === 1 && !error.killed && /Cannot start game service:/.test(error.stderr));
});

test('standalone Postgres closes its client after a listener startup failure', { timeout: 15_000, skip: !testDatabase && 'Set MACHINATION_TEST_DATABASE_URL to run.' }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-postgres-listener-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { url } = await isolatedPostgres(t);
  const busy = createServer();
  await new Promise(resolve => busy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => busy.close(resolve)));
  const port = busy.address().port;
  await assert.rejects(() => promisify(execFile)(process.execPath, [fileURLToPath(new URL('../dist-server/main.mjs', import.meta.url))], {
    timeout: 5000, killSignal: 'SIGKILL', env: { ...process.env, NODE_OPTIONS: '', MACHINATION_STORAGE: undefined, PORT: String(port), DATABASE_URL: url, MACHINATION_DATABASE_TLS: 'local', MACHINATION_DATABASE_CA: '', CLERK_SECRET_KEY: '', CLERK_JWT_KEY: '', CLERK_ISSUER: '', MACHINATION_HOST: '127.0.0.1', MACHINATION_DATA: join(dir, 'games.json'), MACHINATION_PUSH_ENABLED: '0', MACHINATION_CLIENT_IP: 'direct' },
  }), error => error.code === 1 && !error.killed && /EADDRINUSE/.test(error.stderr));
});

test('standalone Postgres bounds a blocked write at shutdown and preserves safe retry after restart', { timeout: 30_000, skip: !testDatabase && 'Set MACHINATION_TEST_DATABASE_URL to run.' }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-postgres-deadline-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { url, sql, schema } = await isolatedPostgres(t);
  const observer = postgres(testDatabase, { max: 1, prepare: false, onnotice: () => {} });
  t.after(() => observer.end({ timeout: 1 }));
  const entry = join(dir, 'main.mjs'), dataFile = join(dir, 'games.json');
  await copyFile(new URL('../dist-server/main.mjs', import.meta.url), entry);
  const token = randomBytes(32).toString('hex');
  const appName = `shutdown-${randomBytes(8).toString('hex')}`;
  const configuration = { DATABASE_URL: url, MACHINATION_DATABASE_TLS: 'local', PGAPPNAME: appName };
  let runtime, release, held;
  const request = (path, body) => fetch(`${runtime.origin}/v1/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    runtime = await start(entry, dataFile, configuration);
    const response = await request('games', {});
    assert.equal(response.status, 200);
    const before = await response.json();
    let locked;
    const ready = new Promise(resolve => { locked = resolve; });
    held = sql.begin(async tx => {
      await tx.unsafe(`select data from "${schema}".machination_state where key = 'writer' for update`);
      locked();
      await new Promise(resolve => { release = resolve; });
    });
    await ready;
    const extra = randomBytes(32).toString('hex');
    const pending = fetch(`${runtime.origin}/v1/games`, { method: 'POST', headers: { Authorization: `Bearer ${extra}`, 'Content-Type': 'application/json' }, body: '{}' }).then(result => { result.body?.cancel(); return 'responded'; }, () => 'uncertain');
    const deadline = Date.now() + 3000;
    let blocked = false;
    while (Date.now() < deadline) {
      blocked = (await observer`select 1 from pg_stat_activity where application_name = ${appName} and wait_event_type = 'Lock'`).length > 0;
      if (blocked) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(blocked, 'the write must be blocked in Postgres before shutdown');
    await runtime.beginShutdown();
    await runtime.stop({ timeoutMs: 20_000, expectedCode: 1 }); runtime = undefined;
    assert.equal(await pending, 'uncertain', 'a blocked write is never acknowledged');
    release(); await held; held = undefined;
    runtime = await start(entry, dataFile, configuration);
    assert.equal((await (await request(`games/${before.id}`)).json()).id, before.id);
    assert.equal((await observer.unsafe(`select count(*)::int as count from "${schema}".machination_rooms`))[0].count, 1, 'the interrupted write was rolled back');
    const retry = () => fetch(`${runtime.origin}/v1/games`, { method: 'POST', headers: { Authorization: `Bearer ${extra}`, 'Content-Type': 'application/json' }, body: '{}' });
    const created = await retry(); assert.equal(created.status, 200);
    const restored = await created.json();
    const duplicate = await retry(); assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).id, restored.id);
    assert.equal((await observer.unsafe(`select count(*)::int as count from "${schema}".machination_rooms`))[0].count, 2, 'retry creates only one room');
    await runtime.stop(); runtime = undefined;
  } finally {
    release?.(); if (held) await held.catch(() => {});
    if (runtime) await runtime.stop().catch(() => {});
  }
});
