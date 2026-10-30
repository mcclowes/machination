/** Head-to-head policy comparison: node --import tsx scripts/compare-rival-policies.ts [games=6] [hours=240] [players=4] [firstSeed=1] */
import assert from 'node:assert/strict';
import { advance } from '../src/game/simulation';
import { createConfiguredGame } from '../src/game/world';
import { actStrategicPlayer, RIVAL_DECISION_INTERVAL } from '../src/game/rival-ai';
import { playersIn } from '../src/game/players';
import { actSimultaneously } from '../src/game/rival-orders';
import { activeUnits } from '../src/game/specialists';
import type { RivalPolicy } from '../src/game/rival-policy';

const [games = 6, hours = 240, count = 4, firstSeed = 1] = process.argv.slice(2).map(Number);
assert.ok(Number.isInteger(count) && count >= 2 && count % 2 === 0, 'Use an even player count so seats split evenly.');
const tally = { 1: { wins: 0, sites: 0, units: 0 }, 2: { wins: 0, sites: 0, units: 0 } };
for (let index = 0; index < games; index++) {
  const seed = firstSeed + index;
  const mode = (['domination', 'mining', 'pulse'] as const)[index % 3]!;
  let game = createConfiguredGame({ playerCount: count, mode, driftingBases: true }, 0, seed);
  // Alternate seat assignment by game so neither policy keeps the same starting positions.
  const policyOf = new Map(playersIn(game).map((owner, seat) => [owner, ((seat + index) % 2 ? 2 : 1) as RivalPolicy]));
  for (let hour = RIVAL_DECISION_INTERVAL; hour <= hours && !game.winner && !game.draw; hour += RIVAL_DECISION_INTERVAL) {
    game = advance(game, hour, { rivals: false });
    game = actSimultaneously(game, playersIn(game).filter(f => !game.eliminated.includes(f)), (snapshot, owner) => actStrategicPlayer(snapshot, owner, policyOf.get(owner)!));
  }
  if (game.winner) tally[policyOf.get(game.winner)!].wins++;
  for (const [owner, policy] of policyOf) {
    tally[policy].sites += game.rocks.filter(r => r.owner === owner && !r.destroyed).length;
    tally[policy].units += activeUnits(game, owner).length;
  }
  console.log(JSON.stringify({ seed, mode, hour: game.hour, winner: game.winner && `${game.winner} (policy ${policyOf.get(game.winner)})`, eliminated: game.eliminated.map(f => `${f} (policy ${policyOf.get(f)})`) }));
}
console.log(JSON.stringify({ games, hours, players: count, policy1: tally[1], policy2: tally[2] }));
