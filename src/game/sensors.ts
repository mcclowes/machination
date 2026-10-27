/**
 * ---
 * purpose: Shared geometric sensor policy for authoritative observations and event audiences.
 * ---
 */
import type { Faction, Fleet, Game } from './simulation';
export const ROCK_SENSOR_RANGE = 32;
export const HAULER_SENSOR_RANGE = 16;
export type Sensor = { x: number; y: number; radius: number };
export function fleetPosition(game: Pick<Game, 'rocks' | 'hour'>, fleet: Fleet): { x: number; y: number } {
  const from = game.rocks.find(r => r.id === fleet.from)!;
  const to = game.rocks.find(r => r.id === fleet.to)!;
  const progress = Math.max(0, Math.min(1, (game.hour - fleet.departed) / (fleet.arrives - fleet.departed)));
  return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
}
export function sensors(game: Game, faction: Faction): Sensor[] {
  return [
    ...game.rocks.filter(r => r.owner === faction).map(r => ({ x: r.x, y: r.y, radius: ROCK_SENSOR_RANGE })),
    ...game.fleets.filter(f => f.owner === faction).map(f => ({ ...fleetPosition(game, f), radius: HAULER_SENSOR_RANGE })),
  ];
}
export function inRange(coverage: Sensor[], point: { x: number; y: number }): boolean {
  return coverage.some(s => Math.hypot(s.x - point.x, s.y - point.y) <= s.radius);
}
export function observers(game: Game, point: { x: number; y: number }): Faction[] {
  return (['you', 'vesper', 'null'] as const).filter(f => inRange(sensors(game, f), point));
}
