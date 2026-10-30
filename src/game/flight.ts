/**
 * ---
 * purpose: Transfer geometry and continuous rendezvous solutions for moving haulers.
 * ---
 */
import { routePosition, routeSegment, remainingRoute, type FlightRoute } from './flight-route';

import { afterWork, travelProgress, workBetween, openingRate } from './opening-clock';
import { sitePosition, type MovingPoint } from './drift';
import { mapOffsets, nearestImage, wrappedBounds, wrapPoint, worldDistance, type GeometryWorld, type Point } from './geometry';
import type { Fleet } from './simulation';
import { ROUTING_SPEED, type ModuleKind } from './modules';
export type { Point } from './geometry';
export type FlightWorld = GeometryWorld & { hour: number; rocks: readonly (MovingPoint & { id: string })[] };
export const TRANSFER_SPEED = 8;
const TIME_TOLERANCE = 1e-9;
const VERTEX_HOUR_TOLERANCE = 1e-10;
// Inverting a stored vertex hour can land a few ulps before its normalized work time.
const VERTEX_PROGRESS_TOLERANCE = 1e-12;
export function transferDuration(from: Point, to: Point, module?: ModuleKind, version: 1 | 2 = 1, world: GeometryWorld = {}): number {
  const duration = worldDistance(world, from, to) / (TRANSFER_SPEED * (module === 'routing' ? ROUTING_SPEED : 1));
  return version === 2 ? Math.max(1e-6, duration) : Math.max(1, Math.ceil(duration));
}
export function flightEndpoints(world: FlightWorld, fleet: Fleet): FlightRoute {
  if (fleet.route) return fleet.route;
  const from = world.rocks.find(r => r.id === fleet.from)!;
  const to = world.rocks.find(r => r.id === fleet.to)!;
  return { from, to: wrappedBounds(world) ? nearestImage(world, from, to) : to };
}
export const flightDeparture = (fleet: Fleet): number => Math.max(fleet.departed, fleet.enginesDisabledUntil ?? 0);
export function fleetPosition(world: FlightWorld, fleet: Fleet): Point {
  if (fleet.heldAt) { const site = world.rocks.find(r => r.id === fleet.heldAt); if (site) return sitePosition(world, site, world.hour); }
  if (fleet.preparing && world.hour < fleet.departed) {
    const site = world.rocks.find(r => r.id === fleet.from);
    if (site?.drift) return sitePosition(world, site, world.hour);
  }
  const { from, to } = flightEndpoints(world, fleet);
  const progress = travelProgress(world, flightDeparture(fleet), fleet.arrives, world.hour);
  return wrapPoint(world, fleet.route?.course ? routePosition(fleet.route, progress) : { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress });
}
export function interceptionCourse(world: FlightWorld, source: MovingPoint, target: Fleet, speed = TRANSFER_SPEED, departureHour = world.hour): { arrives: number; point: Point } | null {
  if (target.route?.course) return curvedInterception(world, source, target, speed, departureHour);
  source = sitePosition(world, source, departureHour);
  const remaining = workBetween(world, departureHour, target.arrives);
  if (remaining <= TIME_TOLERANCE) return null;
  const current = fleetPosition({ ...world, hour: departureHour }, target);
  const leg = flightEndpoints(world, target);
  const disabled = (target.enginesDisabledUntil ?? 0) > departureHour;
  const vx = disabled ? 0 : wrappedBounds(world) ? (leg.to.x - leg.from.x) / workBetween(world, flightDeparture(target), target.arrives) : (leg.to.x - current.x) / remaining;
  const vy = disabled ? 0 : wrappedBounds(world) ? (leg.to.y - leg.from.y) / workBetween(world, flightDeparture(target), target.arrives) : (leg.to.y - current.y) / remaining;
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
    const duration = Math.min(...roots.filter(t => (!disabled || afterWork(world, departureHour, t) <= target.enginesDisabledUntil!) && Number.isFinite(t) && t > TIME_TOLERANCE && t < remaining - TIME_TOLERANCE));
    if (Number.isFinite(duration) && (!best || afterWork(world, departureHour, duration) < best.arrives)) best = { arrives: afterWork(world, departureHour, duration), point: { x: current.x + offset.x + vx * duration, y: current.y + offset.y + vy * duration } };
  }
  return best;
}
export function flightDestination(rocks: readonly { id: string; name: string }[], fleet: Fleet): string {
  if (fleet.intercept) return 'Interception rendezvous';
  const name = rocks.find(r => r.id === fleet.to)?.name ?? 'Unknown rock';
  return fleet.returning ? `Returning to ${name}` : name;
}

