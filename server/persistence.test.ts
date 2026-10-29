import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameService } from './service';

test('concurrent transactions retain every message and isolate returned snapshots from durable state', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-persistence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'games.json');
  const service = await GameService.open(file, () => 1000);
  const host = 'a'.repeat(64), guest = 'b'.repeat(64);
  const room = await service.create(host);
  await service.join(room.invite!, guest);

  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => service.message(room.id, host, {
    requestId: `concurrent-message-${i}`, to: 'vesper', text: `Transmission ${i}`,
  })));
  assert.deepEqual(results.map(result => result.messages.length), [1, 2, 3, 4, 5, 6, 7, 8]);
  results.at(-1)!.messages[0]!.text = 'Caller mutation';
  results.at(-1)!.game.hour = 999;
  const live = await service.snapshot(room.id, host);
  assert.equal(live.messages[0]!.text, 'Transmission 0');
  assert.equal(live.game.hour, 0);
  const restarted = await GameService.open(file, () => 1000);
  assert.deepEqual(await restarted.snapshot(room.id, guest), await service.snapshot(room.id, guest));
  assert.equal((await restarted.snapshot(room.id, host)).messages.length, 8);
});

test('older room metadata gains compatibility defaults without losing seats or messages', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-persistence-legacy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'games.json');
  const token = 'a'.repeat(64);
  const room = await (await GameService.open(file, () => 1000)).create(token);
  const database = JSON.parse(await readFile(file, 'utf8'));
  delete database.rooms[0].referenceKey;
  delete database.rooms[0].diplomacy;
  delete database.rooms[0].seats[0].revision;
  await writeFile(file, JSON.stringify(database));

  const restored = await GameService.open(file, () => 1000);
  const snapshot = await restored.snapshot(room.id, token);
  assert.equal(snapshot.revision, 0);
  assert.deepEqual(snapshot.members, ['you']);
  assert.deepEqual(snapshot.channels, [{ id: 'public', kind: 'public', messages: [] }]);
  const stored = JSON.parse(await readFile(file, 'utf8'));
  assert.match(stored.rooms[0].referenceKey, /^[a-f0-9]{64}$/);
  assert.equal(stored.rooms[0].seats[0].revision, 0);
  assert.deepEqual(await (await GameService.open(file, () => 1000)).snapshot(room.id, token), snapshot);
});
