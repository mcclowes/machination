/** Verify Railway's root-owned mount with isolated disposable containers and no cloud credentials. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const exec = promisify(execFile);
const image = process.env.MACHINATION_TEST_IMAGE ?? 'machination-server:railway';
const name = `machination-railway-${randomUUID()}`;
const volume = `${name}-data`;
const docker = async (...args) => (await exec('docker', args, { timeout: 60_000, maxBuffer: 1_000_000 })).stdout.trim();
let created = false, mounted = false;
async function start() {
  await docker('create', '--name', name, '--read-only', '--tmpfs', '/tmp',
    '--mount', `type=volume,src=${volume},dst=/var/lib/machination,volume-nocopy`,
    '--env', 'RAILWAY_VOLUME_MOUNT_PATH=/var/lib/machination',
    '--publish', '127.0.0.1::8787', '--stop-timeout', '20', image);
  created = true;
  await docker('start', name);
  const binding = await docker('port', name, '8787/tcp');
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  const origin = `http://${binding}`;
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    const running = await docker('inspect', '--format', '{{.State.Running}}', name);
    if (running !== 'true') throw Error(await docker('logs', name));
    try {
      const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return origin;
    } catch { /* Startup can precede the listening socket. */ }
    await delay(200);
  }
  throw Error('Railway image did not become healthy.');
}
try {
  const missingMount = await docker('run', '--rm', '--read-only', '--tmpfs', '/tmp', '--network', 'none', '--entrypoint', 'sh', image,
    '-c', '/usr/local/bin/machination-entrypoint true >/tmp/unavailable 2>&1; result=$?; cat /tmp/unavailable; test "$result" = 1');
  assert.match(missingMount, /Attach the persistent Railway volume/);
  await docker('volume', 'create', volume); mounted = true;
  let origin = await start();
  const identity = await docker('exec', name, 'node', '-e', "console.log(require('node:fs').readFileSync('/proc/1/status','utf8').split('\\n').find(l=>l.startsWith('Uid:')))");
  assert.match(identity, /^Uid:\s+1000\s+1000\s+1000\s+1000$/);
  assert.equal(await docker('exec', name, 'stat', '-c', '%u:%g:%a', '/var/lib/machination'), '0:0:755');
  assert.equal(await docker('exec', name, 'stat', '-c', '%u:%g:%a', '/var/lib/machination/state'), '1000:1000:700');
  const token = randomBytes(32).toString('hex');
  const response = await fetch(`${origin}/v1/games`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200);
  const snapshot = await response.json();
  assert.equal(await docker('exec', name, 'stat', '-c', '%u:%g:%a', '/var/lib/machination/state/games.json'), '1000:1000:600');
  await docker('stop', '-t', '20', name);
  assert.equal(await docker('inspect', '--format', '{{.State.ExitCode}}', name), '0');
  await docker('rm', name); created = false;
  origin = await start();
  const restored = await fetch(`${origin}/v1/games/${snapshot.id}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).id, snapshot.id);
  console.log('Railway image passes: missing-volume rejection, root-owned mount, non-root PID 1, private state permissions, authenticated persistence, graceful stop, and replacement.');
} finally {
  if (created) await docker('rm', '--force', name);
  if (mounted) await docker('volume', 'rm', volume);
}
