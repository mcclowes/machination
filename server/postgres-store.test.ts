import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { GameService } from './service';
import { importDatabaseFile, postgresPersistence, WriterReplacedError, type SqlClient } from './postgres-store';
import { Failure } from './failure';
import { recoverStoredDatabase } from './database-recovery';

function pglite(db: PGlite): SqlClient {
  return {
    query: async (text, params) => (await db.query(text, params)).rows as never,
    transaction: run => db.transaction(tx => run({ query: async (text, params) => (await tx.query(text, params)).rows as never })),
  };
}

function failingArchive(sql: SqlClient, failure: Error): SqlClient {
  return { query: sql.query, transaction: run => sql.transaction(tx => run({ query: async (text, params) => {
    const result = await tx.query(text, params);
    if (text.startsWith('insert into machination_quarantine')) throw failure;
    return result as never;
  } })) };
}

test('SQL restart preserves private blocks and stale retries cannot restore an older choice', async t => {
  const engine = new PGlite();
  t.after(() => engine.close());
  const sql = pglite(engine);
  const host = 'a'.repeat(64), guest = 'b'.repeat(64);
  const service = await GameService.open(postgresPersistence(sql), () => 1000);
  const room = await service.create(host);
  await service.join(room.invite, guest);
  await service.message(room.id, guest, { requestId: 'sql-block-message-1', to: 'you', text: 'Retained private transmission' });
  const block = { requestId: 'sql-block-request-1', revision: 0, player: 'vesper' as const, blocked: true };
  await service.setMessageBlock(room.id, host, block);
  const restarted = await GameService.open(postgresPersistence(sql), () => 1000);
  assert.deepEqual((await restarted.messageBlockSettings(room.id, host)).blocked, ['vesper']);
  assert.deepEqual((await restarted.snapshot(room.id, host)).messages, []);
  assert.equal((await restarted.snapshot(room.id, guest)).messages[0]!.text, 'Retained private transmission');
  await restarted.setMessageBlock(room.id, host, { ...block, requestId: 'sql-block-request-2', revision: 1, blocked: false });
  const retried = await restarted.setMessageBlock(room.id, host, block);
  assert.deepEqual(retried.blocked, []);
  assert.equal(retried.revision, 2);
  const again = await GameService.open(postgresPersistence(sql), () => 1000);
  assert.equal((await again.snapshot(room.id, host)).messages[0]!.text, 'Retained private transmission');
  assert.deepEqual(await again.messageBlockSettings(room.id, guest), { gameId: room.id, faction: 'vesper', revision: 0, blocked: [] });
});

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

