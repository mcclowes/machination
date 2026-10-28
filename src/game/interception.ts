/**
 * ---
 * purpose: Scavenger interception orders, in-flight combat, and committed return missions.
 * ---
 */
import { dispatchSpecialistIntercept } from './specialist-interception';
import type { Faction, Fleet, Game } from './simulation';
import { fleetPosition, flightEndpoints, interceptionCourse, transferDuration, type Point } from './flight';
import { inRange, observers, sensors } from './sensors';
import { recentEvents } from './events';
import { SALVAGE_FRACTION, BLAST_MULTIPLIER, CONVERSION_FRACTION, CONVERSION_LIMIT } from './modules';
const MEETING_TOLERANCE = 1e-6;
export function dispatchIntercept(game: Game, fromId: string, targetId: number, drones: number, owner: Faction, requireContact = true, specialists?: string[]): Game {
  if (game.version === 2) return dispatchSpecialistIntercept(game, fromId, targetId, drones, owner, requireContact, specialists);
  if (game.winner || game.eliminated.includes(owner)) throw new Error('This intelligence is no longer operational.');
  const from = game.rocks.find(r => r.id === fromId);
  const target = game.fleets.find(f => f.id === targetId);
  if (!from || from.owner !== owner || from.module !== 'scavenger') throw new Error('Select a controlled rock with a scavenger rig.');
  if (!Number.isSafeInteger(drones) || drones < 1 || drones > from.drones) throw new Error('Drone count exceeds available inventory.');
  if (!target || target.owner === owner || requireContact && !inRange(sensors(game, owner), fleetPosition(game, target), game)) throw new Error('Select an observed enemy hauler.');
  const course = interceptionCourse(game, from, target);
  if (!course) throw new Error('This hauler cannot be reached before its current leg ends.');
  const rig: Fleet = { id: game.nextId, owner, from: fromId, to: fromId, drones, departed: game.hour, arrives: course.arrives,
    module: 'scavenger', route: { from: { x: from.x, y: from.y }, to: course.point }, intercept: { target: targetId, home: fromId } };
  return { ...game, nextId: game.nextId + 1,
    rocks: game.rocks.map(r => { if (r.id !== fromId) return r; const departure = { ...r, drones: r.drones - drones }; delete departure.module; return departure; }),
    fleets: [...game.fleets, rig], events: recentEvents([{ hour: game.hour, audience: [...new Set([owner, ...observers(game, from)])], message: `${from.name}: scavenger rig dispatched with ${drones} drones for interception.` }, ...game.events]) };
}
function returningFleet(game: Game, fleet: Fleet, point: Point, drones: number): Fleet {
  const homeId = fleet.intercept?.home ?? fleet.from;
  const home = game.rocks.find(r => r.id === homeId)!;
  return { id: fleet.id, owner: fleet.owner, from: homeId, to: homeId, drones, module: 'scavenger', departed: game.hour,
    arrives: game.hour + transferDuration(point, home), route: { from: { ...point }, to: { x: home.x, y: home.y } }, returning: true };
}
export function resolveInterceptions(game: Game, unknownInterceptions: readonly number[] = []): void {
  const due = game.fleets.filter(f => f.intercept && f.arrives <= game.hour).sort((a, b) => a.id - b.id);
  for (const scheduled of due) {
    const rig = game.fleets.find(f => f.id === scheduled.id);
    if (!rig?.intercept) continue;
    const point = flightEndpoints(game, rig).to;
    if (unknownInterceptions.includes(rig.id)) {
      game.fleets = game.fleets.filter(f => f.id !== rig.id);
      game.events.unshift({ hour: game.hour, audience: [rig.owner], unresolvedInterception: true, message: 'Interception outcome unknown; target is outside current observations.' });
      continue;
    }
    const target = game.fleets.find(f => f.id === rig.intercept!.target);
    if (!target || target.owner === rig.owner || Math.hypot(fleetPosition(game, target).x - point.x, fleetPosition(game, target).y - point.y) > MEETING_TOLERANCE) {
      game.fleets = game.fleets.filter(f => f.id !== rig.id);
      game.fleets.push(returningFleet(game, rig, point, rig.drones));
      game.events.unshift({ hour: game.hour, audience: [rig.owner], message: 'Scavenger rig: target lost or redirected; returning without combat.' });
      continue;
    }
    const audience = [...new Set([rig.owner, target.owner, ...observers(game, point)])];
    game.fleets = game.fleets.filter(f => f.id !== rig.id);
    let attackers = rig.drones;
    let defenders = target.drones;
    if (target.module === 'charge') {
      const survivors = Math.max(0, attackers - defenders * BLAST_MULTIPLIER);
      game.fleets = game.fleets.filter(f => f.id !== target.id);
      if (survivors) game.fleets.push(returningFleet(game, rig, point, survivors + Math.floor((attackers - survivors) * SALVAGE_FRACTION)));
      game.events.unshift({ hour: game.hour, audience, message: 'Scavenger encounter: defending charge detonated.' });
      continue;
    }
    if (target.module === 'virus') {
      const converted = Math.min(CONVERSION_LIMIT, Math.floor(attackers * CONVERSION_FRACTION));
      attackers -= converted; defenders += converted;
      game.events.unshift({ hour: game.hour, audience, message: `Scavenger encounter: defending virus assimilated ${converted} drones.` });
    }
    if (attackers > defenders) {
      const survivors = attackers - defenders;
      const recovered = Math.floor((rig.drones - survivors) * SALVAGE_FRACTION);
      game.fleets = game.fleets.filter(f => f.id !== target.id);
      game.fleets.push(returningFleet(game, rig, point, survivors + recovered));
      game.events.unshift({ hour: game.hour, audience, message: `Scavenger rig: target neutralized; ${survivors + recovered} drones returning.` });
    } else if (attackers === defenders) {
      game.fleets = game.fleets.filter(f => f.id !== target.id);
      game.events.unshift({ hour: game.hour, audience, message: 'Scavenger encounter: both haulers destroyed.' });
    } else {
      const survivors = defenders - attackers;
      if (target.module === 'scavenger') {
        const recovered = Math.floor((target.drones - survivors) * SALVAGE_FRACTION);
        game.fleets = game.fleets.filter(f => f.id !== target.id);
        game.fleets.push(returningFleet(game, target, point, survivors + recovered));
      } else target.drones = survivors;
      game.events.unshift({ hour: game.hour, audience, message: 'Scavenger rig destroyed; defending hauler survived.' });
    }
  }
}
