/**
 * ---
 * purpose: Exact encounters between opposing ordinary haulers traveling the same outpost route.
 * ---
 */
import { afterWork, workBetween } from './opening-clock';
import { mechanicsVersion } from './rules';
import { tracePoint, type SimulationTraceSink } from './simulation-trace';
import { mapOffsets } from './geometry';
import { resolveHaulerContact } from './specialist-combat';
import { flightEndpoints, fleetPosition } from './flight';
import type { Fleet, Game } from './simulation';

const CONTACT_TOLERANCE = 1e-9;
function encounterHour(game: Game, a: Fleet, b: Fleet): number {
  if (a.owner === b.owner || a.preparing || b.preparing || a.intercept || b.intercept) return Infinity;
  const aa = flightEndpoints(game, a); const bb = flightEndpoints(game, b);
  const ta = workBetween(game, a.departed, a.arrives); const tb = workBetween(game, b.departed, b.arrives);
  const va = { x: (aa.to.x - aa.from.x) / ta, y: (aa.to.y - aa.from.y) / ta };
  const vb = { x: (bb.to.x - bb.from.x) / tb, y: (bb.to.y - bb.from.y) / tb };
  if (Math.abs(va.x * vb.y - va.y * vb.x) > 1e-6) return Infinity;
  const start = Math.max(a.departed, b.departed);
  const pa = fleetPosition({ ...game, hour: start }, a); const pb = fleetPosition({ ...game, hour: start }, b);
  const vx = va.x - vb.x; const vy = va.y - vb.y;
  const speed2 = vx * vx + vy * vy;
  if (speed2 < CONTACT_TOLERANCE) return Infinity;
  let earliest = Infinity;
  for (const offset of mapOffsets(game)) {
    const dx = pa.x - pb.x - offset.x, dy = pa.y - pb.y - offset.y;
    const elapsed = -(dx * vx + dy * vy) / speed2;
    const hour = afterWork(game, start, elapsed);
    if (a.lastContacts?.some(c => c.id === b.id && Math.abs(c.hour - hour) < 1e-9)) continue;
    if (elapsed >= -CONTACT_TOLERANCE && Math.hypot(dx + vx * elapsed, dy + vy * elapsed) < 1e-6 && hour < Math.min(a.arrives, b.arrives) - CONTACT_TOLERANCE) earliest = Math.min(earliest, hour);
  }
  return earliest;
}
type RouteCandidate = { hour: number; a: Fleet; b: Fleet; aLeg: Leg; bLeg: Leg };
type Leg = Pick<Fleet, 'departed' | 'arrives' | 'route' | 'from' | 'to' | 'owner' | 'preparing' | 'intercept'>;
function leg(fleet: Fleet): Leg {
  const { departed, arrives, route, from, to, owner, preparing, intercept } = fleet;
  return { departed, arrives, route, from, to, owner, preparing, intercept };
}
function sameLeg(fleet: Fleet, saved: Leg): boolean {
  return (Object.keys(saved) as (keyof Leg)[]).every(key => fleet[key] === saved[key]);
}
/** Keep the solver's scheduled instant and leg provenance through same-hour effects. */
export function routeCandidates(game: Game): RouteCandidate[] {
  const result: RouteCandidate[] = [];
  const ordered = [...game.fleets].sort((a, b) => a.id - b.id);
  for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
    const a = ordered[i]!, b = ordered[j]!;
    const hour = encounterHour(game, a, b);
    if (Number.isFinite(hour) && hour >= game.hour) result.push({ hour, a, b, aLeg: leg(a), bLeg: leg(b) });
  }
  return result;
}
export function nextRouteEncounter(game: Game): number {
  let next = Infinity;
  for (let i = 0; i < game.fleets.length; i++) for (let j = i + 1; j < game.fleets.length; j++) {
    const hour = encounterHour(game, game.fleets[i]!, game.fleets[j]!);
    if (hour > game.hour) next = Math.min(next, hour);
  }
  return next;
}
export function resolveRouteEncounters(game: Game, trace?: SimulationTraceSink, candidates?: readonly RouteCandidate[]): void {
  if (mechanicsVersion(game) >= 5) {
    for (const candidate of candidates ?? routeCandidates(game)) {
      const { a, b } = candidate;
      if (candidate.hour !== game.hour || !game.fleets.includes(a) || !game.fleets.includes(b)
        || !sameLeg(a, candidate.aLeg) || !sameLeg(b, candidate.bLeg)) continue;
      resolveHaulerContact(game, a, b);
      tracePoint(trace, 'route-contact', game);
    }
    return;
  }
  const ordered = [...game.fleets].sort((a, b) => a.id - b.id);
  for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
    const a = game.fleets.find(f => f.id === ordered[i]!.id); const b = game.fleets.find(f => f.id === ordered[j]!.id);
    if (!a || !b || Math.abs(encounterHour(game, a, b) - game.hour) > CONTACT_TOLERANCE) continue;
    resolveHaulerContact(game, a, b);
    tracePoint(trace, 'route-contact', game);
  }
}
