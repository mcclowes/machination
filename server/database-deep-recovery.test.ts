/** @format */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GameService } from './service';
import { createLegacyGame } from '../src/game/legacy';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'machination-deep-recovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'games.json');
  const service = await GameService.open(file, () => 1000, createLegacyGame);
  const damaged = await service.create('a'.repeat(64));
  const healthy = await service.create('b'.repeat(64));
  const database = JSON.parse(await readFile(file, 'utf8'));
  const room = JSON.stringify(database.rooms[0]);
  const damagedSource =
    room.slice(0, -1) + ',"futureDepth":' + '['.repeat(8000) + '0' + ']'.repeat(8000) + '}';
  const source =
    '{"version":1,"rooms":[' + damagedSource + ',' + JSON.stringify(database.rooms[1]) + ']}';
  await writeFile(file, source);
  return { directory, file, database, source, damaged, healthy };
}

test('deep damaged file rooms are archived before healthy operations resume and survive restart', async (t) => {
  const { file, source, damaged, healthy } = await fixture(t);
  const recovered = await GameService.open(file, () => 1000, createLegacyGame, {
    databaseRecovery: 'quarantine',
  });
  assert.deepEqual(await recovered.snapshot(healthy.id, 'b'.repeat(64)), healthy);
  await assert.rejects(recovered.snapshot(damaged.id, 'a'.repeat(64)), /temporarily unavailable/);
  const [entry] = await readdir(`${file}.quarantine`);
  assert.equal(await readFile(join(`${file}.quarantine`, entry!, 'database.json'), 'utf8'), source);
  const later = await recovered.create('c'.repeat(64));
  const restarted = await GameService.open(file, () => 1000, createLegacyGame);
  assert.deepEqual(await restarted.snapshot(healthy.id, 'b'.repeat(64)), healthy);
  assert.deepEqual(await restarted.snapshot(later.id, 'c'.repeat(64)), later);
  await assert.rejects(restarted.create('a'.repeat(64)), /temporarily unavailable/);
  assert.equal((await readdir(`${file}.quarantine`)).length, 1);
});

test('strict startup refuses deep rooms without changing source or creating an archive', async (t) => {
  const { file, source } = await fixture(t);
  await assert.rejects(
    GameService.open(file, () => 1000, createLegacyGame),
    /nesting/,
  );
  assert.equal(await readFile(file, 'utf8'), source);
  await assert.rejects(readdir(`${file}.quarantine`), { code: 'ENOENT' });
});

for (const shared of ['id', 'invite', 'account'] as const) {
  test(`deep damaged rooms retain ${shared} ambiguity with otherwise healthy rooms`, async (t) => {
    const { file, database } = await fixture(t);
    if (shared === 'account') {
      database.rooms[0].seats[0].accountId = 'user_shared';
      database.rooms[1].seats[0].accountId = 'user_shared';
    } else database.rooms[0][shared] = database.rooms[1][shared];
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
    await GameService.open(file, () => 1000, createLegacyGame, { databaseRecovery: 'quarantine' });
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(saved.rooms, []);
    assert.equal(saved.quarantined.length, 2);
    assert.equal(
      saved.quarantined.every((marker: { uncertain: boolean }) => !marker.uncertain),
      true,
    );
  });
}

test('existing quarantine marker collisions still refuse the original deep room globally', async (t) => {
  const { file, database, source } = await fixture(t);
  const marker = {
    id: database.rooms[0].id,
    invite: database.rooms[0].invite,
    accounts: [],
    hashes: [database.rooms[0].seats[0].hash],
    uncertain: false,
  };
  const original = source.slice(0, -1) + ',"quarantined":' + JSON.stringify([marker]) + '}';
  await writeFile(file, original);
  await assert.rejects(
    GameService.open(file, () => 1000, createLegacyGame, { databaseRecovery: 'quarantine' }),
    /quarantine metadata/,
  );
  assert.equal(await readFile(file, 'utf8'), original);
  await assert.rejects(readdir(`${file}.quarantine`), { code: 'ENOENT' });
});

