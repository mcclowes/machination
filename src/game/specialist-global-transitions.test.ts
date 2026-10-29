import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfiguredGame } from './world';
import { advance, type Game } from './simulation';
import { maximumShield, powerCapacity } from './economy';
import { fleetPosition } from './flight';
import { observe } from './visibility';
import { rockSensorRange } from './sensors';
import { withUnitEffects } from './specialist-effects';
import { createArchive, executeCommand, exportArchive, replayTo, restoreArchive, type GameCommand, type ReplayEntry } from './replay';
import { decodeSave } from './save-format';
import type { SpecialistKind } from './specialist-catalog';

// Official Combat/How to lose and individual global effects; no local-stacking interpretation.
// https://subterfuge-game.com/rulebook/ and https://subterfuge-game.com/rulebook/Specialists.html
const kinds = ['admiral', 'tycoon', 'security', 'energy', 'intelligence', 'general', 'king', 'engineer'] as const;
type GlobalKind = typeof kinds[number];

function fixture(kind: GlobalKind, revision: 10 | 11 | 12 = 12) {
  let baseline = createConfiguredGame({ playerCount: 3, mode: 'mining', driftingBases: false }, 0, 2026);
  baseline.rules!.mechanicsVersion = revision;
  baseline.hour = 24;
  for (const site of baseline.rocks) {
    site.productionAt = 1000; site.shieldAt = 1000; site.shieldsDisabled = true;
    if (site.owner === 'you') { site.x = 10; site.y = 10; }
  }
  const own = baseline.rocks.filter(site => site.owner === 'you');
  const [captiveSite, destination, factory, launchSite] = own.filter(site => !site.coreOf) as [Game['rocks'][number], Game['rocks'][number], Game['rocks'][number], Game['rocks'][number]];
  Object.assign(own.find(site => site.coreOf)!, { kind: 'generator', shieldMax: 20 });
  Object.assign(captiveSite, { kind: 'generator', shieldMax: 20 });
  Object.assign(destination, { kind: 'generator', shieldMax: 20 });
  Object.assign(factory, { kind: 'factory', shieldMax: 10 });
  Object.assign(launchSite, { kind: 'factory', shieldMax: 10 });
  const enemy = baseline.rocks.find(site => site.owner === 'vesper' && !site.coreOf)!;
  const combatSource = baseline.rocks.find(site => site.owner === 'null' && !site.coreOf)!;
  const remote = baseline.rocks.find(site => !site.owner)!;
  Object.assign(captiveSite, { x: 20, y: 20, drones: 1, specialists: [{ id: 'global-unit', kind, owner: 'you' }] });
  Object.assign(destination, { x: 49, y: 10 });
  Object.assign(factory, { drones: 31, productionAt: 32, specialists: [{ id: 'combat-witness', kind: 'helmsman', owner: 'you' }] });
  Object.assign(enemy, { x: 28, y: 20, drones: 200 });
  Object.assign(combatSource, { x: 10, y: 18, drones: 40 });
  Object.assign(remote, { x: baseline.rules!.map.width / 2 + 15, y: baseline.rules!.map.height / 2 + 15, kind: 'factory' });
  baseline = withUnitEffects(baseline);
  let game = baseline;
  const entries: ReplayEntry[] = [];
  return {
    captiveSite: captiveSite.id, destination: destination.id, factory: factory.id,
    launchSite: launchSite.id, enemy: enemy.id, combatSource: combatSource.id, remote: remote.id,
    get game() { return game; },
    command(command: GameCommand) {
      entries.push({ hour: game.hour, command });
      game = executeCommand(game, command);
      return game;
    },
    at(hour: number) {
      const split = advance(advance(game, (game.hour + hour) / 2, { rivals: false }), hour, { rivals: false });
      game = advance(game, hour, { rivals: false });
      assert.deepEqual(split, game, 'split advancement agrees across the specialist transition');
      return game;
    },
    check() {
      const data = { ...exportArchive(createArchive(baseline)), entries: [...entries] };
      assert.deepEqual(replayTo(restoreArchive(data), game.hour, { rivals: false, knownThrough: game.hour }), game);
      assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game, replay: data })).game, game);
    },
  };
}

