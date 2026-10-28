/**
 * ---
 * purpose: Transfer geometry and continuous rendezvous solutions for moving haulers.
 * ---
 */
import type { Fleet } from './simulation';
import { ROUTING_SPEED, type ModuleKind } from './modules';
export type Point = { x: number; y: number };
export type FlightWorld = { hour: number; rocks: readonly (Point & { id: string })[] };
export const TRANSFER_SPEED = 8;
const TIME_TOLERANCE = 1e-9;
export function transferDuration(from: Point, to: Point, module?: ModuleKind, version: 1 | 2 = 1): number {
  const duration = Math.hypot(from.x - to.x, from.y - to.y) / (TRANSFER_SPEED * (module === 'routing' ? ROUTING_SPEED : 1));
  return version === 2 ? Math.max(1e-6, duration) : Math.max(1, Math.ceil(duration));
}
export function flightEndpoints(world: FlightWorld, fleet: Fleet): { from: Point; to: Point } {
  return fleet.route ?? { from: world.rocks.find(r => r.id === fleet.from)!, to: world.rocks.find(r => r.id === fleet.to)! };
}
export function fleetPosition(world: FlightWorld, fleet: Fleet): Point {
  const { from, to } = flightEndpoints(world, fleet);
  const progress = Math.max(0, Math.min(1, (world.hour - fleet.departed) / (fleet.arrives - fleet.departed)));
  return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
}
export function interceptionCourse(world: FlightWorld, source: Point, target: Fleet): { arrives: number; point: Point } | null {
  const remaining = target.arrives - world.hour;
  if (remaining <= TIME_TOLERANCE) return null;
  const current = fleetPosition(world, target);
  const destination = flightEndpoints(world, target).to;
  const vx = (destination.x - current.x) / remaining;
  const vy = (destination.y - current.y) / remaining;
  const dx = current.x - source.x; const dy = current.y - source.y;
  const a = vx * vx + vy * vy - TRANSFER_SPEED * TRANSFER_SPEED;
  const b = 2 * (dx * vx + dy * vy); const c = dx * dx + dy * dy;
  let roots: number[];
  if (Math.abs(a) < TIME_TOLERANCE) roots = b < 0 ? [-c / b] : [];
  else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant));
    roots = [q / a, q ? c / q : Infinity];
  }
  const duration = Math.min(...roots.filter(t => Number.isFinite(t) && t > TIME_TOLERANCE && t < remaining - TIME_TOLERANCE));
  if (!Number.isFinite(duration)) return null;
  return { arrives: world.hour + duration, point: { x: current.x + vx * duration, y: current.y + vy * duration } };
}
export function flightDestination(rocks: readonly { id: string; name: string }[], fleet: Fleet): string {
  if (fleet.intercept) return 'Interception rendezvous';
  const name = rocks.find(r => r.id === fleet.to)?.name ?? 'Unknown rock';
  return fleet.returning ? `Returning to ${name}` : name;
}