for (const field of ['factions', 'notifications', 'quarantined', 'futureMetadata']) {
  test(`deep global ${field} refuses recovery before any archive or write`, async (t) => {
    const { file, source } = await fixture(t);
    const original =
      source.slice(0, -1) +
      ',' +
      JSON.stringify(field) +
      ':' +
      '['.repeat(8000) +
      '0' +
      ']'.repeat(8000) +
      '}';
    await writeFile(file, original);
    await assert.rejects(
      GameService.open(file, () => 1000, createLegacyGame, { databaseRecovery: 'quarantine' }),
      /nesting/,
    );
    assert.equal(await readFile(file, 'utf8'), original);
    await assert.rejects(readdir(`${file}.quarantine`), { code: 'ENOENT' });
  });
}

test('safe optional custom-persistence fields remain usable through whole-database writes', async (t) => {
  const { database, healthy } = await fixture(t);
  database.rooms[0].optional = undefined;
  database.rooms[0].future = JSON.parse('['.repeat(127) + '0' + ']'.repeat(127));
  database.futureMetadata = { optional: undefined, value: 'retained' };
  database.futureDepth = JSON.parse('['.repeat(127) + '0' + ']'.repeat(127));
  let saved = database;
  const persistence = {
    load: async () => saved,
    save: async (next: typeof database) => {
      saved = next;
    },
  };
  const service = await GameService.open(persistence, () => 1000, createLegacyGame);
  await service.create('c'.repeat(64));
  assert.equal(Object.hasOwn(saved.rooms[0], 'optional'), true);
  assert.deepEqual(saved.rooms[0].future, database.rooms[0].future);
  assert.deepEqual(saved.futureMetadata, database.futureMetadata);
  assert.deepEqual(saved.futureDepth, database.futureDepth);
  assert.equal(database.rooms[0].seats[0].revision, undefined);
  const restarted = await GameService.open(persistence, () => 1000, createLegacyGame);
  assert.deepEqual(await restarted.snapshot(healthy.id, 'b'.repeat(64)), healthy);
});

test('rooms just beyond the storage depth boundary quarantine before later whole-database writes', async (t) => {
  const { file, database, healthy } = await fixture(t);
  database.rooms[0].future = JSON.parse('['.repeat(128) + '0' + ']'.repeat(128));
  await writeFile(file, JSON.stringify(database));
  const recovered = await GameService.open(file, () => 1000, createLegacyGame, {
    databaseRecovery: 'quarantine',
  });
  assert.deepEqual(await recovered.snapshot(healthy.id, 'b'.repeat(64)), healthy);
  await recovered.create('c'.repeat(64));
  await GameService.open(file, () => 1000, createLegacyGame);
});

test('unpersistable custom-persistence rooms quarantine without mutating the original', async (t) => {
  const { database, healthy } = await fixture(t);
  database.rooms[0].future = 1n;
  let saved = database;
  let rejected: readonly number[] | undefined;
  const persistence = {
    load: async () => database,
    save: async (next: typeof database) => {
      saved = next;
    },
    quarantine: async (next: typeof database, indices: readonly number[]) => {
      rejected = indices;
      saved = next;
    },
  };
  const recovered = await GameService.open(persistence, () => 1000, createLegacyGame, {
    databaseRecovery: 'quarantine',
  });
  assert.deepEqual(rejected, [0]);
  assert.equal(database.rooms[0].future, 1n);
  assert.equal(database.rooms[0].seats[0].revision, undefined);
  assert.deepEqual(await recovered.snapshot(healthy.id, 'b'.repeat(64)), healthy);
  await recovered.create('c'.repeat(64));
  assert.equal(saved.rooms.length, 2);
});

test('overflowing shared file metadata refuses both recovery modes without normalizing source', async (t) => {
  const { file, database } = await fixture(t);
  const source = JSON.stringify(database).slice(0, -1) + ',"futureMetadata":{"limit":1e999}}';
  await writeFile(file, source);
  for (const databaseRecovery of ['strict', 'quarantine'] as const) {
    await assert.rejects(
      GameService.open(file, () => 1000, createLegacyGame, { databaseRecovery }),
      /non-finite/,
    );
    assert.equal(await readFile(file, 'utf8'), source);
    await assert.rejects(readdir(`${file}.quarantine`), { code: 'ENOENT' });
  }
});

