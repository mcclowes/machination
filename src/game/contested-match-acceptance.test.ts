import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfiguredGame } from './world';
import { advance as advanceEngine, type Game, type Faction } from './simulation';
import { observe, type GameView } from './visibility';
import { worldDistance } from './geometry';
import { createArchive, exportArchive, restoreArchive, executeCommand, traceReplayTo, type GameCommand, type ReplayEntry } from './replay';
import { decodeSave } from './save-format';
import type { SimulationTraceSink } from './simulation-trace';

const EVENT_BUDGET = 20_000;
function advance(game: Game, hour: number, trace?: SimulationTraceSink): Game {
  let events = 0;
  return advanceEngine(game, hour, { rivals: false, trace, stopWhen: () => {
    assert.ok(++events <= EVENT_BUDGET, `advance stalled between ${game.hour} and ${hour}`);
    return false;
  } });
}

type Memory = { held: Set<string>; lost: Set<string> };
// Each invocation sees one seat's observation and its own observation-derived history.
function decide(view: GameView, owner: Faction, memory: Memory): GameCommand[] {
  if (view.winner || view.draw || view.eliminated.includes(owner)) return [];
  const owned = view.rocks.filter(r => r.known && r.owner === owner);
  for (const id of memory.held) if (!owned.some(r => r.id === id)) memory.lost.add(id);
  for (const r of owned) { memory.held.add(r.id); memory.lost.delete(r.id); }
  const reserved = new Set(view.fleets.filter(f => f.owner === owner).map(f => f.to));
  const commands: GameCommand[] = [];
  const rank = view.rules!.players.indexOf(owner);
  for (const source of owned) {
    const queen = source.specialists?.some(u => u.kind === 'queen' && u.owner === owner);
    const reserve = queen ? 35 : 4 + rank * 3;
    const available = source.drones! - reserve;
    if (view.rules!.mode === 'mining' && view.hour >= 144 + rank * 24 && !queen &&
        !owned.some(r => r.kind === 'mine') && ['factory', 'generator'].includes(source.kind) && source.drones! >= Math.max(50, (view.minesDrilled?.[owner] ?? 0) * 100)) {
      commands.push({ type: 'drill-mine', owner, rock: source.id });
      break;
    }
    if (available < 12) continue;
    const targets = view.rocks.filter(r => r.id !== source.id && r.owner !== owner && !r.destroyed && !reserved.has(r.id) && !(r.known && r.specialists?.some(u => u.kind === 'queen' && !u.captive)));
    const score = (r: typeof view.rocks[number]) => worldDistance(view, source, r) +
      (r.owner === null ? -12 : 0) - (memory.lost.has(r.id) ? 45 : 0);
    targets.sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id));
    const target = targets[0];
    if (!target) continue;
    const defense = target.known ? target.drones + (target.shield ?? 0) : 25;
    // A visible incoming attack raises the garrison retained at its destination.
    const threat = view.fleets.filter(f => f.owner !== owner && f.to === source.id).reduce((n, f) => n + f.drones, 0);
    const drones = Math.floor(Math.min(available, source.drones! - threat - reserve));
    if (drones < 12) continue;
    if (drones > defense + 5 || (!target.known && drones >= 35)) {
      commands.push({ type: 'dispatch', owner, from: source.id, to: target.id, drones });
      reserved.add(target.id);
    } else {
      const front = [...owned].filter(r => r.id !== source.id && r.kind !== 'mine').sort((a, b) =>
        worldDistance(view, a, target) - worldDistance(view, b, target) || a.id.localeCompare(b.id))[0];
      if (front && worldDistance(view, front, target) + 1 < worldDistance(view, source, target)) {
        commands.push({ type: 'dispatch', owner, from: source.id, to: front.id, drones });
      }
    }
  }
  return commands;
}

function inspect(game: Game) {
  for (const r of game.rocks) assert.ok(Number.isSafeInteger(r.drones) && r.drones >= 0);
  assert.equal(new Set(game.fleets.map(f => f.id)).size, game.fleets.length);
  for (const f of game.fleets) assert.ok(Number.isSafeInteger(f.drones) && f.drones >= 0);
  for (const owner of game.rules!.players) {
    assert.ok(Number.isSafeInteger(game.cargo[owner]) && game.cargo[owner]! >= 0);
    const v = observe(game, owner);
    assert.equal('seed' in v.rules!.map, false);
    assert.deepEqual(Object.keys(v.cargo), [owner]);
    assert.deepEqual(Object.keys(v.recruitment!), [owner]);
    assert.equal('seed' in v.recruitment![owner]!, false);
    assert.equal('pool' in v.recruitment![owner]!, false);
    for (const r of v.rocks.filter(r => !r.known)) for (const field of ['drones', 'specialists', 'shield', 'productionAt', 'miningAt']) assert.equal(field in r, false);
    for (const f of v.fleets) { assert.equal('lastContacts' in f, false); if (f.preparing) assert.equal(f.owner, owner); }
    assert.ok(v.scheduled.every(p => p.owner === owner));
    assert.deepEqual(v.events, game.events.filter(e => e.audience?.includes(owner)).slice(0, v.events.length).map(e => ({ hour: e.hour, message: e.message })));
  }
}

