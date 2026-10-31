/** @format */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { GameService } from './service';
import { postgresPersistence, type SqlClient } from './postgres-store';
import type { Database, Persistence } from './database';
import { createLegacyGame } from '../src/game/legacy';

function sql(engine: PGlite): SqlClient {
  return {
    query: async (text, params) => (await engine.query(text, params)).rows as never,
    transaction: (run) =>
      engine.transaction((tx) =>
        run({ query: async (text, params) => (await tx.query(text, params)).rows as never }),
      ),
  };
}

test('SQL engine restart retains canonical evidence, acknowledgement, and operator retry identity', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-report-sql-'));
  let engine: PGlite | undefined = new PGlite(join(directory, 'postgres'));
  t.after(async () => {
    await engine?.close();
    await rm(directory, { recursive: true, force: true });
  });
  const host = 'a'.repeat(64),
    guest = 'b'.repeat(64);
  const service = await GameService.open(
    postgresPersistence(sql(engine)),
    () => 1000,
    createLegacyGame,
    { reportingEnabled: true },
  );
  const room = await service.create(host);
  await service.join(room.invite, guest);
  await service.message(room.id, guest, {
    requestId: randomUUID(),
    to: 'you',
    text: 'SQL retained evidence',
  });
  const before = await service.snapshot(room.id, host);
  const input = {
    requestId: randomUUID(),
    target: { kind: 'private' as const, id: before.messages[0]!.id },
    reason: 'harassment' as const,
    detail: 'Retain the canonical text.',
  };
  const receipt = await service.submitMessageReport(room.id, host, input);
  const review = {
    requestId: randomUUID(),
    revision: 0,
    status: 'escalated' as const,
    note: 'Operator escalation recorded.',
  };
  const disposition = await service.reviewMessageReport(receipt.caseId, 'user_operator', review);
  const stored = await engine.query<{ data: string }>(
    "select data::text as data from machination_state where key = 'messageReports'",
  );
  await engine.close();
  engine = undefined;
  engine = new PGlite(join(directory, 'postgres'));
  const restarted = await GameService.open(
    postgresPersistence(sql(engine)),
    () => 1000,
    createLegacyGame,
    { reportingEnabled: true },
  );
  assert.deepEqual(await restarted.submitMessageReport(room.id, host, input), receipt);
  assert.deepEqual(
    await restarted.reviewMessageReport(receipt.caseId, 'user_operator', review),
    disposition,
  );
  assert.deepEqual(await restarted.snapshot(room.id, host), before);
  assert.deepEqual(
    await engine.query(
      "select data::text as data from machination_state where key = 'messageReports'",
    ),
    stored,
  );
  const broken = { version: 7, cases: [{ evidence: 'Preserve unsupported SQL evidence' }] };
  await engine.query(
    "update machination_state set data = $1::text::json where key = 'messageReports'",
    [JSON.stringify(broken)],
  );
  const future = await GameService.open(
    postgresPersistence(sql(engine)),
    () => 1000,
    createLegacyGame,
    { reportingEnabled: true },
  );
  assert.equal((await future.reportingAvailability(room.id, host)).available, false);
  await future.setMessageBlock(room.id, host, {
    requestId: randomUUID(),
    revision: 0,
    player: 'vesper',
    blocked: true,
  });
  const preserved = (
    await engine.query<{ data: unknown }>(
      "select data from machination_state where key = 'messageReports'",
    )
  ).rows[0]!.data;
  assert.deepEqual(preserved, broken);
  assert.equal((await future.snapshot(room.id, host)).id, room.id);
  const overflow = '{"version":2,"cases":[],"futureValue":1e999,"negativeZero":-0}';
  await engine.query(
    "update machination_state set data = $1::text::json where key = 'messageReports'",
    [overflow],
  );
  const unsupported = await GameService.open(
    postgresPersistence(sql(engine)),
    () => 1000,
    createLegacyGame,
    { reportingEnabled: true },
  );
  assert.equal((await unsupported.reportingAvailability(room.id, host)).available, false);
  await unsupported.setMessageBlock(room.id, host, {
    requestId: randomUUID(),
    revision: 1,
    player: 'vesper',
    blocked: false,
  });
  assert.equal(
    (
      await engine.query<{ data: string }>(
        "select data::text as data from machination_state where key = 'messageReports'",
      )
    ).rows[0]!.data,
    overflow,
  );
});

test('failed report and disposition saves leave no acknowledgement or partial in-memory review', async () => {
  let stored: Database | undefined;
  let fail = false;
  const persistence: Persistence = {
    load: async () => structuredClone(stored),
    save: async (next) => {
      if (fail) throw new Error('Injected reporting persistence failure');
      stored = structuredClone(next);
    },
  };
  const host = 'a'.repeat(64),
    guest = 'b'.repeat(64);
  const service = await GameService.open(persistence, () => 1000, createLegacyGame, {
    reportingEnabled: true,
  });
  const room = await service.create(host);
  await service.join(room.invite, guest);
  await service.message(room.id, guest, {
    requestId: randomUUID(),
    to: 'you',
    text: 'Atomic report persistence',
  });
  const input = {
    requestId: randomUUID(),
    target: {
      kind: 'private' as const,
      id: (await service.snapshot(room.id, host)).messages[0]!.id,
    },
    reason: 'spam' as const,
    detail: '',
  };
  fail = true;
  await assert.rejects(
    service.submitMessageReport(room.id, host, input),
    /Injected reporting persistence/,
  );
  assert.deepEqual(await service.listMessageReports(), { reports: [] });
  fail = false;
  const receipt = await service.submitMessageReport(room.id, host, input);
  const review = { requestId: randomUUID(), revision: 0, status: 'reviewed' as const, note: '' };
  fail = true;
  await assert.rejects(
    service.reviewMessageReport(receipt.caseId, 'user_operator', review),
    /Injected reporting persistence/,
  );
  assert.equal((await service.messageReport(receipt.caseId)).revision, 0);
  fail = false;
  assert.equal(
    (await service.reviewMessageReport(receipt.caseId, 'user_operator', review)).revision,
    1,
  );
  assert.equal((await service.listMessageReports()).reports.length, 1);
});
