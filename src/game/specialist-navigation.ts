/**
 * ---
 * purpose: Authorized navigator course changes with continuous geometry and a shared eight-hour cooldown.
 * ---
 */
import { nearestImage, worldDistance } from './geometry';
import type { Faction, Game } from './simulation';
import { fleetPosition } from './flight';
import { specialistSpeed } from './specialist-effects';

const COURSE_COOLDOWN = 8;

export function changeCourse(game: Game, fleetId: number, owner: Faction, destinationId: string): Game {
  if (game.version !== 2 || game.winner || game.draw || game.eliminated.includes(owner)) throw new Error('This intelligence cannot change course.');
  const fleet = game.fleets.find(f => f.id === fleetId);
  if (!fleet || fleet.owner !== owner || fleet.preparing || fleet.departed > game.hour || fleet.arrives <= game.hour || fleet.courseLocked) {
    throw new Error('Choose an owned, departed hauler with an unlocked course.');
  }
  const navigators = (fleet.specialists ?? []).filter(u => u.kind === 'navigator' && u.owner === owner && !u.captive);
  if (!navigators.length) throw new Error('Changing course requires an active navigator aboard.');
  if (navigators.some(u => u.lastCourseAt !== undefined && game.hour < u.lastCourseAt + COURSE_COOLDOWN)) {
    throw new Error('This hauler must wait eight hours between course changes.');
  }
  const destination = game.rocks.find(r => r.id === destinationId && !r.destroyed);
  if (!destination) throw new Error('Choose a destination that has not been destroyed.');
  const point = fleetPosition(game, fleet);
  const specialists = fleet.specialists!.map(u => navigators.includes(u) ? { ...u, lastCourseAt: game.hour } : { ...u });
  const speed = specialistSpeed(game, owner, specialists, destination.owner === owner);
  const changed = { ...fleet, specialists, to: destinationId, speed,
    route: { from: point, to: nearestImage(game, point, destination) },
    departed: game.hour, arrives: game.hour + Math.max(1e-6, worldDistance(game, point, destination) / speed) };
  delete changed.intercept;
  delete changed.returning;
  delete changed.preparing;
  return { ...game, fleets: game.fleets.map(f => f === fleet ? changed : f) };
}
