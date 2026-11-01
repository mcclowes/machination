/** @format */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { GameService } from './service';
import { DatabaseStore, type Database } from './database';
import { recoverStoredDatabase } from './database-recovery';
import { createLegacyGame } from '../src/game/legacy';
import { importDatabaseFile, postgresPersistence, type SqlClient } from './postgres-store';

function pglite(engine: PGlite): SqlClient {
  return {
    query: async (text, params) => (await engine.query(text, params)).rows as never,
    transaction: (run) =>
      engine.transaction((tx) =>
        run({ query: async (text, params) => (await tx.query(text, params)).rows as never }),
      ),
  };
}
async function fixture(t: TestContext, projectedDepth?: number) {
  const engine = new PGlite();
  t.after(() => engine.close());
  const sql = pglite(engine);
  const service = await GameService.open(postgresPersistence(sql), () => 1000, createLegacyGame);
  const damaged = await service.create('a'.repeat(64));
  const healthy = await service.create('b'.repeat(64));
  const normalized = await DatabaseStore.open(postgresPersistence(sql));
  await normalized.transaction(() => undefined);
  const [room] = await sql.query<{ data: string }>(
    'select data::text as data from machination_rooms where id = $1',
    [damaged.id],
  );
  const source = (depth: number) =>
    room!.data.slice(0, -1) + ',"deep":' + '['.repeat(depth) + '0' + ']'.repeat(depth) + '}';
  const admitted = source(512);
  await sql.query('update machination_rooms set data = $1::text::json where id = $2', [
    admitted,
    damaged.id,
  ]);
  const [check] = await sql.query<{ data: string }>(
    'select data::text as data from machination_rooms where id = $1',
    [damaged.id],
  );
  assert.equal(check!.data, admitted, 'SQL must admit and retain the substantial deep fixture');
  const original = projectedDepth === undefined ? admitted : source(projectedDepth);
  // PGlite cannot admit 8000 containers; only this adapter projection exercises that application boundary.
  const adapter: SqlClient =
    projectedDepth === undefined
      ? sql
      : {
          query: sql.query,
          transaction: (run) =>
            sql.transaction((tx) =>
              run({
                query: async (text, params) => {
                  const rows = await tx.query<Record<string, unknown>>(text, params);
                  return (
                    text.startsWith('select id, data::text as data from machination_rooms')
                      ? rows.map((row) =>
                          row.id === damaged.id ? { ...row, data: original } : row,
                        )
                      : rows
                  ) as never;
                },
              }),
            ),
        };
  return { sql, adapter, original, admitted, damaged, healthy };
}

test('adapter-projected 8000-level room reaches quarantine without recursive SQL cache failures', async (t) => {
  const f = await fixture(t, 8000);
  const recovered = await GameService.open(
    postgresPersistence(f.adapter),
    () => 1000,
    createLegacyGame,
    { databaseRecovery: 'quarantine' },
  );
  assert.deepEqual(await recovered.snapshot(f.healthy.id, 'b'.repeat(64)), f.healthy);
  const [archive] = await f.sql.query<{ data: string }>(
    'select data::text as data from machination_quarantine',
  );
  assert.deepEqual(JSON.parse(archive!.data).rooms, [{ id: f.damaged.id, data: f.original }]);
});

