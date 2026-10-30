/**
 * ---
 * purpose: Reconcile movable leadership and local/global shield effects after specialist changes.
 * ---
 */
import { temporalEnabled } from './temporal';
import { refreshTemporalProduction } from './temporal-facilities';
import { dilationFields, dilationMultiplier } from './temporal-travel';
import { compactTransitMultiplier, type CompactWorld } from './compact';
import { withPulseMovement } from './pulse';
import { afterWork, workBetween } from './opening-clock';
import { stationCourse } from './drift';
import { mechanicsVersion, type GameRules } from './rules';
import { nearestImage, wrappedBounds } from './geometry';
import { fleetPosition, flightEndpoints, flightDeparture, remainingFlightRoute } from './flight';
import { applyStationPassives } from './specialist-actions';
import type { Faction, Game } from './simulation';
import type { Specialist, UnitWorld } from './specialists';
import { activeUnits, cloneUnits, unitCount } from './specialists';
import { maximumShield } from './economy';

export function refreshUnitEffects(game: Game, preserveDueClocks = false): void {
  if (game.version !== 2) return;
  const counts = new Map<string, number>();
  for (const unit of activeUnits(game)) {
    const key = `${unit.owner}:${unit.kind}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const count = (owner: Faction, kind: Specialist['kind']) => counts.get(`${owner}:${kind}`) ?? 0;
  const stationed = new Map(game.rocks.map(r => [r.id, (r.specialists ?? []).filter(u => !u.captive)]));
  for (const fleet of game.fleets) if (fleet.preparing) stationed.get(fleet.from)?.push(...(fleet.specialists ?? []).filter(u => !u.captive));
  for (const rock of game.rocks) {
    if (rock.owner && rock.kind === 'factory') {
      const interval = 8 / (1 + 0.5 * count(rock.owner, 'tycoon')) / (rock.overclock && !rock.overclock.repaying ? 2 : 1);
      refreshTemporalProduction(game, rock, interval);
    }
    const units = stationed.get(rock.id)!;
    for (const unit of units) if ((unit.kind === 'sentry' || unit.kind === 'tinkerer') && (unit.nextActionAt === undefined || !preserveDueClocks && unit.nextActionAt <= game.hour)) unit.nextActionAt = game.hour + (unit.kind === 'sentry' ? 2 : 1 / 3);
    const oldMax = maximumShield(rock);
    const core = units.find(u => u.kind === 'queen' && u.owner === rock.owner);
    if (core) rock.coreOf = core.owner; else delete rock.coreOf;
    rock.shieldBonus = rock.owner ? 10 * count(rock.owner, 'security') + 10 * units.filter(u => u.owner === rock.owner && u.kind === 'security').length - 20 * count(rock.owner, 'king') : 0;
    const max = maximumShield(rock);
    rock.shield = Math.min(rock.shield ?? 0, max);
    if (rock.owner && (max !== oldMax || (rock.shieldAt === undefined || !preserveDueClocks && rock.shieldAt <= game.hour) && rock.shield! < max)) rock.shieldAt = afterWork(game, Math.max(game.hour, rock.stasisUntil ?? 0), max > 0 ? 48 / max : 48);
  }
  const temporalFields = dilationFields(game);
  for (const fleet of game.fleets) {
    if (fleet.pendingCourse && (fleet.pendingCourse.owner !== fleet.owner || game.eliminated.includes(fleet.owner) || fleet.courseLocked || !(fleet.specialists ?? []).some(u => u.kind === 'navigator' && u.owner === fleet.owner && !u.captive))) delete fleet.pendingCourse;
    if (fleet.heldAt || fleet.intercept && !temporalEnabled(game)) continue;
    const target = game.rocks.find(r => r.id === fleet.to);
    const speed = specialistSpeed(game, fleet.owner, fleet.specialists ?? [], target?.owner === fleet.owner, fleet.intercept ? 'intercept' : fleet.interceptionReturn ? 'interception-return' : fleet.returning ? 'return' : undefined, fleet.thrust ?? 1) * dilationMultiplier(game, fleet, temporalFields);
    if (fleet.speed === speed) continue;
    if (fleet.route?.course) {
      const remaining = workBetween(game, Math.max(game.hour, flightDeparture(fleet)), fleet.arrives);
      if (!fleet.preparing) { fleet.route = remainingFlightRoute(game, fleet); fleet.departed = game.hour; }
      fleet.arrives = afterWork(game, flightDeparture(fleet), Math.max(1e-6, remaining * (fleet.speed ?? speed) / speed));
      fleet.speed = speed;
      continue;
    }
    const point = fleet.preparing ? flightEndpoints(game, fleet).from : fleetPosition(game, fleet);
    const endpoint = wrappedBounds(game) ? nearestImage(game, point, flightEndpoints(game, fleet).to) : flightEndpoints(game, fleet).to;
    if (!fleet.preparing) { fleet.route = { from: point, to: { ...endpoint } }; fleet.departed = game.hour; }
    fleet.arrives = afterWork(game, flightDeparture(fleet), Math.max(1e-6, Math.hypot(endpoint.x - point.x, endpoint.y - point.y) / speed));
    if (!fleet.intercept && (target?.drift || fleet.preparing && game.rocks.find(r => r.id === fleet.from)?.drift)) {
      const source = fleet.preparing ? game.rocks.find(r => r.id === fleet.from)! : point;
      Object.assign(fleet, stationCourse(game, source, target!, speed, flightDeparture(fleet)));
    }
    fleet.speed = speed;
  }
}
export function withUnitEffects(game: Game): Game {
  const result = { ...game, rocks: game.rocks.map(cloneUnits), fleets: game.fleets.map(cloneUnits) };
  refreshUnitEffects(result);
  applyStationPassives(result);
  refreshUnitEffects(result);
  return withPulseMovement(result);
}
export function specialistSpeed(game: UnitWorld & { rules?: Pick<GameRules, 'mechanicsVersion'> } & CompactWorld, owner: Faction, units: readonly Specialist[], friendly: boolean, mission?: 'intercept' | 'return' | 'interception-return', thrust = compactTransitMultiplier(game)): number {
  const kinds = new Set(units.filter(u => u.owner === owner && !u.captive).map(u => u.kind));
  return 8 * thrust * Math.max(1, (mission === 'interception-return' || mission === 'return' && mechanicsVersion(game) < 3) && kinds.has('pirate') ? 4 : 1, mission === 'intercept' && kinds.has('pirate') ? 2 : 1,
    kinds.has('helmsman') ? 2 : 1, friendly && kinds.has('smuggler') ? 3 : 1,
    kinds.has('lieutenant') || kinds.has('general') || kinds.has('admiral') || units.length === 0 && unitCount(game, owner, 'admiral') > 0 ? 1.5 : 1);
}
