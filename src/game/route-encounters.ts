/**
 * ---
 * purpose: Exact encounters between opposing ordinary haulers traveling the same outpost route.
 * ---
 */
import type { Faction, Fleet, Game } from './simulation';
import { fleetPosition, transferDuration } from './flight';
import { observers } from './sensors';
import { BLAST_MULTIPLIER, CONVERSION_FRACTION, CONVERSION_LIMIT, SALVAGE_FRACTION } from './modules';

const CONTACT_TOLERANCE = 1e-9;
function encounterHour(a: Fleet, b: Fleet): number {
  if (a.owner === b.owner || a.preparing || b.preparing || a.route || b.route || a.from !== b.to || a.to !== b.from) return Infinity;
  const ta = a.arrives - a.departed; const tb = b.arrives - b.departed;
  const hour = (1 + a.departed / ta + b.departed / tb) / (1 / ta + 1 / tb);
  return hour >= Math.max(a.departed, b.departed) && hour < Math.min(a.arrives, b.arrives) - CONTACT_TOLERANCE ? hour : Infinity;
}
export function nextRouteEncounter(game: Game): number {
  let next = Infinity;
  for (let i = 0; i < game.fleets.length; i++) for (let j = i + 1; j < game.fleets.length; j++) {
    const hour = encounterHour(game.fleets[i]!, game.fleets[j]!);
    if (hour > game.hour + CONTACT_TOLERANCE) next = Math.min(next, hour);
  }
  return next;
}
export function resolveRouteEncounters(game: Game): void {
  const ordered = [...game.fleets].sort((a, b) => a.id - b.id);
  for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
    const a = game.fleets.find(f => f.id === ordered[i]!.id); const b = game.fleets.find(f => f.id === ordered[j]!.id);
    if (!a || !b || Math.abs(encounterHour(a, b) - game.hour) > CONTACT_TOLERANCE) continue;
    const audience = [...new Set([a.owner, b.owner, ...observers(game, fleetPosition(game, a))])];
    const giftA = a.giftAt !== undefined && a.giftAt <= game.hour;
    const giftB = b.giftAt !== undefined && b.giftAt <= game.hour;
    if (giftA || giftB) {
      const ownerA = a.owner; const ownerB = b.owner;
      if (giftA) deliverGift(game, a, ownerB);
      if (giftB) deliverGift(game, b, ownerA);
      game.events.unshift({ hour: game.hour, audience, message: 'Gift accepted in transit; received manifest routed to friendly territory.' });
      continue;
    }
    let first = a.drones; let second = b.drones;
    if (a.module === 'charge' || b.module === 'charge') {
      if (a.module === 'charge' && b.module === 'charge') { first = 0; second = 0; }
      else if (a.module === 'charge') { first = 0; second = Math.max(0, b.drones - a.drones * BLAST_MULTIPLIER); }
      else { second = 0; first = Math.max(0, a.drones - b.drones * BLAST_MULTIPLIER); }
    } else {
      const convertedA = a.module === 'virus' ? Math.min(CONVERSION_LIMIT, Math.floor(b.drones * CONVERSION_FRACTION)) : 0;
      const convertedB = b.module === 'virus' ? Math.min(CONVERSION_LIMIT, Math.floor(a.drones * CONVERSION_FRACTION)) : 0;
      first += convertedA - convertedB; second += convertedB - convertedA;
      const losses = Math.min(first, second);
      first -= losses; second -= losses;
    }
    a.drones = first + (first > 0 && a.module === 'scavenger' ? Math.floor((a.drones - first) * SALVAGE_FRACTION) : 0);
    b.drones = second + (second > 0 && b.module === 'scavenger' ? Math.floor((b.drones - second) * SALVAGE_FRACTION) : 0);
    game.fleets = game.fleets.filter(f => f.drones > 0);
    game.events.unshift({ hour: game.hour, audience, message: `Haulers encountered in transit: ${a.drones} and ${b.drones} drones survived.` });
  }
}
function deliverGift(game: Game, fleet: Fleet, recipient: Faction): void {
  const point = fleetPosition(game, fleet);
  const home = game.rocks.filter(r => r.owner === recipient).sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y) || a.id.localeCompare(b.id))[0];
  fleet.owner = recipient;
  delete fleet.giftAt;
  if (!home) return;
  fleet.from = home.id; fleet.to = home.id;
  fleet.route = { from: point, to: { x: home.x, y: home.y } };
  fleet.departed = game.hour; fleet.arrives = game.hour + transferDuration(point, home, fleet.module, game.version); fleet.returning = true;
}