test('admitted deep SQL rooms preserve exact evidence, healthy rows, and restart after ordinary writes', async (t) => {
  const f = await fixture(t);
  const before = await f.sql.query<{ id: string; data: string; updated_at: unknown }>(
    'select id, data::text as data, updated_at from machination_rooms order by ordinal',
  );
  const metadata = await f.sql.query(
    "select key, data::text as data from machination_state where key <> 'writer' order by key",
  );
  await assert.rejects(
    GameService.open(postgresPersistence(f.sql), () => 1000, createLegacyGame),
    /nesting/,
  );
  assert.deepEqual(
    await f.sql.query(
      'select id, data::text as data, updated_at from machination_rooms order by ordinal',
    ),
    before,
  );
  assert.equal((await f.sql.query('select 1 from machination_quarantine')).length, 0);
  const recovered = await GameService.open(
    postgresPersistence(f.sql),
    () => 1000,
    createLegacyGame,
    { databaseRecovery: 'quarantine' },
  );
  assert.deepEqual(await recovered.snapshot(f.healthy.id, 'b'.repeat(64)), f.healthy);
  const [archive] = await f.sql.query<{ data: string }>(
    'select data::text as data from machination_quarantine',
  );
  const evidence = JSON.parse(archive!.data);
  assert.deepEqual(evidence.rooms, [{ id: f.damaged.id, data: f.original }]);
  assert.deepEqual(evidence.state, metadata);
  const [healthyRow] = await f.sql.query(
    'select id, data::text as data, updated_at from machination_rooms where id = $1',
    [f.healthy.id],
  );
  assert.deepEqual(healthyRow, before[1]);
  const later = await recovered.create('c'.repeat(64));
  const restarted = await GameService.open(
    postgresPersistence(f.sql),
    () => 1000,
    createLegacyGame,
  );
  assert.deepEqual(await restarted.snapshot(f.healthy.id, 'b'.repeat(64)), f.healthy);
  assert.deepEqual(await restarted.snapshot(later.id, 'c'.repeat(64)), later);
  await assert.rejects(restarted.create('a'.repeat(64)), /temporarily unavailable/);
  assert.equal((await f.sql.query('select 1 from machination_quarantine')).length, 1);
});

for (const change of ['room', 'state', 'report'] as const) {
  test(`recovery refuses changed raw ${change} bytes without archive or writes`, async (t) => {
    const f = await fixture(t);
    const report = '{ "version": 900, "value": 1e999 }';
    await f.sql.query(
      "insert into machination_state (key, data) values ('futureState', '{\"value\":1}'::json), ('messageReports', $1::text::json)",
      [report],
    );
    const persistence = postgresPersistence(f.sql);
    const plan = recoverStoredDatabase(await persistence.load(), 'quarantine');
    if (change === 'room')
      await f.sql.query('update machination_rooms set data = $1::text::json where id = $2', [
        ' ' + f.original,
        f.damaged.id,
      ]);
    if (change === 'state')
      await f.sql.query(
        "update machination_state set data = '{ \"value\":1}'::json where key = 'futureState'",
      );
    if (change === 'report')
      await f.sql.query(
        "update machination_state set data = $1::text::json where key = 'messageReports'",
        [report.replace('1e999', '2e999')],
      );
    const before = await f.sql.query(
      'select id, data::text as data from machination_rooms order by ordinal',
    );
    const state = await f.sql.query(
      'select key, data::text as data from machination_state order by key',
    );
    await assert.rejects(
      persistence.quarantine!(plan.database, plan.rejected),
      /changed during recovery/,
    );
    assert.deepEqual(
      await f.sql.query('select id, data::text as data from machination_rooms order by ordinal'),
      before,
    );
    assert.deepEqual(
      await f.sql.query('select key, data::text as data from machination_state order by key'),
      state,
    );
    assert.equal((await f.sql.query('select 1 from machination_quarantine')).length, 0);
  });
}

test('failed recovery writes roll back original rows and leave caches retryable', async (t) => {
  const f = await fixture(t);
  const failure = new Error('injected unavailable-marker write failure');
  let failing = true;
  const adapter: SqlClient = {
    query: f.sql.query,
    transaction: (run) =>
      f.sql.transaction((tx) =>
        run({
          query: async (text, params) => {
            if (
              failing &&
              text.startsWith('insert into machination_state') &&
              params?.[0] === 'quarantined'
            )
              throw failure;
            return tx.query(text, params);
          },
        }),
      ),
  };
  const persistence = postgresPersistence(adapter);
  const plan = recoverStoredDatabase(await persistence.load(), 'quarantine');
  const before = await f.sql.query(
    'select id, data::text as data from machination_rooms order by ordinal',
  );
  const state = await f.sql.query(
    'select key, data::text as data from machination_state order by key',
  );
  await assert.rejects(
    persistence.quarantine!(plan.database, plan.rejected),
    (error) => error === failure,
  );
  assert.deepEqual(
    await f.sql.query('select id, data::text as data from machination_rooms order by ordinal'),
    before,
  );
  assert.deepEqual(
    await f.sql.query('select key, data::text as data from machination_state order by key'),
    state,
  );
  assert.equal((await f.sql.query('select 1 from machination_quarantine')).length, 0);
  failing = false;
  await persistence.quarantine!(plan.database, plan.rejected);
  assert.equal((await f.sql.query('select 1 from machination_quarantine')).length, 1);
  assert.deepEqual(await f.sql.query('select id from machination_rooms order by ordinal'), [
    { id: f.healthy.id },
  ]);
});

