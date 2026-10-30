/**
 * ---
 * purpose: Frozen piecewise-linear flight routes with normalized work times and strict wire validation.
 * ---
 */
import type { Point } from './geometry';
export const MAX_COURSE_POINTS = 2048;
export type CoursePoint = Point & { at: number };
export type FlightRoute = { from: Point; to: Point; course?: CoursePoint[] };
export function validRoute(value: unknown, curved = false, maxCoordinate = Infinity): value is FlightRoute {
  const r = value as FlightRoute | undefined;
  const point = (p: Point) => !!p && typeof p === 'object' && !Array.isArray(p) && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= maxCoordinate && Math.abs(p.y) <= maxCoordinate;
  if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some(k => !['from', 'to', 'course'].includes(k)) || !point(r.from) || !point(r.to)) return false;
  if (r.course === undefined) return true;
  return curved && Array.isArray(r.course) && r.course.length >= 2 && r.course.length <= MAX_COURSE_POINTS
    && r.course.every((p, i, all) => point(p) && Object.keys(p).length === 3 && Number.isFinite(p.at) && p.at >= 0 && p.at <= 1 && (!i || p.at > all[i - 1]!.at))
    && r.course[0]!.at === 0 && r.course.at(-1)!.at === 1
    && r.course[0]!.x === r.from.x && r.course[0]!.y === r.from.y && r.course.at(-1)!.x === r.to.x && r.course.at(-1)!.y === r.to.y;
}
export function routeSegment(route: FlightRoute, progress: number): { from: CoursePoint; to: CoursePoint } {
  const points = route.course;
  if (!points) return { from: { ...route.from, at: 0 }, to: { ...route.to, at: 1 } };
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid]!.at <= progress) lo = mid; else hi = mid; }
  return { from: points[lo]!, to: points[hi]! };
}
export function routePosition(route: FlightRoute, progress: number): Point {
  const { from, to } = routeSegment(route, progress);
  const u = Math.max(0, Math.min(1, (progress - from.at) / (to.at - from.at)));
  return { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u };
}
export function remainingRoute(route: FlightRoute, progress: number): FlightRoute {
  const from = routePosition(route, progress);
  if (!route.course || progress >= 1) return { from, to: { ...route.to } };
  return { from, to: { ...route.to }, course: [{ ...from, at: 0 }, ...route.course.filter(p => p.at > progress).map(p => ({ ...p, at: (p.at - progress) / (1 - progress) }))] };
}