test('Postgres atomically quarantines damaged rooms with their original text and global metadata', async t => {
  const engine = new PGlite();
  t.after(() => engine.close());
  const sql = pglite(engine);
  const service = await GameService.open(postgresPersistence(sql), () => 1000);
  const damaged = await service.create('a'.repeat(64));
  const healthy = await service.create('b'.repeat(64));
  const row = (await sql.query<{ data: string }>('select data::text as data from machination_rooms where id = $1', [damaged.id]))[0]!;
  const data = JSON.parse(row.data); data.game.version = 999;
  const original = JSON.stringify(data, null, 2);
  await sql.query('update machination_rooms set data = $1::text::json where id = $2', [original, damaged.id]);
  const metadata = await sql.query('select key, data::text as data from machination_state where key <> \'writer\' order by key');
  const recovered = await GameService.open(postgresPersistence(sql), () => 1000, undefined, { databaseRecovery: 'quarantine' });
  assert.deepEqual(await recovered.snapshot(healthy.id, 'b'.repeat(64)), healthy);
  await assert.rejects(recovered.snapshot(damaged.id, 'a'.repeat(64)), error => error instanceof Failure && error.status === 503);
  const archives = await sql.query<{ data: string }>('select data::text as data from machination_quarantine');
  assert.equal(archives.length, 1);
  const archive = JSON.parse(archives[0]!.data);
  assert.equal(archive.format, 'postgres.v1');
  assert.deepEqual(archive.rooms, [{ id: damaged.id, data: original }]);
  assert.deepEqual(archive.state, metadata);
  assert.equal((await sql.query('select 1 from machination_rooms where id = $1', [damaged.id])).length, 0);
  const restarted = await GameService.open(postgresPersistence(sql), () => 1000);
  await assert.rejects(restarted.create('a'.repeat(64)), error => error instanceof Failure && error.status === 503);
  assert.deepEqual(await restarted.snapshot(healthy.id, 'b'.repeat(64)), healthy);
  assert.equal((await sql.query('select 1 from machination_quarantine')).length, 1);
  assert.equal((await sql.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname = 'machination_quarantine'"))[0]!.relrowsecurity, true);
});

test('a failed quarantine transaction preserves source rows and leaves no partial archive', async t => {
  const engine = new PGlite(); t.after(() => engine.close());
  const sql = pglite(engine);
  const room = await (await GameService.open(postgresPersistence(sql), () => 1000)).create('a'.repeat(64));
  const row = (await sql.query<{ data: string }>('select data::text as data from machination_rooms where id = $1', [room.id]))[0]!;
  const data = JSON.parse(row.data); data.game.version = 999;
  const original = JSON.stringify(data);
  await sql.query('update machination_rooms set data = $1::text::json where id = $2', [original, room.id]);
  const failure = new Error('Simulated quarantine commit failure.');
  const failing = failingArchive(sql, failure);
  await assert.rejects(GameService.open(postgresPersistence(failing), () => 1000, undefined, { databaseRecovery: 'quarantine' }), error => error === failure);
  assert.equal((await sql.query('select 1 from machination_quarantine')).length, 0);
  assert.equal((await sql.query<{ data: string }>('select data::text as data from machination_rooms where id = $1', [room.id]))[0]!.data, original);
  assert.equal((await sql.query("select 1 from machination_state where key = 'quarantined'")).length, 0);
});

test('a replaced writer cannot archive or remove rooms during recovery', async t => {
  const engine = new PGlite(); t.after(() => engine.close());
  const sql = pglite(engine);
  const room = await (await GameService.open(postgresPersistence(sql), () => 1000)).create('a'.repeat(64));
  const row = (await sql.query<{ data: string }>('select data::text as data from machination_rooms where id = $1', [room.id]))[0]!;
  const data = JSON.parse(row.data); data.game.version = 999;
  const original = JSON.stringify(data);
  await sql.query('update machination_rooms set data = $1::text::json where id = $2', [original, room.id]);
  const stale = postgresPersistence(sql);
  const { database, rejected } = recoverStoredDatabase(await stale.load(), 'quarantine');
  await postgresPersistence(sql).load();
  await assert.rejects(stale.quarantine!(database, rejected), WriterReplacedError);
  assert.equal((await sql.query('select 1 from machination_quarantine')).length, 0);
  assert.equal((await sql.query<{ data: string }>('select data::text as data from machination_rooms where id = $1', [room.id]))[0]!.data, original);
});

test('missing Postgres version metadata cannot be mistaken for an empty database', async t => {
  const engine = new PGlite(); t.after(() => engine.close());
  const sql = pglite(engine);
  await (await GameService.open(postgresPersistence(sql), () => 1000)).create('a'.repeat(64));
  await sql.query("delete from machination_state where key = 'version'");
  const before = await sql.query('select id, data::text as data from machination_rooms');
  await assert.rejects(postgresPersistence(sql).hasData(), /database metadata/);
  await assert.rejects(GameService.open(postgresPersistence(sql), () => 1000, undefined, { databaseRecovery: 'quarantine' }), /database metadata/);
  assert.deepEqual(await sql.query('select id, data::text as data from machination_rooms'), before);
});

test('legacy recovery imports healthy state and its original source archive without rewriting the file', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-import-quarantine-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'games.json');
  const service = await GameService.open(file, () => 1000);
  const damaged = await service.create('a'.repeat(64));
  const healthy = await service.create('b'.repeat(64));
  const database = JSON.parse(await readFile(file, 'utf8')); database.rooms[0].game.version = 999;
  const source = JSON.stringify(database, null, 2);
  await writeFile(file, source);
  const engine = new PGlite(); t.after(() => engine.close());
  const sql = pglite(engine);
  assert.equal(await importDatabaseFile(file, postgresPersistence(sql), 'quarantine'), true);
  assert.equal(await readFile(file, 'utf8'), source);
  const restored = await GameService.open(postgresPersistence(sql), () => 1000);
  assert.deepEqual(await restored.snapshot(healthy.id, 'b'.repeat(64)), healthy);
  await assert.rejects(restored.snapshot(damaged.id, 'a'.repeat(64)), error => error instanceof Failure && error.status === 503);
  const archive = JSON.parse((await sql.query<{ data: string }>('select data::text as data from machination_quarantine'))[0]!.data);
  assert.equal(archive.format, 'json-import.v1');
  assert.equal(archive.source, source);
  assert.deepEqual(archive.rejected, [0]);
});

test('a delayed first import cannot replace accepted operations or fence their writer', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-import-race-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'games.json');
  const legacy = await (await GameService.open(file, () => 1000)).create('a'.repeat(64));
  const source = await readFile(file, 'utf8');
  const engine = new PGlite(); t.after(() => engine.close());
  const sql = pglite(engine);
  const importer = postgresPersistence(sql);
  assert.equal(await importer.hasData(), false);
  const live = await GameService.open(postgresPersistence(sql), () => 1000);
  const accepted = await live.create('b'.repeat(64));
  assert.equal(await importer.importSnapshot(JSON.parse(source), source, []), false);
  const later = await live.create('c'.repeat(64));
  assert.equal((await live.snapshot(accepted.id, 'b'.repeat(64))).id, accepted.id);
  assert.equal((await live.snapshot(later.id, 'c'.repeat(64))).id, later.id);
  assert.equal((await sql.query('select 1 from machination_rooms where id = $1', [legacy.id])).length, 0);
  assert.equal((await sql.query('select 1 from machination_quarantine')).length, 0);
});

test('a failed first import leaves both the source file and empty target untouched', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-import-failure-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'games.json');
  await (await GameService.open(file, () => 1000)).create('a'.repeat(64));
  const database = JSON.parse(await readFile(file, 'utf8')); database.rooms[0].game.version = 999;
  const source = JSON.stringify(database);
  await writeFile(file, source);
  const engine = new PGlite(); t.after(() => engine.close());
  const sql = pglite(engine), failure = new Error('Import archive refused.');
  await assert.rejects(importDatabaseFile(file, postgresPersistence(failingArchive(sql, failure)), 'quarantine'), error => error === failure);
  assert.equal(await readFile(file, 'utf8'), source);
  assert.equal(await postgresPersistence(sql).hasData(), false);
  assert.equal((await sql.query('select 1 from machination_rooms')).length, 0);
  assert.equal((await sql.query('select 1 from machination_quarantine')).length, 0);
});
