import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createConfiguredGame } from '../src/game/world';

test('the read-only Queen audit finds duplicate and missing cores without disclosing room identities or credentials', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-core-audit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'games.json');
  const healthy = createConfiguredGame({ playerCount: 3, mode: 'mining' }, 0, 73);
  const damaged = structuredClone(healthy); damaged.rules!.mechanicsVersion = 13;
  damaged.rocks.find(r => r.owner === 'you')!.specialists!.push({ id: 'restored-private-id', owner: 'you', kind: 'queen' });
  damaged.rocks.find(r => r.coreOf === 'vesper')!.specialists = [];
  const raw = JSON.stringify({ rooms: [healthy, damaged].map(game => ({ id: 'private-room-id', seats: [{ hash: 'private-credential' }], game })) });
  await writeFile(file, raw);
  const result = spawnSync(process.execPath, ['scripts/audit-queen-control.mjs', file], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), { roomsScanned: 2, skipped: 0, issues: [
    { roomIndex: 1, mechanicsVersion: 13, faction: 'you', activeQueens: 2 },
    { roomIndex: 1, mechanicsVersion: 13, faction: 'vesper', activeQueens: 0 },
  ] });
  assert.doesNotMatch(result.stdout + result.stderr, /private/);
  assert.equal(await readFile(file, 'utf8'), raw);
  await writeFile(file, JSON.stringify({ rooms: [{ game: healthy }, { game: { version: 1 } }] }));
  const valid = spawnSync(process.execPath, ['scripts/audit-queen-control.mjs', file], { encoding: 'utf8' });
  assert.equal(valid.status, 0);
  assert.deepEqual(JSON.parse(valid.stdout), { roomsScanned: 1, skipped: 1, issues: [] });
});

test('the Queen audit refuses malformed input without echoing its contents or rewriting it', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-core-audit-bad-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'games.json');
  const secretRoster = { rooms: [{ game: { version: 2, specialistVersion: 1, rocks: [], fleets: [], eliminated: [], rules: { players: ['private-credential'] } } }] };
  for (const raw of ['{"secret":"private-credential",}', '{"rooms":[{"game":{"version":2,"specialistVersion":1}}]}', '{}', JSON.stringify(secretRoster)]) {
    await writeFile(file, raw);
    const result = spawnSync(process.execPath, ['scripts/audit-queen-control.mjs', file], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /private-credential/);
    assert.equal(await readFile(file, 'utf8'), raw);
  }
});
