/**
 * ---
 * purpose: Deterministic asteroid motion and rendezvous courses shared by simulation, forecasts, and charts.
 * ---
 */
import { mapOffsets, wrapPoint, worldDistance, type GeometryWorld, type Point } from './geometry';
import type { Rock } from './simulation';

export type Drift = { origin: Point; velocity: Point };
export type MovingPoint = Point & { drift?: Drift };
export const ASTEROID_SPEED = 0.5;
export const DRIFT_PREVIEW_HOURS = 24;

export function validDrift(value: unknown, world: GeometryWorld): value is Drift {
  const d = value as Drift | undefined;
  const map = world.rules?.map;
  return !!d && typeof d === 'object' && !Array.isArray(d) && Object.keys(d).length === 2
    && !!d.origin && !!d.velocity && [d.origin, d.velocity].every(p => typeof p === 'object' && !Array.isArray(p) && Object.keys(p).length === 2 && [p.x, p.y].every(Number.isFinite))
    && map?.topology === 'torus' && d.origin.x >= 0 && d.origin.x < map.width && d.origin.y >= 0 && d.origin.y < map.height
    && Math.hypot(d.velocity.x, d.velocity.y) > 0 && Math.hypot(d.velocity.x, d.velocity.y) <= ASTEROID_SPEED + 1e-12;
}

export function sitePosition(world: GeometryWorld, site: MovingPoint, hour: number): Point {
  return site.drift ? wrapPoint(world, {
    x: site.drift.origin.x + site.drift.velocity.x * hour,
    y: site.drift.origin.y + site.drift.velocity.y * hour,
  }) : { x: site.x, y: site.y };
}

export function positionSites(world: GeometryWorld & { hour: number; rocks: MovingPoint[] }): void {
  for (const site of world.rocks) if (site.drift) Object.assign(site, sitePosition(world, site, world.hour));
}

export function seedDriftingBases(rocks: Rock[], world: GeometryWorld): void {
  const remaining = new Set(rocks.filter(r => !r.owner));
  const cores = rocks.filter(r => r.coreOf);
  // Take turns so every starting territory gets two nearby moving footholds.
  for (let rank = 0; rank < 2; rank++) for (const core of cores) {
    const site = [...remaining].sort((a, b) => worldDistance(world, core, a) - worldDistance(world, core, b) || a.id.localeCompare(b.id))[0];
    if (!site) continue;
    remaining.delete(site);
    const angle = (cores.indexOf(core) / cores.length + rank * 0.381966) * 2 * Math.PI;
    site.drift = { origin: { x: site.x, y: site.y }, velocity: { x: ASTEROID_SPEED * Math.cos(angle), y: ASTEROID_SPEED * Math.sin(angle) } };
    site.name = `Asteroid ${site.id.toUpperCase()}`;
  }
}

/** Earliest reachable image of the destination, including motion during launch preparation. */
export function stationCourse(world: GeometryWorld, source: MovingPoint, target: MovingPoint, speed: number, departed: number): { arrives: number; route: { from: Point; to: Point } } {
  const from = sitePosition(world, source, departed);
  const to = sitePosition(world, target, departed);
  const velocity = target.drift?.velocity ?? { x: 0, y: 0 };
  let best = Infinity, endpoint = to;
  for (const offset of mapOffsets(world)) {
    const dx = to.x + offset.x - from.x, dy = to.y + offset.y - from.y;
    const a = velocity.x ** 2 + velocity.y ** 2 - speed ** 2;
    const b = 2 * (dx * velocity.x + dy * velocity.y), c = dx ** 2 + dy ** 2;
    const duration = c === 0 ? 1e-6 : 2 * c / (Math.sqrt(b * b - 4 * a * c) - b);
    if (duration >= 0 && duration < best) {
      best = Math.max(1e-6, duration);
      endpoint = { x: to.x + offset.x + velocity.x * best, y: to.y + offset.y + velocity.y * best };
    }
  }
  if (!Number.isFinite(best)) throw new Error('This destination cannot be reached at the selected speed.');
  return { arrives: departed + best, route: { from, to: endpoint } };
}

/** Absolute entry times keep passive range effects independent of arbitrary polling boundaries. */
export function siteRangeWindows(world: GeometryWorld & { hour: number }, a: MovingPoint, b: MovingPoint, radius: number): { from: number; through: number }[] {
  const ao = a.drift?.origin ?? a, bo = b.drift?.origin ?? b;
  const av = a.drift?.velocity ?? { x: 0, y: 0 }, bv = b.drift?.velocity ?? { x: 0, y: 0 };
  const vx = av.x - bv.x, vy = av.y - bv.y, speed2 = vx * vx + vy * vy;
  if (!speed2) return worldDistance(world, sitePosition(world, a, world.hour), sitePosition(world, b, world.hour)) <= radius ? [{ from: -Infinity, through: Infinity }] : [];
  const map = world.rules?.map;
  const winding = (origin: number, velocity: number, size: number) => Math.floor((origin + velocity * world.hour) / size);
  const windows: { from: number; through: number }[] = [];
  for (const offset of mapOffsets(world)) {
    const dx = ao.x - bo.x + offset.x + (map?.topology === 'torus' ? (winding(bo.x, bv.x, map.width) - winding(ao.x, av.x, map.width)) * map.width : 0);
    const dy = ao.y - bo.y + offset.y + (map?.topology === 'torus' ? (winding(bo.y, bv.y, map.height) - winding(ao.y, av.y, map.height)) * map.height : 0);
    const linear = 2 * (dx * vx + dy * vy), constant = dx * dx + dy * dy - radius * radius;
    const discriminant = linear * linear - 4 * speed2 * constant;
    if (discriminant < 0) continue;
    const q = -0.5 * (linear + (linear < 0 ? -1 : 1) * Math.sqrt(discriminant));
    const roots = q === 0 ? [0, 0] : [q / speed2, constant / q];
    windows.push({ from: Math.min(...roots), through: Math.max(...roots) });
  }
  return windows;
}
