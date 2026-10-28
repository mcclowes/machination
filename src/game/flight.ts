/**
 * ---
 * purpose: Transfer geometry and continuous rendezvous solutions for moving haulers.
 * ---
 */
import { mapOffsets, nearestImage, wrappedBounds, wrapPoint, worldDistance, type GeometryWorld, type Point } from './geometry';
import type { Fleet } from './simulation';
import { ROUTING_SPEED, type ModuleKind } from './modules';
export type { Point } from './geometry';
export type FlightWorld = GeometryWorld & { hour: number; rocks: readonly (Point & { id: string })[] };
export const TRANSFER_SPEED = 8;
const TIME_TOLERANCE = 1e-9;
export function transferDuration(from: Point, to: Point, module?: ModuleKind, version: 1 | 2 = 1, world: GeometryWorld = {}): number {
  const duration = worldDistance(world, from, to) / (TRANSFER_SPEED * (module === 'routing' ? ROUTING_SPEED : 1));
  return version === 2 ? Math.max(1e-6, duration) : Math.max(1, Math.ceil(duration));
}
export function flightEndpoints(world: FlightWorld, fleet: Fleet): { from: Point; to: Point } {
  if (fleet.route) return fleet.route;
  const from = world.rocks.find(r => r.id === fleet.from)!;
  const to = world.rocks.find(r => r.id === fleet.to)!;
  return { from, to: wrappedBounds(world) ? nearestImage(world, from, to) : to };
}
export function fleetPosition(world: FlightWorld, fleet: Fleet): Point {
  const { from, to } = flightEndpoints(world, fleet);
  const progress = Math.max(0, Math.min(1, (world.hour - fleet.departed) / (fleet.arrives - fleet.departed)));
  return wrapPoint(world, { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress });
}
export function interceptionCourse(world: FlightWorld, source: Point, target: Fleet, speed = TRANSFER_SPEED, departureHour = world.hour): { arrives: number; point: Point } | null {
  const remaining = target.arrives - departureHour;
  if (remaining <= TIME_TOLERANCE) return null;
  const current = fleetPosition({ ...world, hour: departureHour }, target);
  const leg = flightEndpoints(world, target);
  const vx = wrappedBounds(world) ? (leg.to.x - leg.from.x) / (target.arrives - target.departed) : (leg.to.x - current.x) / remaining;
  const vy = wrappedBounds(world) ? (leg.to.y - leg.from.y) / (target.arrives - target.departed) : (leg.to.y - current.y) / remaining;
  let best: { arrives: number; point: Point } | null = null;
  for (const offset of mapOffsets(world)) {
    const dx = current.x + offset.x - source.x; const dy = current.y + offset.y - source.y;
    const a = vx * vx + vy * vy - speed * speed;
    const b = 2 * (dx * vx + dy * vy); const c = dx * dx + dy * dy;
    let roots: number[];
    if (Math.abs(a) < TIME_TOLERANCE) roots = b < 0 ? [-c / b] : [];
    else {
      const discriminant = b * b - 4 * a * c;
      if (discriminant < 0) continue;
      const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant));
      roots = [q / a, q ? c / q : Infinity];
    }
    const duration = Math.min(...roots.filter(t => Number.isFinite(t) && t > TIME_TOLERANCE && t < remaining - TIME_TOLERANCE));
    if (Number.isFinite(duration) && (!best || departureHour + duration < best.arrives)) best = { arrives: departureHour + duration, point: { x: current.x + offset.x + vx * duration, y: current.y + offset.y + vy * duration } };
  }
  return best;
}
export function flightDestination(rocks: readonly { id: string; name: string }[], fleet: Fleet): string {
  if (fleet.intercept) return 'Interception rendezvous';
  const name = rocks.find(r => r.id === fleet.to)?.name ?? 'Unknown rock';
  return fleet.returning ? `Returning to ${name}` : name;
}
