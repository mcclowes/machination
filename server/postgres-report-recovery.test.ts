/** @format */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { GameService } from './service';
import { postgresPersistence, type SqlClient } from './postgres-store';
import { createLegacyGame } from '../src/game/legacy';
import { recoverStoredDatabase } from './database-recovery';

function pglite(engine: PGlite): SqlClient {
  return {
    query: async (text, params) => (await engine.query(text, params)).rows as never,
    transaction: (run) =>
      engine.transaction((tx) =>
        run({
          query: async (text, params) => (await tx.query(text, params)).rows as never,
        }),
      ),
  };
}
async function fixture(t: TestContext, reportSource: string) {
  const engine = new PGlite();
  t.after(() => engine.close());
  const sql = pglite(engine);
  const service = await GameService.open(postgresPersistence(sql), () => 1000, createLegacyGame);
  const damaged = await service.create('a'.repeat(64));
  const healthy = await service.create('b'.repeat(64));
  const original = (
    await sql.query<{ data: string }>(
      'select data::text as data from machination_rooms where id = $1',
      [damaged.id],
    )
  )[0]!.data;
  const damagedSource = JSON.stringify({ ...JSON.parse(original), revision: -1 }, null, 2);
  await sql.query('update machination_rooms set data = $1::text::json where id = $2', [
    damagedSource,
    damaged.id,
  ]);
  await sql.query(
    "insert into machination_state (key, data) values ('messageReports', $1::text::json)",
    [reportSource],
  );
  const inserted = await sql.query<{ data: string }>(
    "select data::text as data from machination_state where key = 'messageReports'",
  );
  assert.equal(inserted.length, 1, 'the SQL fixture must actually admit its report source');
  assert.equal(inserted[0]!.data, reportSource, 'the SQL fixture must retain exact report source');
  const rows = () =>
    sql.query('select id, data::text as data from machination_rooms order by ordinal');
  const report = async () =>
    (
      await sql.query<{ data: string }>(
        "select data::text as data from machination_state where key = 'messageReports'",
      )
    )[0]!.data;
  const archives = () =>
    sql.query<{ data: string }>('select data::text as data from machination_quarantine');
  const before = await rows();
  return { sql, damaged, healthy, damagedSource, reportSource, rows, report, archives, before };
}
const futureReport =
  '{ "version":7, "cases":[{"futureValue":1e999,"text":"Retain original report evidence"}] }';
const SQL_REPORT_DEPTH = 4096;
const deepReport = '['.repeat(SQL_REPORT_DEPTH) + '0' + ']'.repeat(SQL_REPORT_DEPTH);

test('quarantine accepts unchanged raw future report state and archives its exact SQL source', async (t) => {
  const f = await fixture(t, futureReport);
  const recovered = await GameService.open(
    postgresPersistence(f.sql),
    () => 1000,
    createLegacyGame,
    { databaseRecovery: 'quarantine' },
  );
  assert.equal((await recovered.snapshot(f.healthy.id, 'b'.repeat(64))).id, f.healthy.id);
  assert.equal(
    (await recovered.reportingAvailability(f.healthy.id, 'b'.repeat(64))).available,
    false,
  );
  assert.equal(await f.report(), futureReport);
  const rows = await f.archives();
  assert.equal(rows.length, 1);
  const archive = JSON.parse(rows[0]!.data);
  assert.deepEqual(archive.rooms, [{ id: f.damaged.id, data: f.damagedSource }]);
  assert.equal(
    archive.state.find((row: { key: string }) => row.key === 'messageReports').data,
    futureReport,
  );
  await assert.rejects(recovered.snapshot(f.damaged.id, 'a'.repeat(64)), {
    code: 'game.unavailable.recovery',
  });
});

test('deep and already enveloped report sources survive room quarantine and restart without rewriting', async (t) => {
  for (const reportSource of [
    deepReport,
    JSON.stringify({ format: 'message-report-source.v1', source: futureReport }),
  ]) {
    const f = await fixture(t, reportSource);
    const recovered = await GameService.open(
      postgresPersistence(f.sql),
      () => 1000,
      createLegacyGame,
      { databaseRecovery: 'quarantine' },
    );
    assert.equal((await recovered.snapshot(f.healthy.id, 'b'.repeat(64))).id, f.healthy.id);
    assert.equal(await f.report(), reportSource);
    const archived = JSON.parse((await f.archives())[0]!.data);
    assert.equal(
      archived.state.find((row: { key: string }) => row.key === 'messageReports').data,
      reportSource,
    );
    const reopened = await GameService.open(
      postgresPersistence(f.sql),
      () => 1000,
      createLegacyGame,
      { databaseRecovery: 'quarantine' },
    );
    assert.equal((await reopened.snapshot(f.healthy.id, 'b'.repeat(64))).id, f.healthy.id);
    assert.equal(await f.report(), reportSource);
    assert.equal((await f.archives()).length, 1);
  }
});

test('strict refusal preserves raw and deep report rows and creates no quarantine archive', async (t) => {
  for (const reportSource of [futureReport, deepReport]) {
    const f = await fixture(t, reportSource);
    await assert.rejects(
      GameService.open(postgresPersistence(f.sql), () => 1000, createLegacyGame, {
        databaseRecovery: 'strict',
      }),
      /Damaged server database/,
    );
    assert.deepEqual(await f.rows(), f.before);
    assert.equal(await f.report(), reportSource);
    assert.equal((await f.archives()).length, 0);
    assert.equal(
      (await f.sql.query("select 1 from machination_state where key = 'quarantined'")).length,
      0,
    );
  }
});

