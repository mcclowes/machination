/** @format */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameService } from './service';
import { createLegacyGame } from '../src/game/legacy';
import type { Persistence } from './database';

async function sourceFile(t: TestContext, source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'machination-report-source-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'games.json');
  await writeFile(file, source);
  return file;
}

function archive(value: unknown): { format: string; source: string } {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  const stored = value as Record<string, unknown>;
  assert.deepEqual(Object.keys(stored).sort(), ['format', 'source']);
  assert.equal(stored.format, 'message-report-source.v1');
  assert.equal(typeof stored.source, 'string');
  return stored as { format: string; source: string };
}

test('ordinary file writes retain overflowing future report values as their exact original source', async (t) => {
  const opaque =
    '{ "version" : 2, "cases" : [{"futureValue":1e999,"negative":-1e999,"negativeZero":-0,"text":"Retain future evidence"}] }';
  const file = await sourceFile(t, `{"version":1,"rooms":[],"messageReports":${opaque}}`);
  const service = await GameService.open(file, () => 1000, createLegacyGame, {
    reportingEnabled: true,
  });
  const room = await service.create('a'.repeat(64));
  assert.equal((await service.reportingAvailability(room.id, 'a'.repeat(64))).available, false);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  const retained =
    saved.messageReports.format === 'message-report-source.v1'
      ? JSON.parse(archive(saved.messageReports).source)
      : saved.messageReports;
  assert.equal(retained.cases[0].futureValue, Infinity);
  assert.equal(retained.cases[0].negative, -Infinity);
  assert.ok(Object.is(retained.cases[0].negativeZero, -0));
  assert.equal(archive(saved.messageReports).source, opaque);
  assert.equal(saved.rooms.length, 1);
  assert.equal((await service.snapshot(room.id, 'a'.repeat(64))).id, room.id);
});

test('deep future report source cannot prevent file startup or ordinary game writes', async (t) => {
  const opaque = '['.repeat(8000) + '0' + ']'.repeat(8000);
  const file = await sourceFile(t, '{"version":1,"rooms":[],"messageReports":' + opaque + '}');
  const service = await GameService.open(file, () => 1000, createLegacyGame, {
    reportingEnabled: true,
  });
  const room = await service.create('a'.repeat(64));
  assert.equal((await service.reportingAvailability(room.id, 'a'.repeat(64))).available, false);
  assert.equal((await service.snapshot(room.id, 'a'.repeat(64))).id, room.id);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(archive(saved.messageReports).source, opaque);
});

test('source extraction follows decoded top-level keys and the last duplicate member', async (t) => {
  const opaque = '{ "version" : 9, "cases" : [{"text":"Exact last member", "number":1e999}] }';
  const escapedKey = '"message' + String.fromCharCode(92) + 'u0052eports"';
  const noise = JSON.stringify('Ignore delimiters: } , "messageReports": [ ]');
  const source =
    '{"version":1,"rooms":[],"messageReports":{"earlier":true},' +
    '"nested":{"messageReports":"Nested decoy"},"noise":' +
    noise +
    ',' +
    escapedKey +
    ' : \n ' +
    opaque +
    ' \n}';
  const file = await sourceFile(t, source);
  const service = await GameService.open(file, () => 1000, createLegacyGame, {
    reportingEnabled: true,
  });
  await service.create('a'.repeat(64));
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(archive(saved.messageReports).source, opaque);
  assert.deepEqual(saved.nested, { messageReports: 'Nested decoy' });
  assert.equal(saved.noise, JSON.parse(noise));
});

test('restarting an archived future ledger repeatedly retains one archive layer', async (t) => {
  const opaque = '{"version":22,"cases":[{"text":"Stable archived evidence","number":1e999}]}';
  const file = await sourceFile(t, '{"version":1,"rooms":[],"messageReports":' + opaque + '}');
  for (const token of ['a', 'b', 'c']) {
    const service = await GameService.open(file, () => 1000, createLegacyGame, {
      reportingEnabled: true,
    });
    const room = await service.create(token.repeat(64));
    assert.equal((await service.reportingAvailability(room.id, token.repeat(64))).available, false);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(archive(saved.messageReports).source, opaque);
    assert.notEqual(
      JSON.parse(archive(saved.messageReports).source).format,
      'message-report-source.v1',
    );
  }
});

test('object persistence isolates deep report values before cloning and serializing the database', async () => {
  const opaque = '['.repeat(8000) + '0' + ']'.repeat(8000);
  let stored: unknown = JSON.parse('{"version":1,"rooms":[],"messageReports":' + opaque + '}');
  const persistence: Persistence = {
    load: async () => stored,
    save: async (next) => {
      stored = JSON.parse(JSON.stringify(next));
    },
  };
  const service = await GameService.open(persistence, () => 1000, createLegacyGame, {
    reportingEnabled: true,
  });
  const room = await service.create('a'.repeat(64));
  assert.equal((await service.reportingAvailability(room.id, 'a'.repeat(64))).available, false);
  assert.equal((await service.snapshot(room.id, 'a'.repeat(64))).id, room.id);
  assert.equal(archive((stored as { messageReports: unknown }).messageReports).source, opaque);
});

test('object persistence retains non-finite and negative-zero report values in valid archive JSON', async () => {
  const input = {
    version: 2,
    cases: [
      { positive: Infinity, negative: -Infinity, negativeZero: -0, text: 'Object-source evidence' },
    ],
  };
  let stored: unknown = { version: 1, rooms: [], messageReports: input };
  const persistence: Persistence = {
    load: async () => stored,
    save: async (next) => {
      stored = JSON.parse(JSON.stringify(next));
    },
  };
  const service = await GameService.open(persistence, () => 1000, createLegacyGame, {
    reportingEnabled: true,
  });
  const room = await service.create('a'.repeat(64));
  assert.equal((await service.reportingAvailability(room.id, 'a'.repeat(64))).available, false);
  const saved = archive((stored as { messageReports: unknown }).messageReports);
  const retained = JSON.parse(saved.source);
  assert.equal(retained.cases[0].positive, Infinity);
  assert.equal(retained.cases[0].negative, -Infinity);
  assert.ok(Object.is(retained.cases[0].negativeZero, -0));
  assert.equal(retained.cases[0].text, 'Object-source evidence');
  assert.equal(
    input.cases[0]!.positive,
    Infinity,
    'load must not mutate caller-owned source values',
  );
  assert.ok(Object.is(input.cases[0]!.negativeZero, -0));
});
