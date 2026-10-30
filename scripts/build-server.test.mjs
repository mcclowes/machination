import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createServer, request as httpRequest } from 'node:http';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import postgres from 'postgres';

const testDatabase = process.env.MACHINATION_TEST_DATABASE_URL;

async function isolatedPostgres(t) {
  const sql = postgres(testDatabase, { max: 1, prepare: false, onnotice: () => {} });
  const schema = `machination_runtime_${randomBytes(8).toString('hex')}`;
  try { await sql.unsafe(`create schema "${schema}"`); }
  catch (error) { await sql.end({ timeout: 1 }); throw error; }
  t.after(async () => {
    try { await sql.unsafe(`drop schema "${schema}" cascade`); }
    finally { await sql.end({ timeout: 1 }); }
  });
  const url = new URL(testDatabase);
  url.searchParams.set('options', `-c search_path=${schema}`);
  return { url: url.toString(), sql, schema };
}

async function start(entry, dataFile, configuration = {}) {
  let output = '';
  const child = spawn(process.execPath, [entry], { cwd: tmpdir(), env: { ...process.env, NODE_OPTIONS: '', NODE_ENV: 'production', DATABASE_URL: '', CLERK_SECRET_KEY: '', CLERK_JWT_KEY: '', CLERK_ISSUER: '', MACHINATION_PUSH_ENABLED: '0', MACHINATION_CLIENT_IP: 'direct', MACHINATION_HOST: '127.0.0.1', PORT: '0', MACHINATION_DATA: dataFile, ...configuration } });
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

test('invalid host port configuration fails explicitly before listening', async () => {
  for (const port of ['not-a-port', '', '-1', '65536']) {
    await assert.rejects(() => promisify(execFile)(process.execPath, [fileURLToPath(new URL('../dist-server/main.mjs', import.meta.url))], {
      timeout: 5000, env: { ...process.env, NODE_OPTIONS: '', PORT: port, MACHINATION_HOST: '127.0.0.1' },
    }), error => error.code === 1 && /PORT must be an integer/.test(error.stderr));
  }
});

test('invalid client IP trust configuration fails explicitly before opening storage', async () => {
  for (const mode of ['', 'true', 'forwarded', 'Railway']) {
    await assert.rejects(() => promisify(execFile)(process.execPath, [fileURLToPath(new URL('../dist-server/main.mjs', import.meta.url))], {
      timeout: 5000, env: { ...process.env, NODE_OPTIONS: '', PORT: '0', MACHINATION_CLIENT_IP: mode, MACHINATION_DATA: '/not-a-real-directory/games.json' },
    }), error => error.code === 1 && /MACHINATION_CLIENT_IP must be direct or railway/.test(error.stderr));
  }
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
    runtime = await start(entry, dataFile, { DATABASE_URL: url });
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
    runtime = await start(entry, dataFile, { DATABASE_URL: url });
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
    timeout: 5000, killSignal: 'SIGKILL', env: { ...process.env, NODE_OPTIONS: '', PORT: '0', DATABASE_URL: url, CLERK_SECRET_KEY: '', CLERK_JWT_KEY: '', CLERK_ISSUER: '', MACHINATION_HOST: '127.0.0.1', MACHINATION_DATA: file, MACHINATION_PUSH_ENABLED: '0', MACHINATION_CLIENT_IP: 'direct' },
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
    timeout: 5000, killSignal: 'SIGKILL', env: { ...process.env, NODE_OPTIONS: '', PORT: String(port), DATABASE_URL: url, CLERK_SECRET_KEY: '', CLERK_JWT_KEY: '', CLERK_ISSUER: '', MACHINATION_HOST: '127.0.0.1', MACHINATION_DATA: join(dir, 'games.json'), MACHINATION_PUSH_ENABLED: '0', MACHINATION_CLIENT_IP: 'direct' },
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
  const configuration = { DATABASE_URL: url, PGAPPNAME: appName };
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
