/** @format */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseStore, filePersistence } from './database';
import { GameService, type ServiceOptions } from './service';
import { Failure } from './failure';

const unavailable = (error: unknown) =>
  error instanceof Failure && error.status === 503 && error.code === 'game.unavailable.recovery';

async function fixture(t: TestContext, options: ServiceOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'machination-room-quarantine-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'games.json');
  const service = await GameService.open(file, () => 1000, undefined, options);
  const damaged = await service.create('a'.repeat(64));
  const healthyToken = 'b'.repeat(64);
  const healthy = await service.create(healthyToken);
  return { directory, file, service, damaged, healthyToken, healthy };
}

test('quarantine preserves the original bytes before healthy operations resume', async (t) => {
  const { file, damaged, healthyToken, healthy } = await fixture(t);
  const database = JSON.parse(await readFile(file, 'utf8'));
  database.rooms[0].game.version = 999;
  const original = JSON.stringify(database, null, 2) + '\n';
  await writeFile(file, original);
  await assert.rejects(DatabaseStore.open(file));
  assert.equal(await readFile(file, 'utf8'), original);

  const recovered = await DatabaseStore.open(file, { recovery: 'quarantine' });
  assert.deepEqual(await recovered.read((db) => db.rooms.map((room) => room.id)), [healthy.id]);
  const archiveRoot = `${file}.quarantine`;
  const entries = await readdir(archiveRoot);
  assert.equal(entries.length, 1);
  const archive = join(archiveRoot, entries[0]!);
  assert.equal(await readFile(join(archive, 'database.json'), 'utf8'), original);
  assert.equal((await stat(archive)).mode & 0o777, 0o700);
  assert.equal((await stat(join(archive, 'database.json'))).mode & 0o777, 0o600);
  assert.deepEqual(
    JSON.parse(await readFile(join(archive, 'manifest.json'), 'utf8')).rejected,
    [0],
  );
  assert.deepEqual(
    await (await GameService.open(file, () => 1000)).snapshot(healthy.id, healthyToken),
    healthy,
  );
  assert.equal(
    (await recovered.read((db) => db.rooms)).some((room) => room.id === damaged.id),
    false,
  );
});

test('quarantined operations retain their identity instead of becoming missing games or new creations', async (t) => {
  const { file, damaged, healthyToken, healthy } = await fixture(t);
  const database = JSON.parse(await readFile(file, 'utf8'));
  database.rooms[0].game.version = 999;
  await writeFile(file, JSON.stringify(database));
  const recovered = await GameService.open(file, () => 1000, undefined, {
    databaseRecovery: 'quarantine',
  });
  await assert.rejects(recovered.snapshot(damaged.id, 'a'.repeat(64)), unavailable);
  await assert.rejects(recovered.create('a'.repeat(64)), unavailable);
  await assert.rejects(recovered.factions('a'.repeat(64)), unavailable);
  await assert.rejects(recovered.join(damaged.invite!, 'c'.repeat(64)), unavailable);
  assert.deepEqual(await recovered.snapshot(healthy.id, healthyToken), healthy);
  const restarted = await GameService.open(file, () => 1000);
  await assert.rejects(restarted.snapshot(damaged.id, 'a'.repeat(64)), unavailable);
  await assert.rejects(restarted.create('a'.repeat(64)), unavailable);
  assert.deepEqual(await restarted.snapshot(healthy.id, healthyToken), healthy);
});

test('a quarantined account cannot appear empty or silently take a different seat', async (t) => {
  const { file, service, damaged, healthyToken, healthy } = await fixture(t);
  const account = { accountId: 'user_quarantined' };
  await service.linkAccount(damaged.id, 'a'.repeat(64), account);
  const database = JSON.parse(await readFile(file, 'utf8'));
  database.rooms[0].game.version = 999;
  await writeFile(file, JSON.stringify(database));
  const recovered = await GameService.open(file, () => 1000, undefined, {
    databaseRecovery: 'quarantine',
  });
  await assert.rejects(recovered.accountSession(account), unavailable);
  await assert.rejects(recovered.create(account), unavailable);
  await assert.rejects(recovered.linkAccount(healthy.id, healthyToken, account), unavailable);
  assert.equal(await recovered.accountSession({ accountId: 'user_new' }), null);
  assert.deepEqual(await recovered.snapshot(healthy.id, healthyToken), healthy);
});

