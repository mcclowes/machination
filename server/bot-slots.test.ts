import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameService } from './service';
import { advance } from '../src/game/simulation';
import { snapshotResponse } from '../src/contracts/snapshot';

const host = 'a'.repeat(64), guest = 'b'.repeat(64);
const options = { playerCount: 4, mode: 'mining' as const, gravity: false };

test('hosts assign explicit bot slots, humans join gaps, and bot assignments persist', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-bots-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'db.json');
  const service = await GameService.open(file, () => 1000);
  const room = await service.create(host, options);
  await service.setBot(room.id, host, { faction: 'null', enabled: true });
  const human = await service.join(room.invite, guest);
  assert.equal(human.faction, 'vesper');
  await assert.rejects(service.setBot(room.id, guest, { faction: 'aether', enabled: true }), { code: 'game.forbidden.host' });
  await assert.rejects(service.setBot(room.id, host, { faction: 'vesper', enabled: true }), { code: 'game.conflict.human' });
  await assert.rejects(service.setBot(room.id, host, { faction: 'unknown', enabled: true }), { code: 'bot.validation.slot' });
  await assert.rejects(service.setBot(room.id, host, { faction: 'you', enabled: true }), { code: 'bot.validation.slot' });
  await assert.rejects(service.start(room.id, host), { code: 'game.conflict.seats' });
  await service.setBot(room.id, host, { faction: 'null', enabled: false });
  await service.setBot(room.id, host, { faction: 'null', enabled: true });
  await service.setBot(room.id, host, { faction: 'aether', enabled: true });
  const restored = await GameService.open(file, () => 1000);
  const started = await restored.start(room.id, host);
  assert.deepEqual(started.bots, ['null', 'aether']);
  assert.equal(started.members.length, 4);
  snapshotResponse(room.id, started);
  for (const bots of [['you'], ['aether', 'aether'], ['unknown'], 'null']) {
    assert.throws(() => snapshotResponse(room.id, { ...started, bots }), /Unsupported server response/);
  }
  const stored = JSON.parse(await readFile(file, 'utf8')).rooms[0];
  assert.ok(stored.seats.filter((s: { bot?: boolean }) => s.bot).every((s: { lastActiveHour?: number }) => s.lastActiveHour === undefined));
  await assert.rejects(restored.setBot(room.id, host, { faction: 'null', enabled: false }), { code: 'game.conflict.started' });
});

test('only assigned bots act, with identical history, chunked advancement, and restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-bot-play-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'db.json');
  let now = 1000;
  const service = await GameService.open(file, () => now);
  const room = await service.create(host, { ...options, playerCount: 3 });
  await service.join(room.invite, guest);
  await service.setBot(room.id, host, { faction: 'null', enabled: true });
  await service.start(room.id, host);
  const baseline = JSON.parse(await readFile(file, 'utf8')).rooms[0].game;
  const expected = advance(baseline, 12, { rivals: false, bots: ['null'] });
  assert.ok(expected.fleets.some(f => f.owner === 'null') || expected.events.some(e => e.message.includes('dispatched')));
  assert.ok(!expected.fleets.some(f => f.owner === 'vesper' || f.owner === 'you'));
  now += 6 * 3600000;
  await service.snapshot(room.id, host);
  now += 6 * 3600000;
  const live = await service.snapshot(room.id, host);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).rooms[0].game, expected);
  assert.deepEqual((await service.history(room.id, host, live.game.hour)).game, live.game);
  const restarted = await GameService.open(file, () => now);
  assert.deepEqual((await restarted.snapshot(room.id, host)).game, live.game);
});

test('faction bots get opening elites, survive restart, and cannot earn faction wins', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-faction-bots-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'db.json');
  const account = { accountId: 'user_botHost' };
  const service = await GameService.open(file, () => 1000);
  const first = await service.create(account, { ...options, playerCount: 2 });
  await service.join(first.invite, guest);
  await service.start(first.id, account);
  const other = await service.snapshot(first.id, guest);
  await service.resign(first.id, guest, { requestId: 'finish-first-game', revision: other.revision });
  await service.chooseFaction(account, 'mnemosyne');
  const room = await service.create(account, { ...options, playerCount: 2 }, 'faction');
  await service.setBot(room.id, account, { faction: 'vesper', enabled: true });
  await service.start(room.id, account);
  const restarted = await GameService.open(file, () => 1000);
  const current = await restarted.snapshot(room.id, account);
  assert.ok(JSON.parse(await readFile(file, 'utf8')).rooms.find((r: { id: string }) => r.id === room.id).game.rocks.flatMap((r: { specialists?: { owner: string; kind: string }[] }) => r.specialists ?? []).some((u: { owner: string; kind: string }) => u.owner === 'vesper' && u.kind === 'general'));
  await restarted.resign(room.id, account, { requestId: 'let-the-bot-win-0001', revision: current.revision });
  assert.ok((await restarted.factions(account)).leaderboard.every(row => row.wins === 0));
  await GameService.open(file, () => 1000);
});
