import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfiguredGame } from './world';
import { advance as advanceEngine, type Faction, type Game } from './simulation';
import { observe, type GameView } from './visibility';
import { worldDistance } from './geometry';
import { executeCommand, createArchive, restoreArchive, exportArchive, replayTo, type GameCommand, type ReplayEntry } from './replay';
import { decodeReplay } from './replay-save';
import { decodeSave } from './save-format';
import { eventMessage } from '../components/event-message';

// A synchronous event loop cannot be interrupted by node:test's timeout.
function advance(game: Game, hour: number, options: { rivals: false }): Game {
  let steps = 0;
  return advanceEngine(game, hour, { ...options, stopWhen: () => {
    assert.ok(++steps <= 100_000, `event budget exceeded advancing ${game.hour} to ${hour}`);
    return false;
  } });
}

// Contract: docs/subterfuge-parity.md reference rules and docs/replay-contract.md.
// Deliberately asymmetric self-play: an expansionist faces probing, home-defense
// controllers. This is acceptance of engine interactions, not an official AI oracle.
function decide(view: GameView, owner: Faction): GameCommand[] {
  if (view.winner || view.draw || view.eliminated.includes(owner)) return [];
  const owned = view.rocks.filter(r => r.known && r.owner === owner);
  const commands: GameCommand[] = [];
  const nearest = (from: typeof view.rocks[number], candidates: typeof view.rocks) =>
    [...candidates].sort((a, b) => worldDistance(view, from, a) - worldDistance(view, from, b) || a.id.localeCompare(b.id))[0];
  if (view.hour === 0) {
    const source = owned.find(r => r.drones! >= 40)!;
    const enemy = nearest(source, view.rocks.filter(r => r.owner && r.owner !== owner))!;
    commands.push({ type: 'dispatch', owner, from: source.id, to: enemy.id, drones: 1 });
    return commands;
  }
  if (view.rules!.mode === 'mining') {
    if (owned.some(r => r.kind === 'mine')) return [];
    const source = owned.find(r => ['factory', 'generator'].includes(r.kind) && r.drones! >= 50);
    if (source) return [{ type: 'drill-mine', owner, rock: source.id }];
    const factory = owned.find(r => r.kind === 'factory')!;
    const donor = owned.find(r => r.id !== factory.id && r.drones! >= 20);
    if (donor && !view.fleets.some(f => f.owner === owner)) return [{ type: 'dispatch', owner, from: donor.id, to: factory.id, drones: 20 }];
    return [];
  }
  if (owner !== 'you') return [];
  const reserved = new Set(view.fleets.filter(f => f.owner === owner).map(f => f.to));
  for (const source of owned) {
    if (source.drones! < 10) continue;
    const target = nearest(source, view.rocks.filter(r => r.owner === null && !reserved.has(r.id)));
    if (!target) break;
    reserved.add(target.id);
    commands.push({ type: 'dispatch', owner, from: source.id, to: target.id, drones: 10 });
  }
  return commands;
}

function inspect(game: Game) {
  const players = game.rules!.players;
  assert.ok(Number.isFinite(game.hour));
  assert.equal(new Set(game.fleets.map(f => f.id)).size, game.fleets.length);
  for (const rock of game.rocks) assert.ok(Number.isSafeInteger(rock.drones) && rock.drones >= 0);
  for (const owner of players) {
    assert.ok(Number.isSafeInteger(game.cargo[owner]) && game.cargo[owner]! >= 0);
    const view = observe(game, owner);
    assert.equal('seed' in view.rules!.map, false);
    assert.deepEqual(Object.keys(view.cargo), [owner]);
    assert.deepEqual(Object.keys(view.recruitment ?? {}), [owner]);
    assert.equal('seed' in view.recruitment![owner]!, false);
    assert.equal('pool' in view.recruitment![owner]!, false);
    for (const rock of view.rocks.filter(r => !r.known)) {
      for (const key of ['drones', 'specialists', 'productionAt', 'shield', 'miningAt']) assert.equal(key in rock, false);
    }
    for (const fleet of view.fleets) {
      assert.equal('lastContacts' in fleet, false);
      if (fleet.preparing) assert.equal(fleet.owner, owner);
    }
    assert.ok(view.scheduled.every(p => p.owner === owner));
    assert.deepEqual(view.events, game.events.filter(e => e.audience?.includes(owner)).slice(0, view.events.length).map(e => ({ hour: e.hour, message: e.message })));
  }
}

