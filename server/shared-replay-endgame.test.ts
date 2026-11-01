import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat, copyFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { GameService } from './service';
import { createApi } from './http';
import { api, RejectedCommand } from '../src/online/network';
import { exportSharedReplay } from '../src/online/shared-replay';
import { encodeReplayArtifact, seekReplayArtifact } from '../src/replay/artifact';
import type { Snapshot } from '../src/contracts/protocol';

async function withFailureEvidence(
  { source, root = join(process.cwd(), '.data', 'endgame-failures'), report }: { source: string; root?: string; report: (message: string) => void },
  run: () => Promise<void>,
) {
  const startedAt = performance.now();
  try { await run(); }
  catch (failure) {
    try {
      await mkdir(root, { recursive: true, mode: 0o700 });
      const retained = await mkdtemp(join(root, 'case-'));
      await chmod(retained, 0o700);
      const state = join(retained, 'rooms.json');
      await copyFile(join(source, 'rooms.json'), state);
      await chmod(state, 0o600);
      await writeFile(join(retained, 'failure.json'), JSON.stringify({
        elapsedMs: performance.now() - startedAt,
        error: failure instanceof Error ? { name: failure.name, message: failure.message, stack: failure.stack, ...(failure instanceof RejectedCommand ? { status: failure.status, issue: failure.issue } : {}) } : { type: typeof failure },
        stateSha256: createHash('sha256').update(await readFile(state)).digest('hex'),
        runtime: { node: process.versions.node, v8: process.versions.v8, executable: process.execPath },
      }, null, 2) + '\n', { mode: 0o600 });
      report(`Private endgame evidence: ${retained}`);
    } catch {
      // Diagnostic failures must not replace the original test failure.
      try { report('Private endgame evidence could not be retained.'); } catch { /* Keep the original failure. */ }
    }
    throw failure;
  }
}

// Real HTTP/file persistence, ordinary default rules and resources; only wall time is injected.
test('a fresh ten-seat HTTP pulse operation exports its natural ending and restores it after restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-packed-http-ending-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await withFailureEvidence({ source: directory, report: message => t.diagnostic(message) }, async () => {
    let now = 0, requests = 0;
    const file = join(directory, 'rooms.json');
    let service = await GameService.open(file, () => now);
    let server = createApi(service, undefined, undefined, { clock: () => now });
    async function listen() {
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      const address = server.address(); assert.ok(address && typeof address !== 'string');
      return `http://127.0.0.1:${address.port}`;
    }
    let url = await listen();
    t.after(() => { server.closeAllConnections(); server.close(); });
    const seats = Array.from({ length: 10 }, () => ({ url, token: randomBytes(32).toString('hex'), id: undefined as string | undefined }));
    async function call(index: number, path: string, payload?: unknown) {
      assert.ok(++requests <= 1000, 'bounded HTTP acceptance request budget');
      return api(seats[index]!, path, payload);
    }
    const created = await call(0, 'games', { options: { playerCount: 10, mode: 'pulse' } });
    for (let i = 1; i < seats.length; i++) await call(i, 'join', { invite: created.invite });
    seats.forEach(seat => { seat.id = created.id; });
    const path = `games/${created.id}`;
    const started = await call(0, `${path}/start`, {});
    const rules = structuredClone(started.game.rules);
    assert.equal(rules!.mechanicsVersion, 19); assert.equal(rules!.mode, 'pulse');
    const snapshots: Snapshot[] = [];
    for (let hour = 8; hour <= 384; hour += 8) {
      now = hour * 3600000;
      for (let i = 0; i < seats.length; i++) {
        snapshots[i] = await call(i, `${path}/activity`, {});
        assert.equal(snapshots[i]!.status, 'game.active');
        assert.deepEqual(snapshots[i]!.game.rules, rules);
      }
    }
    for (let i = 0; i < seats.length; i++) {
      const view = await call(i, `${path}/activity`, {});
      assert.ok(view.game.cargo[view.faction]! >= 100);
      const charged = await call(i, `${path}/pulse`, { requestId: randomUUID(), revision: view.revision, action: 'START_CHARGE' });
      assert.equal(charged.game.cargo[view.faction], view.game.cargo[view.faction]! - 100);
    }
    now = 392 * 3600000;
    let retry: { requestId: string; revision: number; action: 'FIRE_PULSE' } | undefined;
    for (let i = 0; i < seats.length; i++) {
      const view = await call(i, `${path}/activity`, {});
      assert.equal(view.game.pulse!.kings.find(k => k.factionId === view.faction)!.state, 'ready');
      const command = { requestId: randomUUID(), revision: view.revision, action: 'FIRE_PULSE' as const };
      if (i === 0) retry = command;
      await call(i, `${path}/pulse`, command);
    }
    for (let hour = 393; hour <= 416; hour++) {
      now = hour * 3600000;
      for (let i = 0; i < seats.length; i++) snapshots[i] = await call(i, `${path}/activity`, {});
      if (snapshots.every(view => view.status === 'game.finished')) break;
    }
    assert.ok(snapshots.every(view => view.status === 'game.finished'), 'natural ending within the declared time budget');
    const final = snapshots[0]!;
    assert.ok(final.game.winner || final.game.draw);
    assert.ok(final.game.eliminated.length >= 9);
    const through = final.game.hour, from = through - 8;
    const replay = await exportSharedReplay(seats[0]!, from, through);
    assert.equal(replay.schemaVersion, 3);
    assert.equal(replay.from, from); assert.equal(replay.through, through);
    const end = seekReplayArtifact(replay, through);
    assert.equal(end.winner, final.game.winner); assert.deepEqual(end.eliminated, final.game.eliminated);
    assert.deepEqual(end.cargo, final.game.cargo); assert.deepEqual(end.rules, rules);
    const raw = encodeReplayArtifact(replay);
    for (const privateValue of [created.id, created.invite, ...seats.map(seat => seat.token)]) assert.ok(!raw.includes(privateValue));
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    service = await GameService.open(file, () => now);
    server = createApi(service, undefined, undefined, { clock: () => now });
    url = await listen(); seats.forEach(seat => { seat.url = url; });
    assert.equal((await call(0, `${path}/pulse`, retry)).status, 'game.finished');
    assert.equal(encodeReplayArtifact(await exportSharedReplay(seats[0]!, from, through)), raw);
  });
});