test('another writer fences deep recovery without archive or row changes', async (t) => {
  const f = await fixture(t);
  const persistence = postgresPersistence(f.sql);
  const plan = recoverStoredDatabase(await persistence.load(), 'quarantine');
  await postgresPersistence(f.sql).load();
  const before = await f.sql.query(
    'select id, data::text as data from machination_rooms order by ordinal',
  );
  await assert.rejects(
    persistence.quarantine!(plan.database, plan.rejected),
    /Another service instance/,
  );
  assert.deepEqual(
    await f.sql.query('select id, data::text as data from machination_rooms order by ordinal'),
    before,
  );
  assert.equal((await f.sql.query('select 1 from machination_quarantine')).length, 0);
});

test('ordinary adapter saves retain unknown state bytes and canonical healthy no-op fingerprints', async (t) => {
  const f = await fixture(t);
  const future = '{ "version": 900, "value": 1e99 }';
  await f.sql.query(
    "insert into machination_state (key, data) values ('futureState', $1::text::json)",
    [future],
  );
  const persistence = postgresPersistence(f.sql);
  const stored = (await persistence.load()) as Database;
  const before = await f.sql.query(
    'select id, data::text as data, updated_at from machination_rooms order by ordinal',
  );
  // This adapter-level save is intentionally below validation: its unchanged deep row is still evidence.
  await persistence.save(stored);
  assert.deepEqual(
    await f.sql.query(
      'select id, data::text as data, updated_at from machination_rooms order by ordinal',
    ),
    before,
  );
  stored.rooms[1]!.revision++;
  await persistence.save(stored);
  const plan = recoverStoredDatabase(stored, 'quarantine');
  await persistence.quarantine!(plan.database, plan.rejected);
  const [archive] = await f.sql.query<{ data: string }>(
    'select data::text as data from machination_quarantine',
  );
  assert.deepEqual(
    JSON.parse(archive!.data).state.find((row: { key: string }) => row.key === 'futureState'),
    { key: 'futureState', data: future },
  );
  const [row] = await f.sql.query<{ data: string }>(
    "select data::text as data from machination_state where key = 'futureState'",
  );
  assert.equal(row!.data, future);
});

