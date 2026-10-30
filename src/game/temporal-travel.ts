/**
 * ---
 * purpose: Dilation speed selection and analytic entry/exit boundaries, including drifting fields and wrapped charts.
 * ---
 */
import type { Fleet, Game, Rock } from './simulation';
import { TEMPORAL, temporalEnabled, inStasis } from './temporal';
import { unitsAtRock } from './specialists';
import { rockSensorRange } from './sensors';
import { fleetPosition, flightEndpoints, flightDeparture } from './flight';
import { mapOffsets, nearestImage, worldDistance } from './geometry';
import { openingRate, workBetween } from './opening-clock';

export function dilationFields(game: Game): Rock[] {
  return temporalEnabled(game) ? game.rocks.filter(r => r.owner && !r.destroyed && !inStasis(game, r)
    && unitsAtRock(game, r.id).some(u => u.owner === r.owner && u.kind === 'dilation')) : [];
}
function velocity(game: Game, fleet: Fleet): { x: number; y: number } {
  if (fleet.preparing || (fleet.enginesDisabledUntil ?? 0) > game.hour || fleet.heldAt) return { x: 0, y: 0 };
  const leg = flightEndpoints(game, fleet), work = workBetween(game, flightDeparture(fleet), fleet.arrives);
  const rate = openingRate(game, game.hour);
  return { x: (leg.to.x - leg.from.x) / work * rate, y: (leg.to.y - leg.from.y) / work * rate };
}
export function dilationMultiplier(game: Game, fleet: Fleet, activeFields = dilationFields(game)): number {
  if (!temporalEnabled(game) || fleet.preparing || fleet.heldAt) return 1;
  const point = fleetPosition(game, fleet), v = velocity(game, fleet);
  for (const field of activeFields) {
    const center = nearestImage(game, point, field), radius = rockSensorRange(game, field);
    const distance = worldDistance(game, point, field);
    const radial = (point.x - center.x) * (v.x - (field.drift?.velocity.x ?? 0)) + (point.y - center.y) * (v.y - (field.drift?.velocity.y ?? 0));
    if (distance < radius - 1e-7 || Math.abs(distance - radius) <= 1e-7 && radial < 0) return TEMPORAL.dilationMultiplier;
  }
  return 1;
}
export function nextDilationEvent(game: Game): number {
  const activeFields = dilationFields(game);
  if (!activeFields.length) return Infinity;
  let next = Infinity;
  for (const fleet of game.fleets) {
    if (fleet.preparing || fleet.heldAt) continue;
    const p = fleetPosition(game, fleet), v = velocity(game, fleet);
    for (const field of activeFields) {
      const vx = v.x - (field.drift?.velocity.x ?? 0), vy = v.y - (field.drift?.velocity.y ?? 0);
      const a = vx * vx + vy * vy;
      if (!a) continue;
      const radius = rockSensorRange(game, field);
      for (const offset of mapOffsets(game)) {
        const dx = p.x - field.x + offset.x, dy = p.y - field.y + offset.y;
        const b = 2 * (dx * vx + dy * vy), c = dx * dx + dy * dy - radius * radius;
        const discriminant = b * b - 4 * a * c;
        if (discriminant <= 0) continue;
        const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant));
        for (const root of [q / a, c / q]) if (root > 1e-8) next = Math.min(next, game.hour + root);
      }
    }
  }
  return next;
}