function playSchedule(baseline: Game, entries: ReplayEntry[], end: number, partitioned: boolean) {
  let game = baseline;
  const move = (hour: number) => {
    if (partitioned && hour > game.hour) game = advance(game, game.hour + (hour - game.hour) * 0.371, { rivals: false });
    if (hour > game.hour) game = advance(game, hour, { rivals: false });
  };
  for (const entry of entries) {
    move(entry.hour);
    game = executeCommand(game, entry.command);
  }
  move(end);
  return game;
}

for (const playerCount of [2, 3, 10]) for (const mode of ['mining', 'domination'] as const) for (const seed of [7, 2026]) {
  test(`complete generated ${mode} match: ${playerCount} seats, seed ${seed}`, { timeout: 30000 }, () => {
    const baseline = createConfiguredGame({ playerCount, mode, driftingBases: false }, 0, seed);
    assert.equal(baseline.rules!.mechanicsVersion, 5);
    assert.ok(baseline.rocks.every(rock => !rock.drift), 'Subterfuge acceptance uses stationary bases');
    assert.equal(baseline.rocks.filter(r => r.owner === null).length, playerCount * 5);
    assert.equal(baseline.rocks.filter(r => r.kind === 'mine').length, 0);
    const retained = createArchive(baseline);
    const entries: ReplayEntry[] = [];
    let game = baseline;
    let miningPayouts = false;
    let captured = false;
    inspect(game);
    for (let round = 0; round < 60 && !game.winner && !game.draw; round++) {
      for (const owner of baseline.rules!.players) {
        // Controllers receive only their redacted current observation.
        for (const command of decide(observe(game, owner), owner)) {
          const hour = game.hour;
          game = executeCommand(game, command);
          entries.push({ hour, command });
        }
      }
      const before = game.hour;
      game = advance(game, before + 24, { rivals: false });
      assert.ok(game.hour > before, 'every round must advance the event clock');
      assert.ok(game.hour <= before + 24);
      miningPayouts ||= Object.values(game.cargo).some(n => n! > 0);
      captured ||= game.rocks.some(r => r.owner !== null && baseline.rocks.find(b => b.id === r.id)!.owner === null);
      inspect(game);
    }
    assert.ok(game.winner || game.draw, `match did not finish by hour ${game.hour}`);
    assert.equal(game.draw, undefined);
    assert.ok(game.winner);
    // Independent rule-contract assertions, without a seed-specific expected winner.
    assert.equal(game.rules!.victoryTarget, mode === 'mining' ? 200 : playerCount * 5);
    if (mode === 'mining') {
      assert.ok(game.cargo[game.winner]! >= 200);
      assert.ok(miningPayouts);
      assert.ok(entries.some(e => e.command.type === 'drill-mine'));
      assert.ok(game.rocks.some(r => r.kind === 'mine' && r.miningAt! > game.hour));
    } else {
      assert.ok(game.rocks.filter(r => r.owner === game.winner).length >= playerCount * 5);
      assert.ok(captured);
    }
    assert.ok(entries.filter(e => e.command.type === 'dispatch').length >= playerCount);
    for (const owner of baseline.rules!.players) {
      const probe = entries.find(e => e.hour === 0 && e.command.type === 'dispatch' && e.command.owner === owner)!;
      assert.ok(probe && probe.command.type === 'dispatch');
      const target = probe.command.to;
      assert.notEqual(baseline.rocks.find(r => r.id === target)!.owner, owner);
    }
    assert.ok(game.fleets.every(f => f.id > playerCount), 'opening attacks must resolve, not remain in preparation or transit');
    const data = { ...exportArchive(retained), entries };
    assert.deepEqual(exportArchive(retained).baseline, baseline);
    assert.deepEqual(exportArchive(retained).entries, []);
    const archive = restoreArchive(data);
    const options = { rivals: false, knownThrough: game.hour };
    assert.deepEqual(replayTo(archive, game.hour, options), game);
    assert.deepEqual(playSchedule(baseline, entries, game.hour, false), game);
    assert.deepEqual(playSchedule(baseline, entries, game.hour, true), game);
    const saved = decodeSave(JSON.stringify({ savedAt: 0, game, replay: data }));
    assert.deepEqual(saved.game, game);
    const restored = decodeReplay(JSON.parse(JSON.stringify(data)), saved.game, false);
    assert.deepEqual(replayTo(restored, game.hour, options), game);
    assert.deepEqual(advance(game, game.hour + 100, { rivals: false }), game);
    assert.deepEqual(replayTo(archive, game.hour + 100, { ...options, knownThrough: game.hour + 100 }), game);
  });
}