test('quarantine keeps a recovery attempt retryable instead of rejecting its secret', async (t) => {
  const { file, service, damaged } = await fixture(t);
  const secret = 'd'.repeat(64);
  await service.setRecovery(damaged.id, 'a'.repeat(64), {
    requestId: 'quarantine-recovery-setup',
    secret,
  });
  const database = JSON.parse(await readFile(file, 'utf8'));
  database.rooms[0].game.version = 999;
  await writeFile(file, JSON.stringify(database));
  const recovered = await GameService.open(file, () => 1000, undefined, {
    databaseRecovery: 'quarantine',
  });
  await assert.rejects(recovered.recover(damaged.id, 'c'.repeat(64), { secret }), unavailable);
});

test('quarantine isolates notification records without changing healthy consent or queued delivery', async (t) => {
  const { file, service, damaged, healthy, healthyToken } = await fixture(t, {
    notifications: true,
  });
  await service.join(damaged.invite!, 'c'.repeat(64));
  await service.join(healthy.invite!, 'd'.repeat(64));
  await service.setNotifications(damaged.id, 'c'.repeat(64), {
    requestId: 'quarantine-bad-consent',
    deviceId: 'e'.repeat(64),
    revision: 0,
    enabled: true,
    expoPushToken: 'ExpoPushToken[bad-fixture]',
  });
  await service.setNotifications(healthy.id, 'd'.repeat(64), {
    requestId: 'quarantine-good-consent',
    deviceId: 'f'.repeat(64),
    revision: 0,
    enabled: true,
    expoPushToken: 'ExpoPushToken[good-fixture]',
  });
  await service.message(damaged.id, 'a'.repeat(64), {
    requestId: 'quarantine-bad-message',
    to: 'vesper',
    text: 'Private damaged-room message.',
  });
  await service.message(healthy.id, healthyToken, {
    requestId: 'quarantine-good-message',
    to: 'vesper',
    text: 'Healthy private message.',
  });
  const healthyBefore = await service.snapshot(healthy.id, healthyToken);
  const database = JSON.parse(await readFile(file, 'utf8'));
  database.notifications.floors = [
    { roomId: damaged.id, faction: 'vesper', revision: 1 },
    { roomId: healthy.id, faction: 'vesper', revision: 1 },
  ];
  database.notifications.incoming = [
    { roomId: damaged.id, faction: 'vesper', keys: ['bad'] },
    { roomId: healthy.id, faction: 'vesper', keys: ['good'] },
  ];
  const expected = Object.fromEntries(
    Object.entries(database.notifications).map(([key, rows]) => [
      key,
      (rows as { roomId: string }[]).filter((row) => row.roomId === healthy.id),
    ]),
  );
  database.rooms[0].game.version = 999;
  const original = JSON.stringify(database);
  await writeFile(file, original);
  const recovered = await GameService.open(file, () => 1000, undefined, {
    databaseRecovery: 'quarantine',
    notifications: true,
  });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).notifications, expected);
  const [entry] = await readdir(`${file}.quarantine`);
  assert.equal(
    await readFile(join(`${file}.quarantine`, entry!, 'database.json'), 'utf8'),
    original,
  );
  const batch = await recovered.notificationQueue().claimSends('quarantine-test');
  assert.equal(batch.items.length, 1);
  assert.equal(batch.items[0]!.message.data.gameId, healthy.id);
  assert.deepEqual(
    (await recovered.snapshot(healthy.id, healthyToken)).messages,
    healthyBefore.messages,
  );
});

