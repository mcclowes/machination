/**
 * ---
 * purpose: Server-only detection of newly observable hostile incoming haulers, and their fresh notification text.
 * related:
 *   - ./notifications.ts - per-seat ledger and typed incoming jobs
 *   - ../src/game/sensors.ts - the observation rule these alerts never exceed
 * ---
 */
import { canObserveHauler } from '../src/game/sensors';
import { observe } from '../src/game/visibility';
import { FACTIONS } from '../src/game/players';
import { inactivityRemaining } from '../src/game/retirement';
import type { Faction, Fleet, Game } from '../src/game/simulation';
import { HOUR_MS } from '../src/game/retirement';

/** Owner and target are part of the key, so ownership changes and redirects count as new threats. */
export const threatKey = (fleet: Fleet) => `${fleet.id}|${fleet.owner}|${fleet.intercept ? `i:${fleet.intercept.target}` : `r:${fleet.to}`}`;

/**
 * Foreign haulers this seat currently observes as attacks on its sites or haulers.
 * Preparations, active gifts, nearby traffic, and finished or eliminated seats are excluded.
 */
export function hostileIncoming(game: Game, faction: Faction): Map<string, Fleet> {
  const threats = new Map<string, Fleet>();
  if (game.version !== 2 || game.winner || game.draw || game.eliminated.includes(faction)) return threats;
  for (const fleet of game.fleets) {
    if (fleet.owner === faction || fleet.preparing || fleet.giftAt !== undefined && fleet.giftAt <= game.hour) continue;
    const targeted = fleet.intercept
      ? fleet.intercept.target !== undefined && game.fleets.some(t => t.id === fleet.intercept!.target && t.owner === faction)
      : game.rocks.some(r => r.id === fleet.to && r.owner === faction);
    if (targeted && canObserveHauler(game, faction, fleet)) threats.set(threatKey(fleet), fleet);
  }
  return threats;
}

/** Text from the seat's own observation at claim time; undefined when the threat is no longer current. */
export function incomingBody(game: Game, startedAt: number, faction: Faction, alert: { fleet: number; key: string }, now: number): string | undefined {
  const threat = hostileIncoming(game, faction).get(alert.key);
  const contact = observe(game, faction).fleets.find(f => f.id === alert.fleet);
  if (!threat || !contact || contact.owner === faction) return undefined;
  const arrivesAt = startedAt + contact.arrives * HOUR_MS;
  if (arrivesAt <= now) return undefined;
  const from = FACTIONS[contact.owner].name;
  const drones = `${contact.drones} ${contact.drones === 1 ? 'drone' : 'drones'}`;
  const eta = inactivityRemaining(arrivesAt, now);
  return contact.intercept
    ? `Interception from ${from}: ${drones} closing on your hauler in ${eta}.`
    : `Incoming attack from ${from}: ${drones} arriving in ${eta}.`;
}
