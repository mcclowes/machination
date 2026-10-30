/**
 * ---
 * purpose: Retain each observer's recent telemetry without letting unseen activity evict its history.
 * ---
 */
import { ALL_PLAYERS } from './players';
import type { Faction } from './simulation';
export type ObservedEvent = { hour: number; message: string; battle?: { x: number; y: number } };
export type GameEvent = ObservedEvent & { audience?: Faction[]; unresolvedDestination?: string; unresolvedInterception?: boolean };
export const EVENTS_PER_OBSERVER = 80;
export const MAX_STORED_EVENTS = EVENTS_PER_OBSERVER * (ALL_PLAYERS.length + 1);
export function recentEvents(events: GameEvent[]): GameEvent[] {
  const counts = new Map<Faction | 'legacy', number>();
  return events.filter(event => {
    const audience: (Faction | 'legacy')[] = event.audience?.length ? event.audience : ['legacy'];
    if (!audience.some(f => (counts.get(f) ?? 0) < EVENTS_PER_OBSERVER)) return false;
    for (const faction of audience) counts.set(faction, (counts.get(faction) ?? 0) + 1);
    return true;
  });
}