test('ambiguous room identities are quarantined together rather than choosing one copy', async (t) => {
  const { file, damaged, healthyToken, healthy } = await fixture(t);
  const database = JSON.parse(await readFile(file, 'utf8'));
  database.rooms.push(structuredClone(database.rooms[0]));
  await writeFile(file, JSON.stringify(database));
  const recovered = await GameService.open(file, () => 1000, undefined, {
    databaseRecovery: 'quarantine',
  });
  assert.deepEqual(await recovered.snapshot(healthy.id, healthyToken), healthy);
  await assert.rejects(recovered.snapshot(damaged.id, 'a'.repeat(64)), unavailable);
  assert.deepEqual(
    JSON.parse(await readFile(file, 'utf8')).rooms.map((room: { id: string }) => room.id),
    [healthy.id],
  );
});

test('ambiguous active account ownership quarantines every affected operation', async (t) => {
  const { file, service, healthyToken, healthy } = await fixture(t);
  const account = { accountId: 'user_ambiguous' };
  await service.create(account);
  const database = JSON.parse(await readFile(file, 'utf8'));
  database.rooms[0].seats[0].accountId = account.accountId;
  await writeFile(file, JSON.stringify(database));
  const recovered = await GameService.open(file, () => 1000, undefined, {
    databaseRecovery: 'quarantine',
  });
  assert.deepEqual(await recovered.snapshot(healthy.id, healthyToken), healthy);
  await assert.rejects(recovered.accountSession(account), unavailable);
  assert.deepEqual(
    JSON.parse(await readFile(file, 'utf8')).rooms.map((room: { id: string }) => room.id),
    [healthy.id],
  );
});

test('quarantine refuses damaged global metadata without rewriting the source', async (t) => {
  const { file } = await fixture(t);
  const database = JSON.parse(await readFile(file, 'utf8'));
  database.rooms[0].game.version = 999;
  for (const value of [
    null,
    { ...database, version: 2 },
    { ...database, rooms: null },
    { ...database, factions: null },
    { ...database, notifications: { bindings: 'broken', jobs: [] } },
    { ...database, quarantined: null },
  ]) {
    const source = JSON.stringify(value);
    await writeFile(file, source);
    await assert.rejects(DatabaseStore.open(file, { recovery: 'quarantine' }));
    assert.equal(await readFile(file, 'utf8'), source);
    await assert.rejects(readdir(`${file}.quarantine`), { code: 'ENOENT' });
  }
});

test('an unidentified damaged room preserves retries and parks unresolved notifications', async (t) => {
  const { file, service, damaged, healthyToken, healthy } = await fixture(t, {
    notifications: true,
  });
  await service.join(damaged.invite!, 'c'.repeat(64));
  await service.setNotifications(damaged.id, 'c'.repeat(64), {
    requestId: 'unidentified-consent',
    deviceId: 'e'.repeat(64),
    revision: 0,
    enabled: true,
    expoPushToken: 'ExpoPushToken[unidentified]',
  });
  await service.message(damaged.id, 'a'.repeat(64), {
    requestId: 'unidentified-message',
    to: 'vesper',
    text: 'Preserve this notification.',
  });
  const database = JSON.parse(await readFile(file, 'utf8'));
  database.rooms[0].id = null;
  await writeFile(file, JSON.stringify(database));
  const recovered = await GameService.open(file, () => 1000, undefined, {
    databaseRecovery: 'quarantine',
    notifications: true,
  });
  assert.deepEqual(await recovered.snapshot(healthy.id, healthyToken), healthy);
  assert.deepEqual(await recovered.create(healthyToken), healthy);
  await assert.rejects(recovered.snapshot(damaged.id, 'a'.repeat(64)), unavailable);
  await assert.rejects(recovered.create('f'.repeat(64)), unavailable);
  assert.equal((await recovered.notificationQueue().claimSends('unidentified')).items.length, 0);
});

test('a damaged room faction does not invalidate healthy global progression', async (t) => {
  const { file, damaged, healthy, healthyToken } = await fixture(t);
  const database = JSON.parse(await readFile(file, 'utf8'));
  database.rooms[0].variant = 'faction';
  await writeFile(file, JSON.stringify(database));
  const recovered = await GameService.open(file, () => 1000, undefined, {
    databaseRecovery: 'quarantine',
  });
  await assert.rejects(recovered.snapshot(damaged.id, 'a'.repeat(64)), unavailable);
  assert.deepEqual(await recovered.snapshot(healthy.id, healthyToken), healthy);
});