for (const overflow of ['1e999', '-1e999']) {
  test(`non-finite unknown room value ${overflow} isolates only its room and preserves source`, async (t) => {
    const { file, database, healthy, damaged } = await fixture(t);
    const first = JSON.stringify(database.rooms[0]);
    const source =
      '{"version":1,"rooms":[' +
      first.slice(0, -1) +
      ',"futureLimit":' +
      overflow +
      '},' +
      JSON.stringify(database.rooms[1]) +
      ']}';
    await writeFile(file, source);
    await assert.rejects(
      GameService.open(file, () => 1000, createLegacyGame),
      /non-finite/,
    );
    assert.equal(await readFile(file, 'utf8'), source);
    await assert.rejects(readdir(`${file}.quarantine`), { code: 'ENOENT' });
    const recovered = await GameService.open(file, () => 1000, createLegacyGame, {
      databaseRecovery: 'quarantine',
    });
    assert.deepEqual(await recovered.snapshot(healthy.id, 'b'.repeat(64)), healthy);
    await assert.rejects(recovered.snapshot(damaged.id, 'a'.repeat(64)), /temporarily unavailable/);
    const [entry] = await readdir(`${file}.quarantine`);
    assert.equal(
      await readFile(join(`${file}.quarantine`, entry!, 'database.json'), 'utf8'),
      source,
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(`${file}.quarantine`, entry!, 'manifest.json'), 'utf8'))
        .rejected,
      [0],
    );
    const later = await recovered.create('c'.repeat(64));
    const restarted = await GameService.open(file, () => 1000, createLegacyGame);
    assert.deepEqual(await restarted.snapshot(healthy.id, 'b'.repeat(64)), healthy);
    assert.deepEqual(await restarted.snapshot(later.id, 'c'.repeat(64)), later);
    await assert.rejects(restarted.create('a'.repeat(64)), /temporarily unavailable/);
  });
}

test('non-finite custom global metadata refuses startup without saving or quarantining', async (t) => {
  const { database } = await fixture(t);
  for (const limit of [NaN, Infinity, -Infinity]) {
    database.futureMetadata = { limit };
    let writes = 0;
    const persistence = {
      load: async () => database,
      save: async () => {
        writes++;
      },
      quarantine: async () => {
        writes++;
      },
    };
    for (const databaseRecovery of ['strict', 'quarantine'] as const) {
      await assert.rejects(
        GameService.open(persistence, () => 1000, createLegacyGame, { databaseRecovery }),
        /non-finite/,
      );
      assert.ok(Object.is(database.futureMetadata.limit, limit));
      assert.equal(writes, 0);
    }
  }
});

test('finite custom metadata including negative zero and optional undefined remains accepted', async (t) => {
  const { database, healthy } = await fixture(t);
  const finite = [Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE, 0, -0];
  database.futureMetadata = { finite, optional: undefined };
  database.rooms[0].futureMetadata = { finite, optional: undefined };
  let saved = database;
  const persistence = {
    load: async () => saved,
    save: async (next: typeof database) => {
      saved = next;
    },
  };
  const service = await GameService.open(persistence, () => 1000, createLegacyGame);
  await service.create('c'.repeat(64));
  assert.deepEqual(saved.futureMetadata.finite, finite);
  assert.deepEqual(saved.rooms[0].futureMetadata.finite, finite);
  assert.ok(Object.is(saved.futureMetadata.finite.at(-1), -0));
  assert.ok(Object.is(saved.rooms[0].futureMetadata.finite.at(-1), -0));
  assert.ok(Object.hasOwn(saved.futureMetadata, 'optional'));
  assert.ok(Object.hasOwn(saved.rooms[0].futureMetadata, 'optional'));
  const restarted = await GameService.open(persistence, () => 1000, createLegacyGame);
  assert.deepEqual(await restarted.snapshot(healthy.id, 'b'.repeat(64)), healthy);
});