for (const mode of ['mining', 'domination'] as const) for (const seed of [7, 2026]) {
  test(`generated ${mode} match ends through leadership capture: seed ${seed}`, () => {
    const baseline = createConfiguredGame({ playerCount: 2, mode, driftingBases: false }, 0, seed);
    const players = baseline.rules!.players;
    // Each seat voluntarily discloses its own core's location for an arranged convoy battle.
    const cores = new Map(players.map(owner => [owner, observe(baseline, owner).rocks.find(r =>
      r.known && r.specialists?.some(u => u.kind === 'queen' && u.owner === owner))!.id]));
    const entries: ReplayEntry[] = [];
    let game = baseline;
    const submit = (command: GameCommand) => {
      entries.push({ hour: game.hour, command });
      game = executeCommand(game, command);
    };
    for (const owner of players) {
      const view = observe(game, owner);
      const donor = view.rocks.find(r => r.known && r.owner === owner && r.drones! >= 40)!;
      submit({ type: 'dispatch', owner, from: donor.id, to: cores.get(owner)!, drones: 40 });
    }
    game = advance(game, Math.max(...game.fleets.map(f => f.arrives)), { rivals: false });
    for (const owner of players) {
      const view = observe(game, owner);
      const source = view.rocks.find(r => r.id === cores.get(owner))!;
      assert.ok(source.known);
      const queen = source.specialists!.find(u => u.kind === 'queen' && u.owner === owner)!;
      const target = [...cores].find(([other]) => other !== owner)![1];
      submit({ type: 'dispatch', owner, from: source.id, to: target, drones: owner === 'you' ? 40 : 39, specialists: [queen.id] });
    }
    const arrival = Math.max(...game.fleets.map(f => f.arrives));
    game = advance(game, arrival + 1, { rivals: false });
    assert.equal(game.winner, 'you');
    assert.deepEqual(game.eliminated, ['vesper']);
    assert.equal(game.draw, undefined);
    assert.ok(game.hour < arrival, 'leadership capture must finish the game during route combat');
    assert.ok(game.fleets.some(f => f.specialists?.some(u => u.kind === 'queen' && u.owner === 'vesper' && u.captive)));
    assert.equal(game.rocks.filter(r => r.owner === 'vesper').length, 5, 'eliminated sites persist');
    assert.deepEqual(game.rocks.map(r => r.owner), baseline.rocks.map(r => r.owner));
    assert.equal(game.cargo.you, 0, 'mining quota is not the victory condition');
    assert.equal(game.rocks.filter(r => r.owner === 'you').length, 5, 'domination target is not reached');
    for (const owner of players) {
      const view = observe(game, owner);
      assert.equal(eventMessage(view, view.events[0]!), 'Mnemosyne: last intelligence active. Contract complete.');
    }
    inspect(game);
    const donor = game.rocks.find(r => r.owner === 'vesper' && r.drones >= 1)!;
    assert.throws(() => executeCommand(game, { type: 'dispatch', owner: 'vesper', from: donor.id, to: cores.get('vesper')!, drones: 1 }));
    const data = { ...exportArchive(createArchive(baseline)), entries };
    const archive = restoreArchive(data);
    assert.deepEqual(replayTo(archive, game.hour, { rivals: false, knownThrough: game.hour }), game);
    assert.deepEqual(playSchedule(baseline, entries, game.hour, true), game);
    assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game, replay: data })).game, game);
    assert.deepEqual(advance(game, game.hour + 100, { rivals: false }), game);
  });
}
