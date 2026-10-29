import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { GameService } from './service';
import type { Database } from './database';
import { createConfiguredGame } from '../src/game/world';
import { withUnitEffects } from '../src/game/specialist-effects';
import { decodeSave } from '../src/game/save-format';
import { activeUnits } from '../src/game/specialists';
import { canObserveHauler } from '../src/game/sensors';
import type { Faction, Game } from '../src/game/simulation';
import type { Snapshot } from '../src/online/protocol';

const HOUR = 3_600_000;
const sites = { core: '', fallback: '', enemy: '' };

/** Vesper sits next to the host's undefended core; the host's nearest Princess waits at a second site. */
function world(revision: 13 | 14, diplomat = false): () => Game {
  return () => {
    const game = createConfiguredGame({ playerCount: 3, mode: 'mining' }, 0, 73);
    game.rules!.mechanicsVersion = revision;
    for (const rock of game.rocks) Object.assign(rock, { productionAt: 1000, shieldAt: 1000, shieldsDisabled: true });
    const core = game.rocks.find(r => r.coreOf === 'you')!;
    const fallback = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
    const enemy = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
    Object.assign(core, { x: 20, y: 20, drones: 0 }); Object.assign(enemy, { x: 28, y: 20, drones: 100 }); Object.assign(fallback, { x: 40, y: 20, drones: 200 });
    fallback.specialists!.push({ id: 'fallback-princess', kind: 'princess', owner: 'you' }, ...(diplomat ? [{ id: 'envoy', kind: 'diplomat' as const, owner: 'you' as const }] : []));
    Object.assign(sites, { core: core.id, fallback: fallback.id, enemy: enemy.id });
    return withUnitEffects(game);
  };
}

