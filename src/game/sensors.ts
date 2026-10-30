/**
 * ---
 * purpose: Shared geometric sensor policy for authoritative observations and event audiences.
 * ---
 */
import { waiverActive } from './compact';
import { allied } from './teams';
import { sitePosition, type Drift } from './drift';
import { worldDistance, type GeometryWorld } from './geometry';
import { playersIn } from './players';
import { unitCount, unitsAtRock } from './specialists';
import { fleetPosition } from './flight';
import type { Faction, Fleet, Game } from './simulation';
export const ROCK_SENSOR_RANGE = 32;
export const HAULER_SENSOR_RANGE = 16;
export type Sensor = { x: number; y: number; radius: number; drift?: Drift };
export function rockSensorRange(game: Game, rock: Game['rocks'][number]): number {
  if (game.version !== 2 || !rock.owner) return ROCK_SENSOR_RANGE;
  return (waiverActive(game, 'sensors') ? 1.5 : 1) * ((rock.sensorJammedUntil ?? 0) > game.hour ? .5 : 1) * ROCK_SENSOR_RANGE * (1 + 0.25 * unitCount(game, rock.owner, 'intelligence') + 0.5 * unitsAtRock(game, rock.id).filter(u => u.owner === rock.owner && u.kind === 'princess').length);
}
export function sensors(game: Game, faction: Faction): Sensor[] {
  return [
    ...game.rocks.filter(r => r.owner && allied(game, faction, r.owner)).map(r => ({ ...sitePosition(game, r, game.hour), ...(r.drift ? { drift: r.drift } : {}), radius: rockSensorRange(game, r) })),
    ...(game.version === 2 ? [] : game.fleets.filter(f => allied(game, faction, f.owner)).map(f => ({ ...fleetPosition(game, f), radius: HAULER_SENSOR_RANGE }))),
  ];
}
export function inRange(coverage: Sensor[], point: { x: number; y: number }, world: GeometryWorld = {}): boolean {
  return coverage.some(s => worldDistance(world, s, point) <= s.radius);
}
export function canObserveHauler(game: Game, faction: Faction, fleet: Fleet, coverage = sensors(game, faction)): boolean {
  if (allied(game, faction, fleet.owner)) return true;
  if (fleet.preparing) return false;
  const incoming = game.version === 2 && (fleet.intercept
    ? game.fleets.some(target => target.id === fleet.intercept!.target && allied(game, faction, target.owner))
    : game.rocks.some(rock => rock.id === fleet.to && rock.owner && allied(game, faction, rock.owner)));
  return incoming || inRange(coverage, fleetPosition(game, fleet), game);
}
export function observers(game: Game, point: { x: number; y: number }): Faction[] {
  return (playersIn(game)).filter(f => inRange(sensors(game, f), point, game));
}
