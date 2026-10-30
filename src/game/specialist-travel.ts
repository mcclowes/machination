/**
 * ---
 * purpose: Captive releases and unit-only return haulers, retaining real transit and ownership.
 * ---
 */
import { gravityCourse } from './gravity';

import { requireUnfrozen } from './temporal-facilities';
import { compactTransitMultiplier } from './compact';
import { afterWork } from './opening-clock';
import { stationCourse } from './drift';
import { mechanicsVersion } from './rules';
import { nearestImage, worldDistance, wrappedBounds, wrapPoint } from './geometry';
import type { Faction, Fleet, Game } from './simulation';
import { flightDeparture, fleetPosition, type Point } from './flight';
import { restoreControl, type Specialist } from './specialists';
import { refreshUnitEffects, specialistSpeed, withUnitEffects } from './specialist-effects';

export function sendUnitsHome(game: Game, point: Point, owner: Faction, units: Specialist[], mission?: 'interception'): Fleet | undefined {
  if (!units.length) return;
  const home = game.rocks.filter(r => r.owner === owner && !r.destroyed).sort((a, b) => worldDistance(game, a, point) - worldDistance(game, b, point) || a.id.localeCompare(b.id))[0];
  if (!home) return;
  const speed = specialistSpeed(game, owner, units, true, mission === 'interception' ? 'interception-return' : 'return');
  const fleet: Fleet = { id: game.nextId++, owner, from: home.id, to: home.id, drones: 0, specialists: units, speed, ...(compactTransitMultiplier(game) === 1.5 ? { thrust: 1.5 as const } : {}),
    route: { from: wrappedBounds(game) ? wrapPoint(game, point) : { ...point }, to: nearestImage(game, wrapPoint(game, point), home) }, departed: game.hour, arrives: afterWork(game, game.hour, Math.max(1e-6, worldDistance(game, point, home) / speed)), returning: true, ...(mission === 'interception' && mechanicsVersion(game) >= 3 ? { interceptionReturn: true } : {}) };
  const curved = gravityCourse(game, point, home, speed, game.hour, owner);
  if (curved) Object.assign(fleet, curved);
  if (home.drift) Object.assign(fleet, stationCourse(game, point, home, speed, game.hour));
  game.fleets.push(fleet);
  return fleet;
}
export function releaseSpecialist(input: Game, owner: Faction, id: string): Game {
  if (input.version !== 2 || input.winner || input.draw || input.eliminated.includes(owner)) throw new Error('This intelligence can no longer release modules.');
  const game = withUnitEffects(input);
  const site = game.rocks.find(r => r.owner === owner && r.specialists?.some(u => u.id === id && u.captive));
  const unit = site?.specialists?.find(u => u.id === id);
  if (!site || !unit || !game.rocks.some(r => r.owner === unit.owner && !r.destroyed)) throw new Error('Choose a captive module with a friendly site to return to.');
  requireUnfrozen(game, site);
  site.specialists = site.specialists!.filter(u => u.id !== id);
  restoreControl(game, unit, unit.owner);
  sendUnitsHome(game, site, unit.owner, [unit]);
  game.events.unshift({ hour: game.hour, audience: [...new Set([owner, unit.owner])], message: `${site.name}: captive module released and returning home.` });
  if (mechanicsVersion(game) >= 11) refreshUnitEffects(game);
  return game;
}
export function returnHauler(game: Game, fleet: Fleet, locked = false): void {
  const point = fleetPosition(game, fleet);
  const home = game.rocks.filter(r => r.owner === fleet.owner && !r.destroyed).sort((a, b) => worldDistance(game, a, point) - worldDistance(game, b, point) || a.id.localeCompare(b.id))[0];
  if (!home) { game.fleets = game.fleets.filter(f => f.id !== fleet.id); return; }
  const interception = !!fleet.intercept || !!fleet.interceptionReturn;
  const speed = specialistSpeed(game, fleet.owner, fleet.specialists ?? [], true, interception ? 'interception-return' : 'return');
  fleet.from = home.id; fleet.to = home.id; fleet.route = { from: point, to: nearestImage(game, point, home) };
  fleet.departed = game.hour; fleet.arrives = afterWork(game, flightDeparture(fleet), Math.max(1e-6, worldDistance(game, point, home) / speed));
  const curved = gravityCourse(game, point, home, speed, flightDeparture(fleet), fleet.owner);
  if (curved) Object.assign(fleet, curved);
  if (home.drift) Object.assign(fleet, stationCourse(game, point, home, speed, flightDeparture(fleet)));
  fleet.returning = true; fleet.speed = speed;
  if (compactTransitMultiplier(game) === 1.5) fleet.thrust = 1.5; else delete fleet.thrust;
  if (interception && mechanicsVersion(game) >= 3) fleet.interceptionReturn = true; else delete fleet.interceptionReturn;
  if (locked) fleet.courseLocked = true;
  delete fleet.intercept; delete fleet.preparing;
  delete fleet.pendingCourse;
  delete fleet.courseChanged;
}