for (const failFirst of [false, true]) {
  test(`deep file import preserves source, quarantines safely, and ${failFirst ? 'rolls back then retries' : 'survives restart'}`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'machination-deep-import-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = join(directory, 'games.json');
    const legacy = await GameService.open(file, () => 1000, createLegacyGame);
    await legacy.create('a'.repeat(64));
    const healthy = await legacy.create('b'.repeat(64));
    const database = JSON.parse(await readFile(file, 'utf8'));
    const first = JSON.stringify(database.rooms[0]);
    const source =
      '{"version":1,"rooms":[' +
      first.slice(0, -1) +
      ',"deep":' +
      '['.repeat(8000) +
      '0' +
      ']'.repeat(8000) +
      '},' +
      JSON.stringify(database.rooms[1]) +
      ']}';
    await writeFile(file, source);
    const engine = new PGlite();
    t.after(() => engine.close());
    const sql = pglite(engine);
    let failing = failFirst;
    const failure = new Error('injected import metadata failure');
    const adapter: SqlClient = {
      query: sql.query,
      transaction: (run) =>
        sql.transaction((tx) =>
          run({
            query: async (text, params) => {
              if (
                failing &&
                text.startsWith('insert into machination_state') &&
                params?.[0] === 'version'
              )
                throw failure;
              return tx.query(text, params);
            },
          }),
        ),
    };
    const persistence = postgresPersistence(adapter);
    await assert.rejects(importDatabaseFile(file, persistence), /nesting/);
    assert.equal((await sql.query('select 1 from machination_state')).length, 0);
    assert.equal((await sql.query('select 1 from machination_rooms')).length, 0);
    assert.equal((await sql.query('select 1 from machination_quarantine')).length, 0);
    if (failFirst) {
      await assert.rejects(
        importDatabaseFile(file, persistence, 'quarantine'),
        (error) => error === failure,
      );
      assert.equal((await sql.query('select 1 from machination_state')).length, 0);
      assert.equal((await sql.query('select 1 from machination_rooms')).length, 0);
      assert.equal((await sql.query('select 1 from machination_quarantine')).length, 0);
      failing = false;
    }
    assert.equal(await importDatabaseFile(file, persistence, 'quarantine'), true);
    assert.equal(await readFile(file, 'utf8'), source);
    const [archive] = await sql.query<{ data: string }>(
      'select data::text as data from machination_quarantine',
    );
    assert.deepEqual(JSON.parse(archive!.data), {
      format: 'json-import.v1',
      source,
      rejected: [0],
    });
    const recovered = await GameService.open(
      postgresPersistence(sql),
      () => 1000,
      createLegacyGame,
    );
    assert.deepEqual(await recovered.snapshot(healthy.id, 'b'.repeat(64)), healthy);
    const later = await recovered.create('c'.repeat(64));
    const restarted = await GameService.open(
      postgresPersistence(sql),
      () => 1000,
      createLegacyGame,
    );
    assert.deepEqual(await restarted.snapshot(healthy.id, 'b'.repeat(64)), healthy);
    assert.deepEqual(await restarted.snapshot(later.id, 'c'.repeat(64)), later);
    await assert.rejects(restarted.create('a'.repeat(64)), /temporarily unavailable/);
    assert.equal(await importDatabaseFile(file, persistence, 'quarantine'), false);
    assert.equal(await readFile(file, 'utf8'), source);
    assert.equal((await sql.query('select 1 from machination_quarantine')).length, 1);
  });
}

test('deep room identities use the raw body while SQL evidence retains original row keys', async (t) => {
  const f = await fixture(t);
  const original = f.original.replace(f.damaged.id, f.healthy.id);
  await f.sql.query('update machination_rooms set data = $1::text::json where id = $2', [
    original,
    f.damaged.id,
  ]);
  const before = await f.sql.query(
    'select id, data::text as data from machination_rooms order by ordinal',
  );
  await GameService.open(postgresPersistence(f.sql), () => 1000, createLegacyGame, {
    databaseRecovery: 'quarantine',
  });
  assert.deepEqual(await f.sql.query('select id from machination_rooms'), []);
  const [archive] = await f.sql.query<{ data: string }>(
    'select data::text as data from machination_quarantine',
  );
  assert.deepEqual(JSON.parse(archive!.data).rooms, before);
  assert.deepEqual(JSON.parse(archive!.data).rejected, [0, 1]);
});

test('deep shared SQL metadata refuses startup without archiving or changing non-writer rows', async (t) => {
  const f = await fixture(t);
  const source = '['.repeat(512) + '0' + ']'.repeat(512);
  await f.sql.query(
    "insert into machination_state (key, data) values ('futureState', $1::text::json)",
    [source],
  );
  const before = await f.sql.query(
    'select id, data::text as data from machination_rooms order by ordinal',
  );
  const state = await f.sql.query(
    "select key, data::text as data from machination_state where key <> 'writer' order by key",
  );
  await assert.rejects(
    GameService.open(postgresPersistence(f.sql), () => 1000, createLegacyGame, {
      databaseRecovery: 'quarantine',
    }),
    /nesting/,
  );
  assert.deepEqual(
    await f.sql.query('select id, data::text as data from machination_rooms order by ordinal'),
    before,
  );
  assert.deepEqual(
    await f.sql.query(
      "select key, data::text as data from machination_state where key <> 'writer' order by key",
    ),
    state,
  );
  assert.equal((await f.sql.query('select 1 from machination_quarantine')).length, 0);
});

