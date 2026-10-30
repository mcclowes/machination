import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GameService } from './service';

const host = { accountId: 'user_factionHost' }, guest = { accountId: 'user_factionGuest' };
const options = { playerCount: 2, mode: 'domination' };
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'machination-factions-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'games.json');
  return { file, service: await GameService.open(file, () => 1000) };
}
async function complete(service: GameService) {
  const room = await service.create(host, options);
  await service.join(room.invite, guest);
  await service.start(room.id, host);
  const seat = await service.snapshot(room.id, guest);
  await service.resign(room.id, guest, { requestId: randomUUID(), revision: seat.revision });
  return room;
}

test('faction choice requires a finished game, is permanent, and survives the next operation and restart', async t => {
  const { file, service } = await setup(t);
  assert.equal((await service.factions(host)).completedGames, 0);
  await assert.rejects(service.chooseFaction(host, 'mnemosyne'), { code: 'faction.conflict.locked' });
  const first = await complete(service);
  assert.equal((await service.factions(host)).completedGames, 1);
  assert.equal((await service.chooseFaction(host, 'mnemosyne')).faction, 'mnemosyne');
  assert.equal((await service.chooseFaction(host, 'mnemosyne')).faction, 'mnemosyne');
  await assert.rejects(service.chooseFaction(host, 'vesper'), { code: 'faction.conflict.chosen' });
  const next = await service.create(host, options);
  assert.notEqual(next.id, first.id);
  assert.equal((await service.accountSession(host))!.id, next.id);
  const restored = await GameService.open(file, () => 1000);
  assert.equal((await restored.factions(host)).faction, 'mnemosyne');
  assert.equal((await restored.snapshot(first.id, host)).status, 'game.finished');
});

test('faction rooms require membership, start each seat with exactly its extra elite, and count one win across retries and restarts', async t => {
  const { file, service } = await setup(t);
  await assert.rejects(service.create(host, options, 'faction'), { code: 'faction.conflict.required' });
  await complete(service);
  await service.chooseFaction(host, 'mnemosyne');
  const room = await service.create(host, options, 'faction');
  assert.equal(room.variant, 'faction');
  await assert.rejects(service.join(room.invite, guest), { code: 'faction.conflict.required' });
  await service.chooseFaction(guest, 'null');
  await service.join(room.invite, guest);
  const started = await service.start(room.id, host);
  assert.deepEqual(started.allegiances, [{ player: 'you', faction: 'mnemosyne' }, { player: 'vesper', faction: 'null' }]);
  for (const [token, owner, elite] of [[host, 'you', 'security'], [guest, 'vesper', 'tycoon']] as const) {
    const seat = await service.snapshot(room.id, token);
    const units = seat.game.rocks.flatMap(r => r.specialists ?? []).filter(u => u.owner === owner);
    assert.equal(units.filter(u => u.kind === elite).length, 1);
    assert.equal(units.filter(u => u.kind === 'queen').length, 1);
    assert.equal(seat.game.recruitment![owner]!.used, 0);
    const historical = await service.history(room.id, token, 0);
    assert.ok(historical.game.rocks.some(r => r.specialists?.some(u => u.owner === owner && u.kind === elite)));
  }
  const repeated = await service.start(room.id, host);
  assert.deepEqual(repeated.game, started.game);
  const seat = await service.snapshot(room.id, guest);
  const resignation = { requestId: randomUUID(), revision: seat.revision };
  await service.resign(room.id, guest, resignation);
  await service.resign(room.id, guest, resignation);
  assert.deepEqual((await service.factions(host)).leaderboard.map(r => r.wins), [1, 0, 0]);
  const restored = await GameService.open(file, () => 1000);
  assert.equal((await restored.factions(host)).leaderboard[0]!.faction, 'mnemosyne');
  assert.equal((await restored.factions(host)).leaderboard[0]!.wins, 1);
  const standard = await restored.create(host, options);
  await restored.join(standard.invite, guest);
  const ordinary = await restored.start(standard.id, host);
  assert.equal(ordinary.variant, undefined);
  assert.equal(ordinary.game.rocks.flatMap(r => r.specialists ?? []).filter(u => u.owner === 'you' && u.kind !== 'queen').length, 0);
});

test('device recovery and account linking retain completion history and permanent membership', async t => {
  const { file, service } = await setup(t);
  const original = 'a'.repeat(64), replacement = 'b'.repeat(64), other = 'c'.repeat(64), secret = 'd'.repeat(64);
  const room = await service.create(original, options);
  await service.join(room.invite, other);
  await service.start(room.id, original);
  const seat = await service.snapshot(room.id, other);
  await service.resign(room.id, other, { requestId: randomUUID(), revision: seat.revision });
  await service.chooseFaction(original, 'vesper');
  await service.setRecovery(room.id, original, { requestId: randomUUID(), secret });
  await service.recover(room.id, replacement, { secret });
  assert.equal((await service.factions(replacement)).faction, 'vesper');
  await service.linkAccount(room.id, replacement, host);
  assert.equal((await service.factions(host)).completedGames, 1);
  assert.equal((await service.factions(host)).faction, 'vesper');
  await assert.rejects(service.chooseFaction(host, 'null'), { code: 'faction.conflict.chosen' });
  const next = await service.create(host, options, 'faction');
  assert.equal(next.variant, 'faction');
  const restored = await GameService.open(file, () => 1000);
  assert.equal((await restored.factions(host)).faction, 'vesper');
});