test('failed endgame evidence survives source cleanup without exposing private state in diagnostics', async t => {
  const root = await mkdtemp(join(tmpdir(), 'machination-endgame-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'), evidenceRoot = join(root, 'retained');
  await mkdir(source);
  const raw = '{"syntheticCredential":"private-test-key","hour":403.25}';
  await writeFile(join(source, 'rooms.json'), raw);
  const failure = new RejectedCommand(413, 'Synthetic endgame failure');
  const reports: string[] = [];
  await assert.rejects(withFailureEvidence({ source, root: evidenceRoot, report: message => reports.push(message) }, async () => { throw failure; }), error => error === failure);
  await rm(source, { recursive: true });
  assert.equal(reports.length, 1);
  assert.doesNotMatch(reports[0]!, /private-test-key/);
  const retained = reports[0]!.slice('Private endgame evidence: '.length);
  assert.equal(await readFile(join(retained, 'rooms.json'), 'utf8'), raw);
  const metadata = JSON.parse(await readFile(join(retained, 'failure.json'), 'utf8'));
  assert.equal(metadata.error.status, 413);
  assert.equal(metadata.error.message, failure.message);
  assert.equal(metadata.runtime.node, process.versions.node);
  assert.ok(Number.isFinite(metadata.elapsedMs) && metadata.elapsedMs >= 0);
  assert.equal((await stat(retained)).mode & 0o777, 0o700);
  assert.equal((await stat(join(retained, 'rooms.json'))).mode & 0o777, 0o600);
  assert.equal((await stat(join(retained, 'failure.json'))).mode & 0o777, 0o600);
});

test('successful endgame checks create no failure evidence', async t => {
  const source = await mkdtemp(join(tmpdir(), 'machination-endgame-success-'));
  t.after(() => rm(source, { recursive: true, force: true }));
  const root = join(source, 'retained');
  let completed = false;
  await withFailureEvidence({ source, root, report: () => assert.fail('Successful checks must not report failures') }, async () => { completed = true; });
  assert.equal(completed, true);
  await assert.rejects(stat(root), { code: 'ENOENT' });
});

test('evidence and diagnostic failures preserve the original endgame error', async t => {
  const source = await mkdtemp(join(tmpdir(), 'machination-endgame-capture-error-'));
  t.after(() => rm(source, { recursive: true, force: true }));
  const root = join(source, 'not-a-directory');
  await writeFile(root, 'occupied');
  const failure = new Error('Original endgame failure');
  for (const reportThrows of [false, true]) {
    const reports: string[] = [];
    await assert.rejects(withFailureEvidence({ source, root, report: message => { reports.push(message); if (reportThrows) throw new Error('Diagnostic failed'); } }, async () => { throw failure; }), error => error === failure);
    assert.deepEqual(reports, ['Private endgame evidence could not be retained.']);
  }
});