for (const key of ['rooms', '__proto__']) {
  test(`reserved SQL metadata ${key} refuses load without changing rows, archive, or writer ownership`, async (t) => {
    const f = await fixture(t);
    const room = JSON.parse(f.original);
    delete room.deep;
    await f.sql.query('update machination_rooms set data = $1::text::json where id = $2', [
      JSON.stringify(room),
      f.damaged.id,
    ]);
    const live = await GameService.open(postgresPersistence(f.sql), () => 1000, createLegacyGame);
    const value = key === 'rooms' ? '[]' : '{"injected":true}';
    await f.sql.query('insert into machination_state (key, data) values ($1, $2::text::json)', [
      key,
      value,
    ]);
    const before = await f.sql.query(
      'select id, data::text as data, updated_at from machination_rooms order by ordinal',
    );
    const state = await f.sql.query(
      'select key, data::text as data from machination_state order by key',
    );
    await assert.rejects(
      GameService.open(postgresPersistence(f.sql), () => 1000, createLegacyGame, {
        databaseRecovery: 'quarantine',
      }),
      /Damaged Postgres database metadata/,
    );
    assert.deepEqual(
      await f.sql.query(
        'select id, data::text as data, updated_at from machination_rooms order by ordinal',
      ),
      before,
    );
    assert.deepEqual(
      await f.sql.query('select key, data::text as data from machination_state order by key'),
      state,
    );
    assert.equal((await f.sql.query('select 1 from machination_quarantine')).length, 0);
    const later = await live.create('c'.repeat(64));
    assert.equal((await live.snapshot(f.damaged.id, 'a'.repeat(64))).id, f.damaged.id);
    assert.equal((await live.snapshot(f.healthy.id, 'b'.repeat(64))).id, f.healthy.id);
    assert.equal((await live.snapshot(later.id, 'c'.repeat(64))).id, later.id);
    assert.deepEqual(
      (await f.sql.query('select id from machination_rooms order by ordinal')).slice(0, 2),
      [{ id: f.damaged.id }, { id: f.healthy.id }],
    );
    const [retained] = await f.sql.query<{ data: string }>(
      'select data::text as data from machination_state where key = $1',
      [key],
    );
    assert.equal(retained!.data, value);
  });
}

test('overflowing SQL global metadata refuses a usable service without changing non-writer source', async (t) => {
  const f = await fixture(t);
  const source = '{ "limit" : 1e999 }';
  await f.sql.query(
    "insert into machination_state (key, data) values ('futureMetadata', $1::text::json)",
    [source],
  );
  const before = await f.sql.query(
    'select id, data::text as data from machination_rooms order by ordinal',
  );
  const state = await f.sql.query(
    "select key, data::text as data from machination_state where key <> 'writer' order by key",
  );
  assert.equal(
    (state.find((row) => row.key === 'futureMetadata') as { data: string }).data,
    source,
  );
  for (const databaseRecovery of ['strict', 'quarantine'] as const) {
    await assert.rejects(
      GameService.open(postgresPersistence(f.sql), () => 1000, createLegacyGame, {
        databaseRecovery,
      }),
      /non-finite/,
    );
    assert.deepEqual(
      await f.sql.query('select id, data::text as data from machination_rooms order by ordinal'),
      before,
    );
    assert.deepEqual(
      await f.sql.query(
        "select key, data::text as data from machination_state where key <> 'writer' order by key",
      ),
      state,
    );
    assert.equal((await f.sql.query('select 1 from machination_quarantine')).length, 0);
  }
});
