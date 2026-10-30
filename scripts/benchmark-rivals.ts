/** Deterministic solo soak: node --import tsx scripts/benchmark-rivals.ts [hours=168] [players=3] [seed=42] */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { advance } from '../src/game/simulation';
import { createConfiguredGame } from '../src/game/world';
import { decodeSave } from '../src/game/save-format';
import { actStrategicPlayer, RIVAL_DECISION_INTERVAL } from '../src/game/rival-ai';
import { playersIn } from '../src/game/players';

const [hours = 168, count = 3, seed = 42] = process.argv.slice(2).map(Number);
assert.ok(Number.isFinite(hours) && hours > 0 && hours <= 2000);
assert.ok(Number.isInteger(count) && count >= 2 && count <= 10);
assert.ok(Number.isSafeInteger(seed) && seed >= 0 && seed < 2 ** 32);
for (const mode of (process.argv[5] ? [process.argv[5]] : ['pulse', 'mining', 'domination']) as ('pulse' | 'mining' | 'domination')[]) {
  const initial = createConfiguredGame({ playerCount: count, mode, driftingBases: true }, 0, seed);
  const started = performance.now();
  let game = initial;
  for (let hour = RIVAL_DECISION_INTERVAL; hour <= hours + RIVAL_DECISION_INTERVAL && !game.winner && !game.draw; hour += RIVAL_DECISION_INTERVAL) {
    game = advance(game, Math.min(hour, hours), { rivals: false });
    if (hour <= hours) for (const owner of playersIn(game)) game = actStrategicPlayer(game, owner);
    if (game.hour >= hours) break;
  }
  assert.ok([...game.rocks, ...game.fleets].every(a => Number.isFinite(a.drones) && a.drones >= 0));
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game })).game, game);
  assert.equal(initial.fleets.length, 0);
  assert.equal(initial.hour, 0);
  console.log(JSON.stringify({ mode, players: count, seed, targetHour: hours, hour: game.hour, milliseconds: Math.round(performance.now() - started), winner: game.winner, eliminated: game.eliminated,
    rivals: playersIn(game).filter(f => f !== 'you').map(owner => ({ owner, sites: game.rocks.filter(r => r.owner === owner && !r.destroyed).length, mines: game.rocks.filter(r => r.owner === owner && r.kind === 'mine' && !r.destroyed).length, cargo: game.cargo[owner], recruits: game.recruitment?.[owner]?.used, pulse: game.pulse?.kings.find(k => k.factionId === owner)?.state })) }));
}