test('a failed archive leaves the original database intact', async (t) => {
  const { file } = await fixture(t);
  const database = JSON.parse(await readFile(file, 'utf8'));
  database.rooms[0].game.version = 999;
  const source = JSON.stringify(database);
  await writeFile(file, source);
  await writeFile(`${file}.quarantine`, 'This path cannot be used as an archive directory.');
  await assert.rejects(DatabaseStore.open(file, { recovery: 'quarantine' }));
  assert.equal(await readFile(file, 'utf8'), source);
  await assert.rejects(DatabaseStore.open(file));
});

test('recovery refuses to overwrite a source replaced after loading', async (t) => {
  const { file } = await fixture(t);
  const database = JSON.parse(await readFile(file, 'utf8'));
  const replacement = JSON.stringify({ ...database, rooms: [database.rooms[1]] });
  database.rooms[0].game.version = 999;
  await writeFile(file, JSON.stringify(database));
  const persistence = filePersistence(file);
  const source = {
    ...persistence,
    async load() {
      const loaded = await persistence.load();
      await writeFile(file, replacement);
      return loaded;
    },
  };
  await assert.rejects(
    DatabaseStore.open(source, { recovery: 'quarantine' }),
    /changed during recovery/,
  );
  assert.equal(await readFile(file, 'utf8'), replacement);
  await assert.rejects(readdir(`${file}.quarantine`), { code: 'ENOENT' });
});

test('a quarantined profile does not publish partial standings under another seat credential', async (t) => {
  const { file, healthyToken } = await fixture(t);
  const database = JSON.parse(await readFile(file, 'utf8'));
  database.rooms[1].seats[0].profileId = database.rooms[0].seats[0].profileId;
  database.rooms[0].game.version = 999;
  await writeFile(file, JSON.stringify(database));
  const recovered = await GameService.open(file, () => 1000, undefined, {
    databaseRecovery: 'quarantine',
  });
  await assert.rejects(recovered.factions(healthyToken), unavailable);
});

test('malformed database JSON fails without echoing saved content', async (t) => {
  const { file } = await fixture(t);
  const source = 'PrivateSavedTransmissionShouldNotReachLogs: invalid JSON';
  await writeFile(file, source);
  await assert.rejects(
    DatabaseStore.open(file, { recovery: 'quarantine' }),
    (error) =>
      error instanceof Error &&
      /database JSON/.test(error.message) &&
      !error.message.includes('PrivateSav'),
  );
  assert.equal(await readFile(file, 'utf8'), source);
});

test('invalid UTF-8 is refused instead of normalizing damaged stored bytes', async (t) => {
  const { file } = await fixture(t);
  const database = JSON.parse(await readFile(file, 'utf8'));
  const text = JSON.stringify({ ...database, encoded: 'marker' });
  const index = text.indexOf('"marker"') + 1;
  const original = Buffer.concat([
    Buffer.from(text.slice(0, index)),
    Buffer.from([0xc3, 0x28]),
    Buffer.from(text.slice(index + 6)),
  ]);
  await writeFile(file, original);
  await assert.rejects(DatabaseStore.open(file, { recovery: 'quarantine' }), /database encoding/);
  assert.deepEqual(await readFile(file), original);
});

test('a damaged retry receipt cannot reapply an already accepted message', async (t) => {
  const { file, service, damaged } = await fixture(t);
  await service.join(damaged.invite!, 'c'.repeat(64));
  const command = {
    requestId: 'quarantine-accepted-receipt',
    to: 'vesper' as const,
    text: 'Already accepted once.',
  };
  await service.message(damaged.id, 'a'.repeat(64), command);
  const database = JSON.parse(await readFile(file, 'utf8'));
  const [key] = Object.keys(database.rooms[0].receipts);
  assert.ok(key);
  database.rooms[0].receipts[key] = null;
  await writeFile(file, JSON.stringify(database));
  const recovered = await GameService.open(file, () => 1000, undefined, {
    databaseRecovery: 'quarantine',
  });
  await assert.rejects(recovered.message(damaged.id, 'a'.repeat(64), command), unavailable);
});