test('revoked device credentials cannot choose a faction after recovery or account linking', async t => {
  const { service } = await setup(t);
  const original = 'e'.repeat(64), replacement = 'f'.repeat(64), guest = 'a'.repeat(64), secret = 'b'.repeat(64);
  const room = await service.create(original, options);
  await service.join(room.invite, guest); await service.start(room.id, original);
  const seat = await service.snapshot(room.id, guest);
  await service.resign(room.id, guest, { requestId: randomUUID(), revision: seat.revision });
  await service.setRecovery(room.id, original, { requestId: randomUUID(), secret });
  await service.recover(room.id, replacement, { secret });
  await assert.rejects(service.chooseFaction(original, 'null'), { status: 401 });
  await service.linkAccount(room.id, replacement, host);
  await assert.rejects(service.chooseFaction(replacement, 'null'), { status: 401 });
  assert.equal((await service.chooseFaction(host, 'mnemosyne')).faction, 'mnemosyne');
});

test('a simultaneous inactivity draw adds completion history but awards no faction win', async t => {
  const { file } = await setup(t);
  let now = 1000;
  const service = await GameService.open(file, () => now);
  await complete(service);
  await service.chooseFaction(host, 'vesper'); await service.chooseFaction(guest, 'vesper');
  const room = await service.create(host, options, 'faction');
  await service.join(room.invite, guest); await service.start(room.id, host);
  const view = await service.snapshot(room.id, guest);
  assert.equal(view.game.rocks.flatMap(r => r.specialists ?? []).filter(u => u.kind === 'general' && u.owner === 'vesper').length, 1);
  now += 49 * 3_600_000;
  const standings = await service.factions(host);
  assert.equal(standings.completedGames, 2);
  assert.ok(standings.leaderboard.every(r => r.wins === 0));
  assert.equal((await service.snapshot(room.id, host)).game.draw, true);
});

test('faction starter effects apply at hour zero without spending recruitment or changing the ordinary core', async t => {
  const { service } = await setup(t);
  await complete(service);
  await service.chooseFaction(host, 'mnemosyne'); await service.chooseFaction(guest, 'null');
  const room = await service.create(host, options, 'faction'); await service.join(room.invite, guest);
  const started = await service.start(room.id, host);
  const core = started.game.rocks.find(r => r.owner === 'you' && r.specialists?.some(u => u.kind === 'queen'))!;
  assert.equal(core.shieldBonus, 20);
  assert.ok(started.game.rocks.filter(r => r.owner === 'you' && r.id !== core.id).every(r => r.shieldBonus === 10));
  const industrial = await service.snapshot(room.id, guest);
  assert.ok(industrial.game.rocks.filter(r => r.owner === 'vesper' && r.kind === 'factory').every(r => r.productionInterval === 8 / 1.5));
  assert.equal(started.game.cargo.you, room.game.cargo.you);
  assert.equal(started.game.recruitment!.you!.used, 0);
});


test('legacy rooms without faction metadata retain eligibility and corrupted memberships fail startup', async t => {
  const { file, service } = await setup(t);
  await complete(service);
  const legacy = JSON.parse(await readFile(file, 'utf8'));
  for (const room of legacy.rooms) for (const seat of room.seats) delete seat.profileId;
  await writeFile(file, JSON.stringify(legacy));
  const migrated = await GameService.open(file, () => 1000);
  assert.equal((await migrated.chooseFaction(host, 'mnemosyne')).faction, 'mnemosyne');
  await migrated.chooseFaction(guest, 'null');
  await migrated.create(host, options, 'faction');
  const valid = JSON.parse(await readFile(file, 'utf8'));
  for (const corrupt of [
    (db: any) => { db.factions[0].faction = 'unknown'; },
    (db: any) => { db.factions.push(db.factions[0]); },
    (db: any) => { db.rooms[1].seats[0].allegiance = 'null'; },
    (db: any) => { delete db.rooms[1].seats[0].allegiance; },
  ]) {
    const db = structuredClone(valid); corrupt(db);
    await writeFile(file, JSON.stringify(db));
    await assert.rejects(GameService.open(file, () => 1000), /Damaged faction/);
  }
});

test('a failed durable write cannot make a faction choice permanent', async t => {
  const { file, service } = await setup(t);
  await complete(service);
  const backup = `${file}.backup`;
  await rename(file, backup); await mkdir(file);
  await assert.rejects(service.chooseFaction(host, 'mnemosyne'));
  await rm(file, { recursive: true }); await rename(backup, file);
  assert.equal((await service.chooseFaction(host, 'vesper')).faction, 'vesper');
});
