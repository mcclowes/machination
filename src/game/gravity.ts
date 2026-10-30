/**
 * ---
 * purpose: Versioned gravity variant, public well placement, and frozen launch courses.
 * ---
 */
import { DEFAULT_TUNING, placeGiants, plotCourse, type Well } from './gravity-model';
import { wrapPoint, type GeometryWorld, type Point } from './geometry';
import { afterWork } from './opening-clock';
import { MAX_COURSE_POINTS, type FlightRoute } from './flight-route';
export type GravityConfig = { wells: Well[] };
export type GravityWorld = GeometryWorld & { rules?: { gravity?: GravityConfig } };
export const gravityEnabled = (world: GravityWorld): boolean => (world.rules?.mechanicsVersion ?? 1) >= 19 && !!world.rules?.gravity;
export function validGravity(value: unknown, world: GeometryWorld, players: readonly string[]): value is GravityConfig {
  const g = value as GravityConfig | undefined, map = world.rules?.map;
  return !!map && map.topology === 'torus' && !!g && typeof g === 'object' && !Array.isArray(g) && Object.keys(g).length === 1 && Array.isArray(g.wells) && g.wells.length > 0 && g.wells.length <= 12
    && new Set(g.wells.map(w => w?.id)).size === g.wells.length
    && g.wells.every(w => !!w && typeof w === 'object' && !Array.isArray(w) && Object.keys(w).every(k => ['id', 'x', 'y', 'mass', 'radius', 'owner'].includes(k)) && typeof w.id === 'string' && w.id.length > 0 && w.id.length <= 64 && Number.isFinite(w.x) && w.x >= 0 && w.x < map.width && Number.isFinite(w.y) && w.y >= 0 && w.y < map.height && Number.isFinite(w.mass) && Math.abs(w.mass) > 0 && Math.abs(w.mass) <= 3 && Number.isFinite(w.radius) && w.radius > 0 && w.radius <= 5 && (w.owner === undefined || w.owner === null || players.includes(w.owner)));
}
export function createGravity(map: { width: number; height: number }, sites: readonly Point[], players: number): GravityConfig {
  return { wells: placeGiants(map, sites, Math.max(2, Math.ceil(players / 2))).map((p, i) => ({ ...p, id: `giant-${i + 1}`, mass: 1, radius: 1.5 })) };
}
export function gravityCourse(world: GravityWorld, from: Point, to: Point, speed: number, departed: number, owner: string | null): { route: FlightRoute; arrives: number } | undefined {
  if (!gravityEnabled(world)) return;
  const a = wrapPoint(world, from), b = wrapPoint(world, to);
  const reverse = a.x > b.x || a.x === b.x && a.y > b.y;
  const start = reverse ? b : a, end = reverse ? a : b;
  const course = plotCourse(world.rules!.map, start, end, world.rules!.gravity!.wells, DEFAULT_TUNING, owner);
  let points = course.points.map((p, i) => ({ ...p, at: course.duration ? course.times[i]! / course.duration : i / (course.points.length - 1) }));
  if (reverse) points = points.reverse().map(p => ({ ...p, at: 1 - p.at }));
  const shift = { x: from.x - points[0]!.x, y: from.y - points[0]!.y };
  points = points.map(p => ({ x: p.x + shift.x, y: p.y + shift.y, at: p.at }));
  // Bound stored geometry while preserving ballistic vertices.
  if (points.length > MAX_COURSE_POINTS) throw new Error('Gravity course exceeds the supported waypoint count.');
  const route: FlightRoute = { from: { x: points[0]!.x, y: points[0]!.y }, to: { x: points.at(-1)!.x, y: points.at(-1)!.y }, course: points };
  return { route, arrives: afterWork(world, departed, Math.max(1e-6, course.duration * DEFAULT_TUNING.baseSpeed / speed)) };
}