for (const kind of ['admiral', 'tycoon', 'security', 'king'] as const) {
  test(`revision ten preserves the recorded ${kind} release result until clock normalization`, () => {
    const f = fixture(kind, 10);
    f.command({ type: 'dispatch', owner: 'you', from: f.launchSite, to: f.destination, drones: 10 });
    const ordinaryId = f.game.fleets.at(-1)!.id;
    f.command({ type: 'dispatch', owner: 'vesper', from: f.enemy, to: f.captiveSite, drones: 200 });
    f.at(f.game.fleets.at(-1)!.arrives);
    const cached = (game: Game) => kind === 'admiral'
      ? game.fleets.find(fleet => fleet.id === ordinaryId)!.speed!
      : kind === 'tycoon' ? game.rocks.find(site => site.id === f.factory)!.productionInterval!
      : maximumShield(game.rocks.find(site => site.id === f.factory)!);
    const before = cached(f.game);
    f.command({ type: 'release', owner: 'vesper', id: 'global-unit' });
    assert.equal(cached(f.game), before);
    f.check();
    const normalized = advance(f.game, f.game.hour, { rivals: false });
    close(cached(normalized), kind === 'admiral' ? 12 : kind === 'tycoon' ? 8 / 1.5 : kind === 'security' ? 20 : 0);
    assert.notEqual(cached(normalized), before);
  });
}

function close(actual: number, expected: number, message?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-8, message ?? `${actual} differs from ${expected}`);
}

function combatResult(game: Game, f: ReturnType<typeof fixture>) {
  const command: GameCommand = { type: 'dispatch', owner: 'null', from: f.combatSource, to: f.factory, drones: 7 };
  const sent = executeCommand(game, command);
  const arrival = sent.fleets.at(-1)!.arrives;
  const result = advance(sent, arrival, { rivals: false });
  assert.ok(!result.fleets.some(fleet => fleet.id === sent.fleets.at(-1)!.id), `probe combat must resolve at ${arrival}; stopped at ${result.hour}`);
  const archive = { ...exportArchive(createArchive(game)), entries: [{ hour: game.hour, command }] };
  assert.deepEqual(replayTo(restoreArchive(archive), arrival, { rivals: false, knownThrough: arrival }), result);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: result, replay: archive })).game, result);
  assert.equal(result.rocks.find(site => site.id === f.factory)!.owner, 'you');
  return result.rocks.find(site => site.id === f.factory)!.drones;
}

function consequence(kind: GlobalKind, f: ReturnType<typeof fixture>, active: boolean, ordinaryId: number) {
  const game = f.game;
  const factory = game.rocks.find(site => site.id === f.factory)!;
  if (kind === 'admiral') assert.equal(game.fleets.find(fleet => fleet.id === ordinaryId)!.speed, active ? 12 : 8);
  if (kind === 'security') assert.equal(maximumShield(factory), active ? 20 : 10);
  if (kind === 'king') assert.equal(maximumShield(factory), active ? 0 : 10);
  if (kind === 'energy') {
    const generators = game.rocks.filter(site => site.owner === 'you' && site.kind === 'generator').length;
    assert.equal(powerCapacity(game, 'you'), 150 + generators * 50 + (active ? 300 : 0));
    const cycle = advance(game, factory.productionAt!, { rivals: false });
    assert.equal(cycle.rocks.find(site => site.id === factory.id)!.drones - factory.drones, active ? 5 : 6);
  }
  if (kind === 'tycoon') {
    close(factory.productionInterval!, active ? 8 / 1.5 : 8);
    const cycle = advance(game, factory.productionAt!, { rivals: false });
    assert.equal(cycle.rocks.find(site => site.id === factory.id)!.drones - factory.drones, 6, 'remote Tycoon changes cadence, not local output');
  }
  if (kind === 'intelligence') {
    assert.equal(rockSensorRange(game, factory), active ? 40 : 32);
    const view = observe(game, 'you').rocks.find(site => site.id === f.remote)!;
    assert.equal(view.known, false);
    assert.equal(view.kind, active ? 'factory' : 'unknown');
    assert.equal('drones' in view, false);
    assert.equal('specialists' in view, false);
  }
  if (kind === 'general' || kind === 'king' || kind === 'engineer') {
    assert.equal(combatResult(game, f), active ? kind === 'engineer' ? 26 : 31 : 24);
  }
  f.check();
}

