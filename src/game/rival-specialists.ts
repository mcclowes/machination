/**
 * ---
 * purpose: Policy-two rival specialist use: recruitment priorities, per-target task forces, and positioning stationed passives.
 * related:
 *   - ./rival-ai.ts - decision order and policy selection
 *   - ./rival-tactics.ts - forecasts and troop movements that carry task forces
 * ---
 */
import { dispatch, type Faction, type Game, type Rock } from './simulation';
import { allied } from './teams';
import { hasReserves } from './depletion';
import { worldDistance } from './geometry';
import { maximumShield } from './economy';
import { rockSensorRange } from './sensors';
import { pulseConfig } from './pulse';
import { victoryTarget } from './rules';
import { recruitmentCost, type Specialist } from './specialists';
import type { SpecialistKind } from './specialist-catalog';
import { byId, ownedSites, ownsKing, RIVAL_LOOKAHEAD, siteValue, surplus, type RivalForecast } from './rival-tactics';

const live = (rock: Rock, owner: Faction | null | undefined): Specialist[] => (rock.specialists ?? []).filter(u => u.owner === owner && !u.captive);
const has = (units: readonly Specialist[], kind: SpecialistKind) => units.some(u => u.kind === kind);

/** Every offer except the self-destruct charge scores above zero, so poor offer sets are spent and redrawn rather than hoarded. */
export function hireScore(game: Game, kind: SpecialistKind, capacityTight: boolean): number {
  const scores: Partial<Record<SpecialistKind, number>> = {
    foreman: 100, lieutenant: 90, inspector: 80, warHero: 75, thief: 75, smuggler: 70, infiltrator: 65, assassin: 60,
    helmsman: 50, elder: 45, navigator: 40, intelligence: 35, saboteur: 25, doubleAgent: 25,
    pirate: 20, diplomat: 20, hypnotist: 20, tinkerer: capacityTight ? 110 : 15, princess: game.pulse ? 1 : 30, disruptor: 1,
  };
  return scores[kind] ?? 0;
}
export function reservesForVictory(game: Game, owner: Faction): boolean {
  const cargo = game.cargo[owner] ?? 0;
  return cargo < recruitmentCost(game) || game.rules?.mode === 'mining' && cargo >= victoryTarget(game) - 15
    || !!game.pulse && cargo >= pulseConfig(game).activationResourceCost * 0.8;
}

const ATTACKERS = new Set<SpecialistKind>(['thief', 'lieutenant', 'warHero']);
const ESCORTS = new Set<SpecialistKind>(['helmsman', 'engineer']);
/** Carries only the units that change this fight; keeps couriers and navigators home and avoids self-suppression by an arbiter. */
export function taskForce(source: Rock, target: Rock, owner: Faction): Specialist[] {
  const units = live(source, owner);
  const defenders = target.owner ? live(target, target.owner) : [];
  if (has(defenders, 'assassin') || has(defenders, 'martyr')) return [];
  const shielded = !!target.owner && !target.shieldsDisabled && (target.shield ?? 0) > 0;
  const force = units.filter(u => ATTACKERS.has(u.kind) || ESCORTS.has(u.kind)
    || u.kind === 'infiltrator' && shielded || u.kind === 'assassin' && defenders.length > 0);
  const theirAbilities = defenders.some(u => ATTACKERS.has(u.kind) || u.kind === 'assassin' || u.kind === 'inspector');
  const ourAbilities = force.some(u => ATTACKERS.has(u.kind) || u.kind === 'infiltrator' || u.kind === 'assassin');
  const arbiter = units.find(u => u.kind === 'elder');
  return arbiter && (has(defenders, 'elder') ? ourAbilities : theirAbilities && !ourAbilities) ? [...force, arbiter] : force;
}

type Placement = { unit: Specialist; from: Rock; to: Rock };
function enemyDistance(game: Game, owner: Faction): (rock: Rock) => number {
  const enemies = game.rocks.filter(r => !r.destroyed && r.owner && !allied(game, owner, r.owner));
  return rock => Math.min(1000, ...enemies.map(e => worldDistance(game, rock, e)));
}
function factoriesCovered(game: Game, sites: readonly Rock[], hub: Rock): number {
  return sites.filter(r => r.kind === 'factory' && hasReserves(r) && worldDistance(game, hub, r) <= rockSensorRange(game, hub) / 2).length;
}
function placements(game: Game, owner: Faction): Placement[] {
  const sites = ownedSites(game, owner);
  const hostileBound = new Set(game.fleets.filter(f => f.owner !== owner && f.giftAt === undefined).map(f => f.to));
  const safe = sites.filter(r => !hostileBound.has(r.id));
  const king = sites.find(r => ownsKing(r, owner));
  const distance = enemyDistance(game, owner);
  const front = [...safe].filter(r => siteValue(game, r, owner) > 0).sort((a, b) => distance(a) - distance(b) || b.drones - a.drones || byId(a, b))[0];
  const best = (score: (r: Rock) => number) => [...safe].sort((a, b) => score(b) - score(a) || byId(a, b))[0];
  const result: Placement[] = [];
  for (const from of safe) for (const unit of live(from, owner)) {
    let to: Rock | undefined;
    if (unit.kind === 'foreman') {
      const hub = best(r => factoriesCovered(game, sites, r));
      if (hub && factoriesCovered(game, sites, hub) > factoriesCovered(game, sites, from)) to = hub;
    } else if (unit.kind === 'tycoon') {
      const productive = (r: Rock) => r.kind === 'factory' && hasReserves(r);
      const refuge = productive(from) ? undefined : best(r => productive(r) ? distance(r) : -1);
      if (refuge && productive(refuge)) to = refuge;
    } else if (unit.kind === 'tinkerer') {
      const hub = best(r => maximumShield(r));
      if (hub && maximumShield(hub) > maximumShield(from) + 5) to = hub;
    } else if (unit.kind === 'inspector' || unit.kind === 'security') {
      if (king && !ownsKing(from, owner) && !hostileBound.has(king.id)) to = king;
    } else if (unit.kind === 'sentry') {
      if (front && distance(front) + 10 < distance(from)) to = front;
    } else if (ATTACKERS.has(unit.kind) || unit.kind === 'assassin' || unit.kind === 'infiltrator') {
      // Strike units idle where no attack can launch; stage them where surplus troops gather.
      if (front && surplus(game, from, owner) < 10 && distance(front) + 5 < distance(from)) to = front;
    }
    if (to && to.id !== from.id) result.push({ unit, from, to });
  }
  const priority: Partial<Record<SpecialistKind, number>> = { foreman: 5, tycoon: 5, tinkerer: 4, inspector: 3, security: 3, sentry: 2 };
  return result.sort((a, b) => (priority[b.unit.kind] ?? 1) - (priority[a.unit.kind] ?? 1) || byId(a.unit, b.unit));
}

/** At most one unescorted transfer per decision, committed only if the forecast shows the unit arriving under our control. */
export function positionSpecialists(input: Game, owner: Faction, forecast: RivalForecast): Game {
  for (const { unit, from, to } of placements(input, owner).slice(0, 2)) {
    const sent = dispatch(input, from.id, to.id, 0, owner, false, [unit.id]);
    const arrival = sent.fleets.at(-1)!.arrives;
    if (arrival > input.hour + RIVAL_LOOKAHEAD) continue;
    const future = forecast(sent, arrival);
    if (future?.rocks.some(r => r.id === to.id && r.owner === owner && live(r, owner).some(u => u.id === unit.id))) return sent;
  }
  return input;
}