test('an externally replaced report source is detected after loading and before quarantine writes', async (t) => {
  for (const reportSource of [futureReport, deepReport]) {
    const f = await fixture(t, reportSource);
    const persistence = postgresPersistence(f.sql);
    const { database, rejected } = recoverStoredDatabase(await persistence.load(), 'quarantine');
    const replacement =
      reportSource === futureReport
        ? reportSource.replace('Retain original', 'Externally replaced')
        : reportSource.replace('0', '1');
    await f.sql.query(
      "update machination_state set data = $1::text::json where key = 'messageReports'",
      [replacement],
    );
    await assert.rejects(
      persistence.quarantine!(database, rejected),
      /Database changed during recovery/,
    );
    assert.deepEqual(await f.rows(), f.before);
    assert.equal(await f.report(), replacement);
    assert.equal((await f.archives()).length, 0);
    assert.equal(
      (await f.sql.query("select 1 from machination_state where key = 'quarantined'")).length,
      0,
    );
  }
});

test('normalization retains concurrent-change detection for other state and healthy room rows', async (t) => {
  for (const target of ['state', 'room']) {
    const f = await fixture(t, futureReport);
    const persistence = postgresPersistence(f.sql);
    const { database, rejected } = recoverStoredDatabase(await persistence.load(), 'quarantine');
    if (target === 'state') {
      await f.sql.query("update machination_state set data = '2'::json where key = 'version'");
    } else {
      const row = (
        await f.sql.query<{ data: string }>(
          'select data::text as data from machination_rooms where id = $1',
          [f.healthy.id],
        )
      )[0]!;
      const changed = JSON.parse(row.data);
      changed.revision++;
      await f.sql.query('update machination_rooms set data = $1::text::json where id = $2', [
        JSON.stringify(changed),
        f.healthy.id,
      ]);
    }
    const changedRows = await f.rows();
    const changedState = await f.sql.query(
      "select key, data::text as data from machination_state where key <> 'writer' order by key",
    );
    await assert.rejects(
      persistence.quarantine!(database, rejected),
      /Database changed during recovery/,
    );
    assert.deepEqual(await f.rows(), changedRows);
    assert.deepEqual(
      await f.sql.query(
        "select key, data::text as data from machination_state where key <> 'writer' order by key",
      ),
      changedState,
    );
    assert.equal(await f.report(), futureReport);
    assert.equal((await f.archives()).length, 0);
  }
});

test('a failed archive insertion rolls back recovery while retaining raw report evidence', async (t) => {
  const f = await fixture(t, futureReport);
  const failure = new Error('Injected raw report archive failure');
  const failing: SqlClient = {
    query: f.sql.query,
    transaction: (run) =>
      f.sql.transaction((tx) =>
        run({
          query: async (text, params) => {
            const result = await tx.query(text, params);
            if (text.startsWith('insert into machination_quarantine')) throw failure;
            return result as never;
          },
        }),
      ),
  };
  await assert.rejects(
    GameService.open(postgresPersistence(failing), () => 1000, createLegacyGame, {
      databaseRecovery: 'quarantine',
    }),
    (error) => error === failure,
  );
  assert.deepEqual(await f.rows(), f.before);
  assert.equal(await f.report(), futureReport);
  assert.equal((await f.archives()).length, 0);
  assert.equal(
    (await f.sql.query("select 1 from machination_state where key = 'quarantined'")).length,
    0,
  );
  const recovered = await GameService.open(
    postgresPersistence(f.sql),
    () => 1000,
    createLegacyGame,
    { databaseRecovery: 'quarantine' },
  );
  assert.equal((await recovered.snapshot(f.healthy.id, 'b'.repeat(64))).id, f.healthy.id);
  assert.equal(await f.report(), futureReport);
  assert.equal((await f.archives()).length, 1);
});

test('an adapter-supplied depth-8000 report source stays opaque through load and quarantine', async (t) => {
  const f = await fixture(t, futureReport);
  const delivered = '['.repeat(8000) + '0' + ']'.repeat(8000);
  let deliveries = 0;
  // PGlite admits the raw SQL fixtures above. This separately exercises the application adapter boundary.
  const project = (text: string, rows: unknown[]): unknown[] => {
    if (
      !text.startsWith(
        "select key, data::text as data from machination_state where key <> 'writer'",
      )
    )
      return rows;
    return rows.map((value) => {
      const row = value as Record<string, unknown>;
      if (row.key !== 'messageReports') return row;
      deliveries++;
      return { ...row, data: delivered };
    });
  };
  const adapter: SqlClient = {
    query: async (text, params) => project(text, await f.sql.query(text, params)) as never,
    transaction: (run) =>
      f.sql.transaction((tx) =>
        run({
          query: async (text, params) => project(text, await tx.query(text, params)) as never,
        }),
      ),
  };
  const recovered = await GameService.open(
    postgresPersistence(adapter),
    () => 1000,
    createLegacyGame,
    { databaseRecovery: 'quarantine' },
  );
  assert.equal((await recovered.snapshot(f.healthy.id, 'b'.repeat(64))).id, f.healthy.id);
  assert.equal(
    (await recovered.reportingAvailability(f.healthy.id, 'b'.repeat(64))).available,
    false,
  );
  assert.ok(deliveries >= 2, 'load and recovery compare must both see the delivered source');
  assert.equal(
    await f.report(),
    futureReport,
    'the adapter fixture must not claim the engine stored depth 8000',
  );
  const archived = JSON.parse((await f.archives())[0]!.data);
  assert.equal(
    archived.state.find((row: { key: string }) => row.key === 'messageReports').data,
    delivered,
  );
});
