/**
 * ---
 * purpose: Shared asset motion and expanding-circle contact times for strategic and tactical pulses.
 * related:
 *   - ./pulse-contact.test.ts - wrapped contacts, motion, and event boundaries
 * ---
 */
import type { Fleet, Game, Rock } from './simulation';
import { mapOffsets, type Point } from './geometry';
import { fleetPosition, flightEndpoints, flightDeparture } from './flight';
import { sitePosition } from './drift';
import { openingRate, workBetween } from './opening-clock';

const EPS = 1e-9;
type Motion = { point: Point; velocity: Point };
export function pulseAssetMotion(world: Game, asset: Rock | Fleet): Motion {
  if (typeof asset.id === 'string') {
    const rock = asset as Rock;
    return { point: sitePosition(world, rock, world.hour), velocity: rock.drift?.velocity ?? { x: 0, y: 0 } };
  }
  const fleet = asset as Fleet;
  if (fleet.heldAt) return pulseAssetMotion(world, world.rocks.find(r => r.id === fleet.heldAt)!);
  if (fleet.preparing) return pulseAssetMotion(world, world.rocks.find(r => r.id === fleet.from)!);
  if ((fleet.enginesDisabledUntil ?? 0) > world.hour) return { point: fleetPosition(world, fleet), velocity: { x: 0, y: 0 } };
  const leg = flightEndpoints(world, fleet), duration = workBetween(world, flightDeparture(fleet), fleet.arrives), rate = openingRate(world, world.hour);
  return { point: fleetPosition(world, fleet), velocity: { x: (leg.to.x - leg.from.x) / duration * rate, y: (leg.to.y - leg.from.y) / duration * rate } };
}

/** Earliest entry or exit of a linearly moving target and an expanding circle, over toroidal images. */
export function expandingIntersection(world: Game, origin: Point, radius: number, speed: number, asset: Rock | Fleet, limit: number): number {
  const { point, velocity: v } = pulseAssetMotion(world, asset);
  let next = Infinity;
  for (const offset of mapOffsets(world)) {
    const x = point.x + offset.x - origin.x, y = point.y + offset.y - origin.y;
    const a = v.x * v.x + v.y * v.y - speed * speed, b = 2 * (x * v.x + y * v.y - radius * speed), c = x * x + y * y - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) continue;
    const q = -.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant));
    const roots = Math.abs(a) < 1e-12 ? b ? [-c / b] : [] : [q / a, q ? c / q : 0];
    for (const root of roots) if (root > EPS && world.hour + root <= limit + EPS) next = Math.min(next, world.hour + root);
  }
  return next;
}
