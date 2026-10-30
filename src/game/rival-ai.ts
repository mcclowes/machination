/**
 * ---
 * purpose: Version-one strategic rival policy: survival, victory investment, recruitment, and bounded military decisions.
 * related:
 *   - ./rival-tactics.ts - authoritative combat forecasts and troop movements
 *   - ./rival-ai.test.ts - adversarial decisions and persistence invariants
 * ---
 */
import type { Faction, Game } from './simulation';
import { ALL_PLAYERS, playersIn } from './players';
import { tracePoint, type SimulationTraceSink } from './simulation-trace';
import { commandPulse, pulseConfig } from './pulse';
import { drillMine, mineCost, minesAllowed, droneInventory, powerCapacity } from './economy';
import { hireSpecialist, promoteSpecialist, recruitmentCost, recruitmentStatus, unitCount } from './specialists';
import { promotion, type SpecialistKind } from './specialist-catalog';
import { victoryTarget } from './rules';
import { worldDistance } from './geometry';
import { attackSites, byId, defendSites, createRivalForecast, type RivalForecast, ownsKing, ownedSites, reinforceFront, reserve, RIVAL_LOOKAHEAD } from './rival-tactics';

export const RIVAL_DECISION_INTERVAL = 3;
export type RivalStyle = 'conqueror' | 'expansionist' | 'industrialist';
export function rivalStyle(owner: Faction): RivalStyle { return (['conqueror', 'expansionist', 'industrialist'] as const)[ALL_PLAYERS.indexOf(owner) % 3]!; }

export function actStrategicRivals(input: Game, trace?: SimulationTraceSink): Game {
  if (input.winner || input.draw || input.version !== 2) return input;
  let game = input;
  for (const owner of playersIn(input).filter(f => f !== 'you')) {
    if (game.eliminated.includes(owner)) continue;
    game = actStrategicPlayer(game, owner);
    tracePoint(trace, 'rival', game);
  }
  return game;
}
export function actStrategicPlayer(input: Game, owner: Faction): Game {
  if (input.winner || input.draw || input.version !== 2 || input.eliminated.includes(owner) || !playersIn(input).includes(owner)) return input;
  const forecast = createRivalForecast(input);
  let game = defendSites(input, owner, forecast);
  game = pursuePulse(game, owner);
  game = recruit(game, owner);
  const investment = invest(game, owner, forecast);
  game = attackSites(investment.game, owner, forecast, investment.savingAt);
  return reinforceFront(game, owner, forecast, investment.savingAt);
}

function pursuePulse(game: Game, owner: Faction): Game {
  const king = game.pulse?.kings.find(k => k.factionId === owner);
  const action = king?.state === 'ready' ? 'FIRE_PULSE' : king?.state === 'idle' && (game.cargo[owner] ?? 0) >= pulseConfig(game).activationResourceCost ? 'START_CHARGE' : undefined;
  if (!action) return game;
  return commandPulse(game, owner, { action, id: `rival-v1-${owner}-${Math.round(game.hour * 1e6)}-${action.replaceAll('_', '-')}` });
}
function recruit(game: Game, owner: Faction): Game {
  const status = recruitmentStatus(game, owner);
  if (!status.credits || !status.at) return game;
  const capacityTight = powerCapacity(game, owner) - droneInventory(game, owner) < 30;
  const promotable = ownedSites(game, owner).flatMap(r => (r.specialists ?? []).filter(u => u.owner === owner && !u.captive).map(unit => ({ unit, kind: promotion(unit.kind) })))
    .map(p => ({ ...p, score: p.kind === 'tycoon' ? 120 : p.kind === 'general' ? 100 : p.kind === 'energy' && capacityTight ? 130 : p.kind === 'security' ? 80 : p.kind === 'admiral' ? 70 : 0 }))
    .filter(p => p.kind && unitCount(game, owner, p.kind) < (p.kind === 'tycoon' || p.kind === 'general' ? 2 : 1))
    .sort((a, b) => b.score - a.score || byId(a.unit, b.unit))[0];
  if (promotable && promotable.score >= 70) return promoteSpecialist(game, owner, promotable.unit.id);
  const cargo = game.cargo[owner] ?? 0;
  if (cargo < recruitmentCost(game) || game.rules?.mode === 'mining' && cargo >= victoryTarget(game) - 15) return game;
  // Do not repeatedly spend the last material needed to start a King's charge.
  if (game.pulse && cargo >= pulseConfig(game).activationResourceCost * 0.8) return game;
  const scores: Partial<Record<SpecialistKind, number>> = {
    smuggler: 100, foreman: 95, lieutenant: 90, inspector: 80, tinkerer: capacityTight ? 110 : 15,
    thief: 65, infiltrator: 65, warHero: 65, assassin: 60, elder: 55, navigator: 55, helmsman: 50,
    engineer: 50, princess: game.pulse ? 0 : 30, sentry: 50,
  };
  const kind = [...status.offers].sort((a, b) => (scores[b] ?? 0) / (1 + unitCount(game, owner, b)) - (scores[a] ?? 0) / (1 + unitCount(game, owner, a)) || (a < b ? -1 : a > b ? 1 : 0))[0];
  return kind && (scores[kind] ?? 0) > 0 ? hireSpecialist(game, owner, kind) : game;
}
function invest(game: Game, owner: Faction, forecast: RivalForecast): { game: Game; savingAt?: string } {
  const sites = ownedSites(game, owner);
  const mines = sites.filter(r => r.kind === 'mine' && !r.pulseDisabled).length;
  const desired = Math.min(3, Math.max(1, Math.floor(sites.length / (rivalStyle(owner) === 'industrialist' ? 3 : 4))));
  if (!minesAllowed(game) || game.rules?.mode === 'domination' || mines >= desired) return { game };
  const enemies = game.rocks.filter(r => !r.destroyed && r.owner && r.owner !== owner);
  const distance = (r: typeof sites[number]) => Math.min(100, ...enemies.map(e => worldDistance(game, r, e)));
  const candidates = sites.filter(r => r.kind !== 'mine' && !ownsKing(r, owner)
    && sites.filter(s => s.kind === r.kind).length > (r.kind === 'factory' ? 2 : 1)
    && !game.fleets.some(f => f.owner !== owner && f.to === r.id && f.giftAt === undefined))
    .sort((a, b) => (b.drones + distance(b) + (b.kind === 'generator' ? 30 : 0)) - (a.drones + distance(a) + (a.kind === 'generator' ? 30 : 0)) || byId(a, b));
  const site = candidates[0];
  if (!site) return { game };
  const cost = mineCost(game, owner);
  if (site.drones - cost < reserve(game, site, owner)) return { game, savingAt: site.id };
  const built = drillMine(game, site.id, owner);
  if (forecast(built, built.hour + RIVAL_LOOKAHEAD)?.rocks.some(r => r.id === site.id && r.kind === 'mine' && !r.destroyed && r.owner === owner)) return { game: built };
  return { game };
}
