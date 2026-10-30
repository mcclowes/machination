import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { GameService } from './service';
import { importDatabaseFile, postgresPersistence, WriterReplacedError, type SqlClient } from './postgres-store';

function pglite(db: PGlite): SqlClient {
  return {
    query: async (text, params) => (await db.query(text, params)).rows as never,
    transaction: run => db.transaction(tx => run({ query: async (text, params) => (await tx.query(text, params)).rows as never })),
  };
}

test('operations survive a service restart against the same database', async () => {
  const db = pglite(new PGlite());
  const host = 'a'.repeat(64), guest = 'b'.repeat(64);
  const service = await GameService.open(postgresPersistence(db), () => 1000);
  const room = await service.create(host);
  await service.join(room.invite!, guest);
  await service.message(room.id, host, { requestId: 'restart-message-1', to: 'vesper', text: 'Still here?' });

  const before = await service.snapshot(room.id, guest);

  const restarted = await GameService.open(postgresPersistence(db), () => 1000);
  assert.deepEqual(await restarted.snapshot(room.id, guest), before);
  assert.equal((await restarted.snapshot(room.id, host)).messages[0]!.text, 'Still here?');
});

test('a replaced service instance cannot overwrite the instance that took over', async () => {
  const db = pglite(new PGlite());
  const host = 'a'.repeat(64);
  const stale = await GameService.open(postgresPersistence(db), () => 1000);
  const room = await stale.create(host);
  const current = await GameService.open(postgresPersistence(db), () => 1000);

  await assert.rejects(stale.create('c'.repeat(64)), WriterReplacedError);
  const later = await current.create('d'.repeat(64));
  const reopened = await GameService.open(postgresPersistence(db), () => 1000);
  assert.equal((await reopened.snapshot(room.id, host)).id, room.id);
  assert.equal((await reopened.snapshot(later.id, 'd'.repeat(64))).id, later.id);
});

test('an existing JSON snapshot moves into an empty database once', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'games.json');
  const host = 'a'.repeat(64);
  const legacy = await GameService.open(file, () => 1000);
  const room = await legacy.create(host);
  const before = await legacy.snapshot(room.id, host);

  const db = pglite(new PGlite());
  assert.equal(await importDatabaseFile(file, postgresPersistence(db)), true);
  const migrated = await GameService.open(postgresPersistence(db), () => 1000);
  assert.deepEqual(await migrated.snapshot(room.id, host), before);

  const later = await legacy.create('e'.repeat(64));
  assert.equal(await importDatabaseFile(file, postgresPersistence(db)), false);
  await assert.rejects(GameService.open(postgresPersistence(db), () => 1000).then(s => s.snapshot(later.id, 'e'.repeat(64))), /not found/i);
});

test('no import happens when there is no JSON snapshot', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-import-empty-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.equal(await importDatabaseFile(join(directory, 'games.json'), postgresPersistence(pglite(new PGlite()))), false);
});
