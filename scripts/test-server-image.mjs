/** Exercise an isolated image and disposable named volume; never touch an existing deployment. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const exec = promisify(execFile);
const image = process.env.MACHINATION_TEST_IMAGE ?? 'machination-server:playtest';
const name = `machination-smoke-${randomUUID()}`;
const volume = `${name}-data`;
const docker = async (...args) => (await exec('docker', args, { timeout: 60_000, maxBuffer: 1_000_000 })).stdout.trim();
const restoredVolume = `${volume}-restored`;
const restorer = `${name}-restore`;
const backupDirectory = await mkdtemp(join(tmpdir(), 'machination-image-backup-'));
const backupPath = join(backupDirectory, 'games.json');
const volumes = [];
let hasContainer = false, hasRestorer = false;
async function start(dataVolume = volume) {
  await docker('create', '--name', name, '--read-only', '--tmpfs', '/tmp', '--mount', `type=volume,src=${dataVolume},dst=/var/lib/machination`, '--publish', '127.0.0.1::8787', '--stop-timeout', '20', image);
  hasContainer = true; await docker('start', name);
  const binding = await docker('port', name, '8787/tcp');
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  const origin = `http://${binding}`;
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    const state = JSON.parse(await docker('inspect', '--format', '{{json .State}}', name));
    if (!state.Running) throw new Error(`Container exited: ${await docker('logs', name)}`);
    if (state.Health?.Status === 'unhealthy') throw new Error(`Container health failed: ${JSON.stringify(state.Health.Log)}`);
    if (state.Health?.Status === 'healthy') {
      const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(3000) });
      assert.equal(response.status, 200); return origin;
    }
    await delay(500);
  }
  throw new Error('Container health check did not become healthy.');
}
try {
  await docker('volume', 'create', volume); volumes.push(volume);
  let origin = await start();
  assert.equal(await docker('exec', name, 'id', '-u'), '1000');
  assert.equal(await docker('exec', name, 'node', '-e', "console.log(require('node:fs').existsSync('/app/node_modules'))"), 'false');
  const token = randomBytes(32).toString('hex');
  const created = await fetch(`${origin}/v1/games`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(created.status, 200); const view = await created.json();
  await docker('stop', '-t', '20', name);
  assert.equal(await docker('inspect', '--format', '{{.State.ExitCode}}', name), '0');
  await docker('cp', `${name}:/var/lib/machination/games.json`, backupPath);
  await docker('rm', name); hasContainer = false;
  origin = await start();
  const resumed = await fetch(`${origin}/v1/games/${view.id}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(resumed.status, 200); const snapshot = await resumed.json();
  assert.equal(snapshot.id, view.id); assert.equal(snapshot.faction, 'you');
  assert.equal(snapshot.visibility, 'sensors.v1');
  await docker('stop', '-t', '20', name);
  assert.equal(await docker('inspect', '--format', '{{.State.ExitCode}}', name), '0');
  await docker('rm', name); hasContainer = false;
  await docker('volume', 'create', restoredVolume); volumes.push(restoredVolume);
  await docker('create', '--name', restorer, '--read-only', '--network', 'none', '--user', '0', '--mount', `type=volume,src=${restoredVolume},dst=/var/lib/machination`, image, 'node', '-e', "const fs=require('node:fs');fs.chownSync(process.env.MACHINATION_DATA,1000,1000);fs.chmodSync(process.env.MACHINATION_DATA,0o600)");
  hasRestorer = true;
  await docker('cp', backupPath, `${restorer}:/var/lib/machination/games.json`);
  await docker('start', '--attach', restorer);
  assert.equal(await docker('inspect', '--format', '{{.State.ExitCode}}', restorer), '0');
  await docker('rm', restorer); hasRestorer = false;
  origin = await start(restoredVolume);
  const restored = await fetch(`${origin}/v1/games/${view.id}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(restored.status, 200); assert.equal((await restored.json()).id, view.id);
  await docker('stop', '-t', '20', name);
  assert.equal(await docker('inspect', '--format', '{{.State.ExitCode}}', name), '0');
  console.log('Image passes: non-root/read-only runtime, health, authenticated state, graceful stop, container replacement, and backup restoration.');
} finally {
  if (hasContainer) await docker('rm', '--force', name).catch(error => { console.error('Test container cleanup failed:', error.message); process.exitCode = 1; });
  if (hasRestorer) await docker('rm', '--force', restorer).catch(error => { console.error('Test restore cleanup failed:', error.message); process.exitCode = 1; });
  for (const dataVolume of volumes) await docker('volume', 'rm', dataVolume).catch(error => { console.error('Test volume cleanup failed:', error.message); process.exitCode = 1; });
  await rm(backupDirectory, { recursive: true, force: true });
}
