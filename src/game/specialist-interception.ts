/**
 * ---
 * purpose: Specialist manifests, doubled-speed interception, shared contact rules, and nearest-site return missions.
 * ---
 */
import { sitePosition } from './drift';
import { isDue } from './event-timing';
import { tracePoint, type SimulationTraceSink } from './simulation-trace';
import { worldDistance } from './geometry';
import type { Faction, Fleet, Game } from './simulation';
import { fleetPosition, flightEndpoints, interceptionCourse } from './flight';
import { manifestUnits } from './specialists';
import { specialistSpeed } from './specialist-effects';
import { returnHauler } from './specialist-travel';
import { resolveHaulerContact } from './specialist-combat';
import { canObserveHauler } from './sensors';
import { recentEvents } from './events';
import type { EncounterSink } from './combat-report';

export function dispatchSpecialistIntercept(game: Game, fromId: string, targetId: number, drones: number, owner: Faction, requireContact: boolean, ids?: string[], fleetId?: number): Game {
  if (game.winner || game.draw || game.eliminated.includes(owner)) throw new Error('This intelligence is no longer operational.');
  const source = game.rocks.find(r => r.id === fromId && r.owner === owner && !r.destroyed);
  const target = game.fleets.find(f => f.id === targetId && f.owner !== owner && !f.preparing);
  if (!source || !target || requireContact && !canObserveHauler(game, owner, target)) throw new Error('Choose a controlled departure and an observed traveling enemy hauler.');
  const selected = ids ?? source.specialists?.filter(u => u.kind === 'pirate' && u.owner === owner && !u.captive).slice(0, 1).map(u => u.id) ?? [];
  const units = manifestUnits(source, owner, selected);
  if (!units.some(u => u.kind === 'pirate')) throw new Error('An interception manifest needs a scavenger rig.');
  if (!Number.isSafeInteger(drones) || drones < 0 || drones > source.drones) throw new Error('Drone count exceeds available inventory.');
  const departed = game.hour + 1 / 6;
  const speed = specialistSpeed(game, owner, units, false, 'intercept');
  const course = interceptionCourse(game, source, target, speed, departed);
  if (!course) throw new Error('This hauler cannot be reached before its current leg ends.');
  const fleet: Fleet = { id: fleetId ?? game.nextId, owner, from: fromId, to: fromId, drones, specialists: units, speed, preparing: true, departed, arrives: course.arrives,
    route: { from: sitePosition(game, source, departed), to: course.point }, intercept: { target: targetId, home: fromId } };
  return { ...game, nextId: game.nextId + (fleetId === undefined ? 1 : 0), rocks: game.rocks.map(r => r.id === fromId ? { ...r, drones: r.drones - drones, specialists: r.specialists!.filter(u => !selected.includes(u.id)) } : r), fleets: [...game.fleets, fleet],
    events: recentEvents([{ hour: game.hour, audience: [owner], message: `${source.name}: interception preparing with ${drones} drones.` }, ...game.events]),
  };
}
export function resolveSpecialistInterceptions(game: Game, unknown: readonly number[] = [], trace?: SimulationTraceSink, encounters?: EncounterSink): void {
  const due = game.fleets.filter(f => f.intercept && !f.preparing && isDue(game, f.arrives)).sort((a, b) => a.id - b.id);
  for (const rig of due) {
    if (!game.fleets.some(f => f.id === rig.id)) continue;
    try {
      if (unknown.includes(rig.id)) {
        game.fleets = game.fleets.filter(f => f.id !== rig.id);
        game.events.unshift({ hour: game.hour, audience: [rig.owner], unresolvedInterception: true, message: 'Interception outcome unknown outside current observations.' });
        continue;
      }
      const target = game.fleets.find(f => f.id === rig.intercept!.target);
      const point = flightEndpoints(game, rig).to;
      if (target && target.owner !== rig.owner && worldDistance(game, fleetPosition(game, target), point) <= 1e-6) resolveHaulerContact(game, rig, target, encounters, 'interception');
      if (game.fleets.some(f => f.id === rig.id) && rig.intercept) returnHauler(game, rig);
    } finally { tracePoint(trace, 'interception', game); }
  }
}