for (const kind of kinds satisfies readonly SpecialistKind[]) {
  test(`${kind} global effect stops at capture, returns in release transit, and survives elimination`, () => {
    const f = fixture(kind);
    f.command({ type: 'dispatch', owner: 'you', from: f.launchSite, to: f.destination, drones: 10 });
    const ordinaryId = f.game.fleets.at(-1)!.id;
    consequence(kind, f, true, ordinaryId);

    f.command({ type: 'dispatch', owner: 'vesper', from: f.enemy, to: f.captiveSite, drones: 200 });
    const attacker = f.game.fleets.at(-1)!;
    f.at(attacker.departed);
    f.check();
    const before = f.game;
    const position = fleetPosition({ ...before, hour: attacker.arrives }, before.fleets.find(fleet => fleet.id === ordinaryId)!);
    const oldFactory = before.rocks.find(site => site.id === f.factory)!;
    f.at(attacker.arrives);
    const held = f.game.rocks.find(site => site.id === f.captiveSite)!;
    assert.equal(held.owner, 'vesper');
    assert.deepEqual(held.specialists, [{ id: 'global-unit', kind, owner: 'you', captive: true }]);
    assert.equal(f.game.eliminated.includes('you'), false);
    if (kind === 'admiral') {
      const current = fleetPosition(f.game, f.game.fleets.find(fleet => fleet.id === ordinaryId)!);
      close(current.x, position.x); close(current.y, position.y);
    }
    if (kind === 'tycoon') {
      const factory = f.game.rocks.find(site => site.id === f.factory)!;
      close((factory.productionAt! - f.game.hour) / 8, (oldFactory.productionAt! - f.game.hour) / (8 / 1.5));
    }
    consequence(kind, f, false, ordinaryId);

    const captured = f.game;
    f.command({ type: 'release', owner: 'vesper', id: 'global-unit' });
    const returning = f.game.fleets.find(fleet => fleet.specialists?.some(unit => unit.id === 'global-unit'))!;
    assert.equal(returning.owner, 'you');
    assert.equal(returning.returning, true);
    assert.deepEqual(returning.specialists, [{ id: 'global-unit', kind, owner: 'you' }]);
    assert.ok(returning.arrives > f.game.hour);
    if (kind === 'admiral') {
      assert.deepEqual(fleetPosition(f.game, f.game.fleets.find(fleet => fleet.id === ordinaryId)!),
        fleetPosition(captured, captured.fleets.find(fleet => fleet.id === ordinaryId)!));
    }
    consequence(kind, f, true, ordinaryId);
    f.at(returning.arrives);
    const docked = f.game.rocks.find(site => site.specialists?.some(unit => unit.id === 'global-unit'))!;
    assert.equal(docked.owner, 'you');
    assert.equal(docked.specialists!.find(unit => unit.id === 'global-unit')!.captive, undefined);
    consequence(kind, f, true, ordinaryId);

    f.command({ type: 'resign', owner: 'you' });
    assert.ok(f.game.eliminated.includes('you'));
    assert.equal(f.game.winner, null, 'two other active seats keep the operation running');
    assert.throws(() => executeCommand(f.game, { type: 'dispatch', owner: 'you', from: f.launchSite, to: f.destination, drones: 1 }), /no longer/);
    consequence(kind, f, true, ordinaryId);
  });
}
