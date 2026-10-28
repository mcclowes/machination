/**
 * ---
 * purpose: Shared geometric sensor policy for authoritative observations and event audiences.
 * ---
 */
import { playersIn } from './players';
import { unitCount, unitsAtRock } from './specialists';
import { fleetPosition } from './flight';
import type { Faction, Fleet, Game } from './simulation';
export const ROCK_SENSOR_RANGE = 32;
export const HAULER_SENSOR_RANGE = 16;
export type Sensor = { x: number; y: number; radius: number };
export function rockSensorRange(game: Game, rock: Game['rocks'][number]): number {
  if (game.version !== 2 || !rock.owner) return ROCK_SENSOR_RANGE;
  return ROCK_SENSOR_RANGE * (1 + 0.25 * unitCount(game, rock.owner, 'intelligence') + 0.5 * unitsAtRock(game, rock.id).filter(u => u.owner === rock.owner && u.kind === 'princess').length);
}
export function sensors(game: Game, faction: Faction): Sensor[] {
  return [
    ...game.rocks.filter(r => r.owner === faction).map(r => ({ x: r.x, y: r.y, radius: rockSensorRange(game, r) })),
    ...(game.version === 2 ? [] : game.fleets.filter(f => f.owner === faction).map(f => ({ ...fleetPosition(game, f), radius: HAULER_SENSOR_RANGE }))),
  ];
}
export function inRange(coverage: Sensor[], point: { x: number; y: number }): boolean {
  return coverage.some(s => Math.hypot(s.x - point.x, s.y - point.y) <= s.radius);
}
export function canObserveHauler(game: Game, faction: Faction, fleet: Fleet, coverage = sensors(game, faction)): boolean {
  if (fleet.owner === faction) return true;
  if (fleet.preparing) return false;
  const incoming = game.version === 2 && (fleet.intercept
    ? game.fleets.some(target => target.id === fleet.intercept!.target && target.owner === faction)
    : game.rocks.some(rock => rock.id === fleet.to && rock.owner === faction));
  return incoming || inRange(coverage, fleetPosition(game, fleet));
}
export function observers(game: Game, point: { x: number; y: number }): Faction[] {
  return (playersIn(game)).filter(f => inRange(sensors(game, f), point));
}
