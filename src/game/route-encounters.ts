/**
 * ---
 * purpose: Exact encounters between opposing ordinary haulers traveling the same outpost route.
 * ---
 */
import { afterWork, workBetween } from './opening-clock';
import { driftingBasesEnabled, mechanicsVersion, type PublicRules } from './rules';
import { tracePoint, type SimulationTraceSink } from './simulation-trace';
import type { EncounterSink } from './combat-report';
import { mapOffsets, worldDistance } from './geometry';
import { resolveHaulerContact } from './specialist-combat';
import { flightEndpoints, fleetPosition, flightDeparture, type FlightWorld } from './flight';
import type { Fleet, Game } from './simulation';

const CONTACT_TOLERANCE = 1e-9;
function ordinaryPair(a: Fleet, b: Fleet): boolean {
  return a.from === b.from && a.to === b.to || a.from === b.to && a.to === b.from;
}
export function encounterHour(game: FlightWorld & { rules?: PublicRules }, a: Fleet, b: Fleet): number {
  if (a.heldAt || b.heldAt || a.owner === b.owner || a.preparing || b.preparing || a.intercept || b.intercept) return Infinity;
  if (mechanicsVersion(game) >= 12 && !driftingBasesEnabled(game) && !a.returning && !b.returning && !a.courseChanged && !b.courseChanged && !ordinaryPair(a, b)) return Infinity;
  const aa = flightEndpoints(game, a); const bb = flightEndpoints(game, b);
  const ta = workBetween(game, flightDeparture(a), a.arrives); const tb = workBetween(game, flightDeparture(b), b.arrives);
  const pausedA = (a.enginesDisabledUntil ?? 0) > game.hour, pausedB = (b.enginesDisabledUntil ?? 0) > game.hour;
  const va = pausedA ? { x: 0, y: 0 } : { x: (aa.to.x - aa.from.x) / ta, y: (aa.to.y - aa.from.y) / ta };
  const vb = pausedB ? { x: 0, y: 0 } : { x: (bb.to.x - bb.from.x) / tb, y: (bb.to.y - bb.from.y) / tb };
  if (Math.abs(va.x * vb.y - va.y * vb.x) > 1e-6) return Infinity;
  const start = Math.max(a.departed, b.departed, pausedA || pausedB ? game.hour : 0);
  const pa = fleetPosition({ ...game, hour: start }, a); const pb = fleetPosition({ ...game, hour: start }, b);
  const vx = va.x - vb.x; const vy = va.y - vb.y;
  const speed2 = vx * vx + vy * vy;
  if (speed2 < CONTACT_TOLERANCE) return Infinity;
  let earliest = Infinity;
  for (const offset of mapOffsets(game)) {
    const dx = pa.x - pb.x - offset.x, dy = pa.y - pb.y - offset.y;
    const elapsed = -(dx * vx + dy * vy) / speed2;
    const hour = afterWork(game, start, elapsed);
    if (pausedA && hour > a.enginesDisabledUntil! || pausedB && hour > b.enginesDisabledUntil!) continue;
    if (a.lastContacts?.some(c => c.id === b.id && Math.abs(c.hour - hour) < 1e-9)) continue;
    if (elapsed >= -CONTACT_TOLERANCE && Math.hypot(dx + vx * elapsed, dy + vy * elapsed) < 1e-6 && hour < Math.min(a.arrives, b.arrives) - CONTACT_TOLERANCE) earliest = Math.min(earliest, hour);
  }
  return earliest;
}
type RouteCandidate = { hour: number; a: Fleet; b: Fleet; aLeg: Leg; bLeg: Leg };
type Leg = Pick<Fleet, 'departed' | 'arrives' | 'enginesDisabledUntil' | 'route' | 'from' | 'to' | 'owner' | 'preparing' | 'intercept' | 'returning' | 'courseChanged'>;
function leg(fleet: Fleet): Leg {
  const { enginesDisabledUntil, departed, arrives, route, from, to, owner, preparing, intercept, returning, courseChanged } = fleet;
  return { enginesDisabledUntil, departed, arrives, route, from, to, owner, preparing, intercept, returning, courseChanged };
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
export function resolveRouteEncounters(game: Game, trace?: SimulationTraceSink, candidates?: readonly RouteCandidate[], encounters?: EncounterSink): void {
  if (mechanicsVersion(game) >= 5) {
    for (const candidate of candidates ?? routeCandidates(game)) {
      const { a, b } = candidate;
      if (candidate.hour !== game.hour || !game.fleets.includes(a) || !game.fleets.includes(b)) continue;
      const outageBoundary = game.pulse?.tactical && [a, b].some(f => f.departed === game.hour && (f.enginesDisabledUntil ?? 0) > game.hour)
        || [candidate.aLeg, candidate.bLeg].some(f => f.enginesDisabledUntil === game.hour);
      const contactAtOutage = outageBoundary && a.owner === candidate.aLeg.owner && b.owner === candidate.bLeg.owner && worldDistance(game, fleetPosition(game, a), fleetPosition(game, b)) < 1e-6;
      if ((!sameLeg(a, candidate.aLeg) || !sameLeg(b, candidate.bLeg)) && !contactAtOutage) continue;
      resolveHaulerContact(game, a, b, encounters);
      tracePoint(trace, 'route-contact', game);
    }
    return;
  }
  const ordered = [...game.fleets].sort((a, b) => a.id - b.id);
  for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
    const a = game.fleets.find(f => f.id === ordered[i]!.id); const b = game.fleets.find(f => f.id === ordered[j]!.id);
    if (!a || !b || Math.abs(encounterHour(game, a, b) - game.hour) > CONTACT_TOLERANCE) continue;
    resolveHaulerContact(game, a, b, encounters);
    tracePoint(trace, 'route-contact', game);
  }
}
