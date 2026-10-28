/** Private sensor support over finite binary64 times in a fixed motion span. */
import { wrappedBounds, type GeometryWorld, type Point } from '../game/geometry';
import { flightEndpoints, type FlightWorld } from '../game/flight';
import { atOrdinal, ordinal, nextHour, requireNumericRuntime, distanceBounds, MAX_NUMERIC_REGIONS, UnsupportedVisibilityNumericError, type NumericFlight } from './numeric-support';
export { UnsupportedVisibilityNumericError } from './numeric-support';
import type { Fleet } from '../game/simulation';

export type AffineMotion = { position: Point; velocity: Point; source?: NumericFlight; origin?: number };
export type MovingSensor = AffineMotion & { radius: number };
export type VisibilityInterval = { from: number; through: number };
export type MotionSpan = VisibilityInterval & { motion: AffineMotion };
export const MAX_VISIBILITY_IMAGES = 65_536;
export class VisibilityCapacityError extends Error { constructor() { super('Replay geometry exceeds the supported sweep capacity.'); } }

export function flightMotionSpans(world: FlightWorld, fleet: Fleet, from: number, through: number): MotionSpan[] {
  if (![from, through, fleet.departed, fleet.arrives].every(Number.isFinite) || from < 0 || through < from || fleet.arrives <= fleet.departed) throw new RangeError('Provide a finite ordered flight span.');
  const route = flightEndpoints(world, fleet);
  if (![route.from.x, route.from.y, route.to.x, route.to.y].every(Number.isFinite)) throw new RangeError('Provide finite flight endpoints.');
  const boundaries = [...new Set([from, ...[fleet.departed, fleet.arrives].filter(hour => hour > from && hour < through), through])].sort((a, b) => a - b);
  if (boundaries.length === 1) boundaries.push(through);
  return boundaries.slice(0, -1).map((hour, index) => {
    const progress = Math.max(0, Math.min(1, (hour - fleet.departed) / (fleet.arrives - fleet.departed)));
    const moving = hour >= fleet.departed && hour < fleet.arrives;
    return { from: hour, through: boundaries[index + 1]!, motion: {
      position: { x: route.from.x + (route.to.x - route.from.x) * progress, y: route.from.y + (route.to.y - route.from.y) * progress },
      source: { from: { ...route.from }, to: { ...route.to }, departed: fleet.departed, arrives: fleet.arrives },
      velocity: moving ? { x: (route.to.x - route.from.x) / (fleet.arrives - fleet.departed), y: (route.to.y - route.from.y) / (fleet.arrives - fleet.departed) } : { x: 0, y: 0 },
    } };
  });
}

function circleWindow(dx: number, dy: number, wx: number, wy: number, radius: number): [number, number] | undefined {
  const scale = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(wx), Math.abs(wy), radius) || 1;
  dx /= scale; dy /= scale; wx /= scale; wy /= scale; radius /= scale;
  const a = wx * wx + wy * wy;
  const b = 2 * (dx * wx + dy * wy);
  const c = dx * dx + dy * dy - radius * radius;
  if (a === 0) return Math.hypot(dx, dy) <= radius ? [0, 1] : undefined;
  const closest = Math.max(0, Math.min(1, -b / (2 * a)));
  if (Math.hypot(dx + wx * closest, dy + wy * closest) > radius) return;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return;
  const root = Math.sqrt(discriminant);
  const q = -0.5 * (b + (b < 0 ? -root : root));
  const roots = q === 0 ? [0, 0] : [q / a, c / q];
  const from = Math.max(0, Math.min(...roots));
  const through = Math.min(1, Math.max(...roots));
  return from <= through ? [from, through] : undefined;
}