/** Work-space velocity is constant only until the next frozen course vertex. */
export function fleetVelocity(world: FlightWorld, fleet: Fleet, actualHours = false): Point {
  if (fleet.heldAt || fleet.preparing || world.hour < flightDeparture(fleet) || world.hour >= fleet.arrives) return { x: 0, y: 0 };
  const route = flightEndpoints(world, fleet), progress = travelProgress(world, flightDeparture(fleet), fleet.arrives, world.hour);
  const { from, to } = routeSegment(route, Math.min(1, progress + VERTEX_PROGRESS_TOLERANCE));
  const duration = workBetween(world, flightDeparture(fleet), fleet.arrives) * (to.at - from.at);
  const rate = actualHours ? openingRate(world, world.hour) : 1;
  return { x: (to.x - from.x) / duration * rate, y: (to.y - from.y) / duration * rate };
}
export function flightVertexHours(world: FlightWorld, fleet: Fleet): number[] {
  const departure = flightDeparture(fleet), work = workBetween(world, departure, fleet.arrives);
  return (fleet.route?.course ?? []).slice(1, -1).map(p => afterWork(world, departure, work * p.at));
}
export function nextFlightVertex(world: FlightWorld, fleet: Fleet): number {
  const points = fleet.route?.course;
  if (fleet.heldAt || !points || points.length < 3) return Infinity;
  const departure = flightDeparture(fleet), work = workBetween(world, departure, fleet.arrives);
  let lo = 1, hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (afterWork(world, departure, work * points[mid]!.at) <= world.hour + VERTEX_HOUR_TOLERANCE) lo = mid + 1; else hi = mid;
  }
  return lo < points.length - 1 ? afterWork(world, departure, work * points[lo]!.at) : Infinity;
}
export function remainingFlightRoute(world: FlightWorld, fleet: Fleet): FlightRoute {
  return remainingRoute(flightEndpoints(world, fleet), travelProgress(world, flightDeparture(fleet), fleet.arrives, world.hour));
}
function curvedInterception(world: FlightWorld, source: MovingPoint, target: Fleet, speed: number, departure: number): { arrives: number; point: Point } | null {
  const origin = sitePosition(world, source, departure), points = target.route!.course!;
  const start = flightDeparture(target), total = workBetween(world, start, target.arrives);
  let best: { arrives: number; point: Point } | null = null;
  const segments = points.slice(0, -1).map((p, i) => ({ from: p, to: points[i + 1]!, begins: afterWork(world, start, total * p.at), ends: afterWork(world, start, total * points[i + 1]!.at) }));
  if (start > departure) segments.unshift({ from: points[0]!, to: points[0]!, begins: departure, ends: start });
  for (const segment of segments) {
    const lo = Math.max(departure, segment.begins), hi = Math.min(target.arrives, segment.ends);
    if (hi <= lo || best && lo >= best.arrives) continue;
    const duration = workBetween(world, segment.begins, segment.ends);
    const vx = (segment.to.x - segment.from.x) / duration, vy = (segment.to.y - segment.from.y) / duration;
    const elapsed = workBetween(world, segment.begins, departure);
    const base = { x: segment.from.x + vx * elapsed, y: segment.from.y + vy * elapsed };
    for (const offset of mapOffsets(world)) {
      const dx = base.x + offset.x - origin.x, dy = base.y + offset.y - origin.y;
      const a = vx * vx + vy * vy - speed * speed, b = 2 * (dx * vx + dy * vy), c = dx * dx + dy * dy;
      const disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      const q = -.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(disc));
      const roots = Math.abs(a) < TIME_TOLERANCE ? b ? [-c / b] : [] : [q / a, q ? c / q : Infinity];
      for (const work of roots) {
        const hour = afterWork(world, departure, work);
        if (work <= TIME_TOLERANCE || hour < lo - TIME_TOLERANCE || hour > hi + TIME_TOLERANCE || hour >= target.arrives - TIME_TOLERANCE || best && hour >= best.arrives) continue;
        best = { arrives: hour, point: { x: base.x + offset.x + vx * work, y: base.y + offset.y + vy * work } };
      }
    }
  }
  return best;
}

/** Heading remains aligned with the course while engines are disabled or launch is preparing. */
export function flightDirection(world: FlightWorld, fleet: Fleet): Point {
  const route = flightEndpoints(world, fleet);
  const progress = travelProgress(world, flightDeparture(fleet), fleet.arrives, world.hour);
  const { from, to } = routeSegment(route, Math.min(1, progress + VERTEX_PROGRESS_TOLERANCE));
  return { x: to.x - from.x, y: to.y - from.y };
}
