/**
 * ---
 * purpose: Authorized navigator course changes with continuous geometry and a shared eight-hour cooldown.
 * ---
 */
import { recentEvents } from './events';
import { mechanicsVersion } from './rules';
import { afterWork } from './opening-clock';
import { stationCourse } from './drift';
import { nearestImage, worldDistance } from './geometry';
import type { Faction, Game } from './simulation';
import { fleetPosition } from './flight';
import { specialistSpeed } from './specialist-effects';

const COURSE_COOLDOWN = 8;

function courseInputs(game: Game, fleetId: number, owner: Faction, destinationId: string, effectiveAt = game.hour) {
  if (game.version !== 2 || game.winner || game.draw || game.eliminated.includes(owner)) throw new Error('This intelligence cannot change course.');
  const fleet = game.fleets.find(f => f.id === fleetId);
  if (!fleet || fleet.owner !== owner || fleet.preparing || fleet.departed > game.hour || fleet.arrives <= game.hour || fleet.courseLocked) {
    throw new Error('Choose an owned, departed hauler with an unlocked course.');
  }
  if ((fleet.enginesDisabledUntil ?? 0) > game.hour) throw new Error('This hauler’s engines are temporarily disabled.');
  const navigators = (fleet.specialists ?? []).filter(u => u.kind === 'navigator' && u.owner === owner && !u.captive);
  if (!navigators.length) throw new Error('Changing course requires an active navigator aboard.');
  if (navigators.some(u => u.lastCourseAt !== undefined && effectiveAt < u.lastCourseAt + COURSE_COOLDOWN)) {
    throw new Error('This hauler must wait eight hours between course changes.');
  }
  const destination = game.rocks.find(r => r.id === destinationId && !r.destroyed);
  if (!destination) throw new Error('Choose a destination that has not been destroyed.');
  return { fleet, navigators, destination };
}

function redirectCourse(game: Game, fleetId: number, owner: Faction, destinationId: string): Game {
  const { fleet, navigators, destination } = courseInputs(game, fleetId, owner, destinationId);
  const point = fleetPosition(game, fleet);
  const specialists = fleet.specialists!.map(u => navigators.includes(u) ? { ...u, lastCourseAt: game.hour } : { ...u });
  const speed = specialistSpeed(game, owner, specialists, destination.owner === owner);
  const changed = { ...fleet, specialists, to: destinationId, speed,
    ...(mechanicsVersion(game) >= 12 ? { courseChanged: true as const } : {}),
    route: { from: point, to: nearestImage(game, point, destination) },
    departed: game.hour, arrives: afterWork(game, game.hour, Math.max(1e-6, worldDistance(game, point, destination) / speed)) };
  if (destination.drift) Object.assign(changed, stationCourse(game, point, destination, speed, game.hour));
  delete changed.intercept;
  delete changed.returning;
  delete changed.interceptionReturn;
  delete changed.preparing;
  return { ...game, fleets: game.fleets.map(f => f === fleet ? changed : f) };
}

export function changeCourse(game: Game, fleetId: number, owner: Faction, destinationId: string): Game {
  if (mechanicsVersion(game) < 10) return redirectCourse(game, fleetId, owner, destinationId);
  const { fleet } = courseInputs(game, fleetId, owner, destinationId, game.hour + 1 / 6);
  if (fleet.pendingCourse) throw new Error('Cancel the pending course change before choosing another.');
  return { ...game, fleets: game.fleets.map(f => f === fleet ? { ...f, pendingCourse: { owner, to: destinationId, executeAt: game.hour + 1 / 6 } } : f),
    events: recentEvents([{ hour: game.hour, audience: [owner], message: 'Course change ordered. The current course continues for ten minutes; cancel before the turn.' }, ...game.events]) };
}

export function cancelCourse(game: Game, fleetId: number, owner: Faction): Game {
  const fleet = game.fleets.find(f => f.id === fleetId && f.owner === owner);
  if (mechanicsVersion(game) < 10 || game.winner || game.draw || game.eliminated.includes(owner) || !fleet?.pendingCourse || fleet.pendingCourse.owner !== owner || game.hour >= fleet.pendingCourse.executeAt) throw new Error('This course change is already active or no longer cancelable.');
  return { ...game, fleets: game.fleets.map(f => { if (f !== fleet) return f; const changed = { ...f }; delete changed.pendingCourse; return changed; }),
    events: recentEvents([{ hour: game.hour, audience: [owner], message: 'Pending course change canceled. The original course continues.' }, ...game.events]) };
}

export function settleCourseChanges(game: Game): Game {
  if (mechanicsVersion(game) < 10) return game;
  let result = game;
  for (const fleet of game.fleets.filter(f => f.pendingCourse && f.pendingCourse.executeAt <= game.hour).sort((a, b) => a.id - b.id)) {
    const pending = fleet.pendingCourse!;
    result = { ...result, fleets: result.fleets.map(f => { if (f.id !== fleet.id) return f; const changed = { ...f }; delete changed.pendingCourse; return changed; }) };
    try { result = redirectCourse(result, fleet.id, pending.owner, pending.to); }
    catch (error) { result.events = recentEvents([{ hour: game.hour, audience: [pending.owner], message: `Course change aborted: ${(error as Error).message}` }, ...result.events]); }
  }
  return result;
}