function analyticVisibilityIntervals(world: GeometryWorld, point: AffineMotion, sensors: readonly MovingSensor[], from: number, through: number): VisibilityInterval[] {
  if (![from, through, point.position.x, point.position.y, point.velocity.x, point.velocity.y].every(Number.isFinite) || from < 0 || through < from) throw new RangeError('Provide a finite ordered motion span.');
  const map = wrappedBounds(world);
  if (map && (![map.width, map.height].every(Number.isFinite) || map.width <= 0 || map.height <= 0)) throw new RangeError('Provide finite positive wrapped dimensions.');
  const duration = through - from;
  const windows: VisibilityInterval[] = [];
  let images = 0;
  for (const sensor of sensors) {
    if (![sensor.position.x, sensor.position.y, sensor.velocity.x, sensor.velocity.y, sensor.radius].every(Number.isFinite) || sensor.radius < 0) throw new RangeError('Provide finite sensor motion and a nonnegative radius.');
    const dx = point.position.x - sensor.position.x, dy = point.position.y - sensor.position.y;
    const wx = (point.velocity.x - sensor.velocity.x) * duration, wy = (point.velocity.y - sensor.velocity.y) * duration;
    if (![dx, dy, wx, wy, dx + wx, dy + wy].every(Number.isFinite)) throw new UnsupportedVisibilityNumericError();
    if (map && sensor.radius >= Math.hypot(map.width / 2, map.height / 2)) return [{ from, through }];
    const x0 = map ? Math.ceil((Math.min(dx, dx + wx) - sensor.radius) / map.width) : 0;
    const x1 = map ? Math.floor((Math.max(dx, dx + wx) + sensor.radius) / map.width) : 0;
    const y0 = map ? Math.ceil((Math.min(dy, dy + wy) - sensor.radius) / map.height) : 0;
    const y1 = map ? Math.floor((Math.max(dy, dy + wy) + sensor.radius) / map.height) : 0;
    const count = Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1);
    if (count === 0) continue;
    if (![x0, x1, y0, y1].every(Number.isSafeInteger) || !Number.isSafeInteger(count) || count > MAX_VISIBILITY_IMAGES - images) throw new VisibilityCapacityError();
    images += count;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const window = circleWindow(dx - x * (map?.width ?? 0), dy - y * (map?.height ?? 0), wx, wy, sensor.radius);
      if (window) windows.push({ from: from + window[0] * duration, through: from + window[1] * duration });
    }
  }
  windows.sort((a, b) => a.from - b.from || a.through - b.through);
  const merged: VisibilityInterval[] = [];
  for (const window of windows) {
    const last = merged.at(-1);
    if (last && window.from <= last.through) last.through = Math.max(last.through, window.through);
    else merged.push({ ...window });
  }
  return merged;
}

/**
 * Private finite binary64 support, using monotone coordinate and pinned V8 operation bounds.
 * Analytic roots guide subdivision only; they never exclude rounded contacts.
 * Unknown runtimes and unresolved regions refuse; hypot itself need not be monotone.
 */
export function visibilityIntervals(world: GeometryWorld, point: AffineMotion, sensors: readonly MovingSensor[], from: number, through: number): VisibilityInterval[] {
  requireNumericRuntime();
  const candidates = analyticVisibilityIntervals(world, point, sensors, from, through);
  const cuts = [...new Set([from, through, ...candidates.flatMap(w => [w.from, w.through]).filter(t => Number.isFinite(t) && t >= from && t <= through)])].sort((a, b) => a - b);
  const result: VisibilityInterval[] = [];
  let regions = 0;
  function visit(lo: bigint, hi: bigint): void {
    if (lo > hi) return;
    if (++regions > MAX_NUMERIC_REGIONS) throw new UnsupportedVisibilityNumericError();
    const start = atOrdinal(lo), end = atOrdinal(hi);
    let outside = true, inside = false;
    for (const sensor of sensors) {
      const bounds = distanceBounds(world, point, sensor, from, start, end);
      if (bounds[1] <= sensor.radius) { inside = true; break; }
      if (bounds[0] <= sensor.radius) outside = false;
    }
    if (inside) {
      const last = result.at(-1);
      if (last && start <= nextHour(last.through)) last.through = end;
      else result.push({ from: start, through: end });
    } else if (!outside) {
      if (lo === hi) throw new UnsupportedVisibilityNumericError();
      const mid = (lo + hi) / 2n;
      visit(lo, mid); visit(mid + 1n, hi);
    }
  }
  if (cuts.length === 1) visit(ordinal(from), ordinal(through));
  else for (let i = 0; i < cuts.length - 1; i++) visit(ordinal(cuts[i]!) + (i ? 1n : 0n), ordinal(cuts[i + 1]!));
  return result;
}