for (const mode of ['mining', 'domination'] as const) for (const seed of [7, 8]) {
  test(`contested ${mode}: three independent seats, seed ${seed}`, { timeout: 30_000 }, () => {
    const baseline = createConfiguredGame({ playerCount: 3, mode, driftingBases: false }, 0, seed);
    const original = structuredClone(baseline);
    const retained = createArchive(baseline, { rivals: false });
    const players = baseline.rules!.players;
    const memories = new Map(players.map(p => [p, { held: new Set<string>(), lost: new Set<string>() }]));
    const entries: ReplayEntry[] = [];
    const metrics = { combat: 0, turnover: 0, recaptures: 0, expansion: new Set<Faction>(), attackers: new Set<Faction>(), reactions: new Set<Faction>() };
    const history = new Map(baseline.rocks.map(r => [r.id, new Set(r.owner ? [r.owner] : [])]));
    let previous = baseline;
    // Unredacted traces are assertion-only. No metric or snapshot reaches decide.
    const trace: SimulationTraceSink = record => {
      const next = record.type === 'point' ? record.game : record.to;
      if (record.type === 'point' && record.phase === 'arrival') {
        const arrivals = previous.fleets.filter(f => !next.fleets.some(n => n.id === f.id));
        for (const f of arrivals) {
          const before = previous.rocks.find(r => r.id === f.to)!;
          if (before.owner && before.owner !== f.owner && before.drones > 0 && f.drones > 0) {
            metrics.combat++; metrics.attackers.add(f.owner);
          }
        }
      }
      for (const r of next.rocks) {
        const before = previous.rocks.find(b => b.id === r.id)!;
        if (r.owner && r.owner !== before.owner) {
          if (before.owner) {
            metrics.turnover++;
            if (history.get(r.id)!.has(r.owner)) metrics.recaptures++;
          } else metrics.expansion.add(r.owner);
          history.get(r.id)!.add(r.owner);
        }
      }
      previous = next;
    };
    let game = baseline;
    inspect(game);
    for (let round = 0; round < 270 && !game.winner && !game.draw; round++) {
      for (const owner of players) {
        const memory = memories.get(owner)!;
        const view = structuredClone(observe(game, owner));
        const commands = decide(view, owner, memory);
        for (const command of commands) {
          if (command.type === 'dispatch' && memory.lost.has(command.to)) metrics.reactions.add(owner);
          game = executeCommand(game, command);
          entries.push({ hour: game.hour, command });
        }
      }
      previous = game;
      const hour = game.hour;
      game = advance(game, hour + 8, trace);
      assert.ok(game.hour > hour, 'round must advance');
      inspect(game);
    }
    const summary = { mode, seed, hour: game.hour, winner: game.winner, cargo: game.cargo, eliminated: game.eliminated, territory: game.rocks.filter(r => r.owner === game.winner).length, combat: metrics.combat, turnover: metrics.turnover, recaptures: metrics.recaptures, expansion: [...metrics.expansion], attackers: [...metrics.attackers], reactions: [...metrics.reactions], commands: entries.length };
    console.log(JSON.stringify(summary));
    assert.ok(game.winner && !game.draw, `no rule-based winner: ${JSON.stringify(summary)}`);
    assert.ok(metrics.combat >= 3 && metrics.turnover >= 2 && metrics.recaptures >= 1, `insufficient contest: ${JSON.stringify(summary)}`);
    assert.deepEqual([...metrics.expansion].sort(), [...players].sort());
    assert.deepEqual([...metrics.attackers].sort(), [...players].sort());
    assert.deepEqual([...metrics.reactions].sort(), [...players].sort(), 'every seat must counterattack after observing a loss');
    const quota = mode === 'mining' ? game.cargo[game.winner]! : game.rocks.filter(r => r.owner === game.winner).length;
    assert.equal(game.rules!.victoryTarget, mode === 'mining' ? 200 : 15);
    assert.ok(quota >= game.rules!.victoryTarget, 'the configured victory quota must establish victory');
    assert.deepEqual(baseline, original);
    assert.deepEqual(exportArchive(retained).entries, []);
    const data = { ...exportArchive(retained), entries };
    const archive = restoreArchive(data);
    const options = { rivals: false, knownThrough: game.hour };
    // Canonical replay exposes a callback within every advance, including stalled events.
    const reconstruct = (a: typeof archive, end: number) => {
      let events = 0;
      return traceReplayTo(a, end, { ...options, knownThrough: end }, r => {
        if (r.type === 'point' && r.phase === 'advance:initial') events = 0;
        assert.ok(++events <= EVENT_BUDGET * 20, 'canonical replay event budget exceeded');
      });
    };
    assert.deepEqual(reconstruct(archive, game.hour), game);
    for (const fraction of [0, 0.371]) {
      let rebuilt = baseline;
      const move = (hour: number) => {
        if (fraction && hour > rebuilt.hour) rebuilt = advance(rebuilt, rebuilt.hour + (hour - rebuilt.hour) * fraction);
        if (hour > rebuilt.hour) rebuilt = advance(rebuilt, hour);
      };
      for (const e of entries) { move(e.hour); rebuilt = executeCommand(rebuilt, e.command); }
      move(game.hour);
      assert.deepEqual(rebuilt, game);
    }
    const saved = decodeSave(JSON.stringify({ savedAt: 0, game, replay: data }));
    assert.deepEqual(saved.game, game);
    assert.deepEqual(saved.replay, JSON.parse(JSON.stringify(data)));
    assert.deepEqual(reconstruct(restoreArchive(saved.replay!), game.hour), game);
    const damaged = structuredClone(saved);
    damaged.game.rocks[0]!.drones = -1;
    assert.throws(() => decodeSave(JSON.stringify(damaged)));
    assert.deepEqual(advance(game, game.hour + 100), game);
    assert.deepEqual(reconstruct(archive, game.hour + 100), game);
  });
}