async function fixture(t: TestContext, initial: () => Game) {
  const dir = await mkdtemp(join(tmpdir(), 'machination-queen-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'games.json');
  const clock = { now: 0 };
  const open = () => GameService.open(file, () => clock.now, initial);
  let service = await open();
  const tokens = { you: randomBytes(32).toString('hex'), vesper: randomBytes(32).toString('hex'), null: randomBytes(32).toString('hex') } as const;
  const room = await service.create(tokens.you);
  await service.join(room.invite, tokens.vesper); await service.join(room.invite, tokens.null);
  await service.start(room.id, tokens.you);
  const stored = async () => (JSON.parse(await readFile(file, 'utf8')) as Database).rooms[0]!;
  const snap = (seat: keyof typeof tokens) => service.snapshot(room.id, tokens[seat]);
  /** Vesper takes the undefended core with one drone; the host's Princess succeeds. */
  async function capture() {
    const s = await snap('vesper');
    const sent = await service.order(room.id, tokens.vesper, { requestId: randomUUID(), revision: s.revision, from: sites.enemy, to: sites.core, drones: 1 });
    clock.now = sent.game.fleets.find(f => f.owner === 'vesper')!.arrives * HOUR + 1000;
    return snap('vesper');
  }
  return { file, clock, room, tokens, stored, snap, capture, get service() { return service; }, reopen: async () => { service = await open(); } };
}

const queens = (game: Pick<Game, 'rocks' | 'fleets'>, owner: Faction) => activeUnits(game as Game, owner).filter(u => u.kind === 'queen');
const strict = (game: Game) => decodeSave(JSON.stringify({ savedAt: 0, game })).game;
const ownUnits = (view: Snapshot['game'], owner: Faction) => [...view.rocks, ...view.fleets].flatMap(a => (a.specialists ?? []).filter(u => u.owner === owner).map(u => ({ ...u, at: a.owner })));
/** The third seat sees exactly the haulers the observation rule allows, and no modules at sites it cannot see. */
function assertNoLeak(view: Snapshot['game'], game: Game) {
  assert.equal(view.fleets.length, game.fleets.filter(f => canObserveHauler(game, 'null', f)).length);
  for (const rock of view.rocks) if (!rock.known) assert.equal(rock.specialists, undefined);
}

test('revision 14: an explicit release returns the original Queen as a Princess, scoped, retry-safe, durable, and in history', async t => {
  const f = await fixture(t, world(14));
  const captured = await f.capture();
  const before = await f.stored();
  assert.deepEqual(queens(before.game, 'you').map(u => u.id), ['fallback-princess'], 'the nearest Princess succeeded');
  const prisoner = captured.game.rocks.find(r => r.id === sites.core)!.specialists!.find(u => u.owner === 'you' && u.captive)!;
  assert.ok(prisoner, 'the captor sees its prisoner');
  const host = await f.snap('you');
  const recruitment = host.game.recruitment;
  const order = { requestId: randomUUID(), revision: captured.revision, action: 'release' as const, unit: prisoner.id };
  for (const seat of ['you', 'null'] as const) {
    const view = await f.snap(seat);
    await assert.rejects(() => f.service.specialist(f.room.id, f.tokens[seat], { ...order, requestId: randomUUID(), revision: view.revision }), { status: 409 }, `${seat} cannot release Vesper's prisoner`);
  }
  const released = await f.service.specialist(f.room.id, f.tokens.vesper, order);
  const retried = await f.service.specialist(f.room.id, f.tokens.vesper, order);
  assert.deepEqual(retried, released, 'an identical retry returns the same view');
  const after = await f.stored();
  strict(after.game);
  assert.deepEqual(queens(after.game, 'you').map(u => u.id), ['fallback-princess'], 'exactly one active Queen');
  const returning = after.game.fleets.filter(fl => fl.owner === 'you' && fl.returning);
  assert.equal(returning.length, 1, 'one return hauler, even after the retry');
  assert.deepEqual(returning[0]!.specialists!.map(u => [u.id, u.kind, !!u.captive]), [['core-you', 'princess', false]], 'demoted at once, before arrival');
  assert.equal(after.game.rocks.find(r => r.id === sites.fallback)!.specialists!.find(u => u.id === 'fallback-princess')!.kind, 'queen', 'the successor stays at its site');
  const hostAfter = await f.snap('you');
  assert.deepEqual(hostAfter.game.recruitment, recruitment, 'recruitment credits are unchanged by a release');
  assert.equal(ownUnits(hostAfter.game, 'you').filter(u => u.kind === 'queen' && !u.captive).length, 1, 'the host view shows one Queen');
  assertNoLeak((await f.snap('null')).game, after.game);
  const releasedAt = after.game.hour;
  const history = await f.service.history(f.room.id, f.tokens.you, releasedAt);
  assert.equal(ownUnits(history.game, 'you').filter(u => u.kind === 'queen' && !u.captive).length, 1, 'history at the release instant has one Queen');
  await f.reopen();
  assert.deepEqual(await f.snap('you'), hostAfter, 'the room loads strictly after restart');
  assert.deepEqual(await f.service.specialist(f.room.id, f.tokens.vesper, order), released, 'the receipt survives restart');
  f.clock.now = returning[0]!.arrives * HOUR + 1000;
  const docked = await f.snap('you');
  const home = await f.stored();
  strict(home.game);
  assert.deepEqual(home.game.rocks.find(r => r.id === returning[0]!.to)!.specialists!.filter(u => u.id === 'core-you').map(u => [u.kind, !!u.captive]), [['princess', false]], 'the original docks at the return site as a Princess');
  assert.equal(home.game.fleets.some(fl => fl.specialists?.some(u => u.id === 'core-you')), false, 'no return hauler still carries it');
  assert.equal(home.game.rocks.find(r => r.id === sites.fallback)!.specialists!.find(u => u.id === 'fallback-princess')!.kind, 'queen', 'the successor is still Queen');
  assert.deepEqual(queens(home.game, 'you').map(u => u.id), ['fallback-princess']);
  await f.reopen();
  assert.deepEqual(await f.snap('you'), docked, 'the docked state loads strictly after restart');
});

test('revision 14: a Diplomat rescue during zero-command settlement returns a Princess and the room stays strict through restart', async t => {
  const f = await fixture(t, world(14, true));
  await f.capture();
  const room = await f.stored();
  strict(room.game);
  assert.deepEqual(queens(room.game, 'you').map(u => u.id), ['fallback-princess']);
  const original = [...room.game.rocks, ...room.game.fleets].flatMap(a => a.specialists ?? []).find(u => u.id === 'core-you')!;
  assert.equal(original.kind, 'princess'); assert.equal(original.captive, undefined, 'the envoy freed the original');
  assertNoLeak((await f.snap('null')).game, room.game);
  const host = await f.snap('you');
  await f.reopen();
  assert.deepEqual(await f.snap('you'), host);
});

test('revision 14: recapturing the holding site restores the original as a Princess, with a retry-safe order', async t => {
  const f = await fixture(t, world(14));
  await f.capture();
  const host = await f.snap('you');
  const order = { requestId: randomUUID(), revision: host.revision, from: sites.fallback, to: sites.core, drones: 150 };
  const sent = await f.service.order(f.room.id, f.tokens.you, order);
  assert.deepEqual(await f.service.order(f.room.id, f.tokens.you, order), sent, 'identical retry');
  const attack = (await f.stored()).game.fleets.filter(fl => fl.owner === 'you');
  assert.equal(attack.length, 1, 'one hauler despite the retry');
  f.clock.now = attack[0]!.arrives * HOUR + 1000;
  await f.snap('you');
  const room = await f.stored();
  strict(room.game);
  const core = room.game.rocks.find(r => r.id === sites.core)!;
  assert.equal(core.owner, 'you');
  assert.deepEqual(core.specialists!.filter(u => u.id === 'core-you').map(u => [u.kind, !!u.captive]), [['princess', false]]);
  assert.deepEqual(queens(room.game, 'you').map(u => u.id), ['fallback-princess']);
  assertNoLeak((await f.snap('null')).game, room.game);
  const view = await f.snap('you');
  await f.reopen();
  assert.deepEqual(await f.snap('you'), view);
});

test('revision 14: losing the successor later promotes the nearest Princess, which can be the restored original', async t => {
  const f = await fixture(t, world(14));
  await f.capture();
  const host = await f.snap('you');
  const sent = await f.service.order(f.room.id, f.tokens.you, { requestId: randomUUID(), revision: host.revision, from: sites.fallback, to: sites.core, drones: 150 });
  f.clock.now = sent.game.fleets.find(fl => fl.owner === 'you')!.arrives * HOUR + 1000;
  const rival = await f.snap('vesper');
  strict((await f.stored()).game);
  const strike = await f.service.order(f.room.id, f.tokens.vesper, { requestId: randomUUID(), revision: rival.revision, from: sites.enemy, to: sites.fallback, drones: 99 });
  f.clock.now = strike.game.fleets.find(fl => fl.owner === 'vesper')!.arrives * HOUR + 1000;
  await f.snap('you');
  const room = await f.stored();
  assert.equal(room.game.rocks.find(r => r.id === sites.fallback)!.owner, 'vesper', 'the successor site fell');
  strict(room.game);
  assert.deepEqual(queens(room.game, 'you').map(u => u.id), ['core-you'], 'the restored original is promoted again as the nearest Princess');
  assert.equal(room.game.eliminated.includes('you'), false);
});

test('revision 13 is unchanged: a release duplicates the Queen and the persisted room is then refused on restart', async t => {
  const f = await fixture(t, world(13));
  const captured = await f.capture();
  const prisoner = captured.game.rocks.find(r => r.id === sites.core)!.specialists!.find(u => u.owner === 'you' && u.captive)!;
  await f.service.specialist(f.room.id, f.tokens.vesper, { requestId: randomUUID(), revision: captured.revision, action: 'release', unit: prisoner.id });
  const room = await f.stored();
  assert.equal(queens(room.game, 'you').length, 2, 'legacy engine results are kept for replay compatibility');
  assert.throws(() => strict(room.game), 'the strict one-Queen invariant refuses it');
  await assert.rejects(() => f.reopen(), 'so such a room blocks the next service start: deployment needs a strict room scan first');
});
