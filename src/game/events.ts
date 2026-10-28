/**
 * ---
 * purpose: Retain each observer's recent telemetry without letting unseen activity evict its history.
 * ---
 */
import type { Faction } from './simulation';
export type GameEvent = { hour: number; message: string; audience?: Faction[]; unresolvedDestination?: string; unresolvedInterception?: boolean };
export const EVENTS_PER_OBSERVER = 80;
export const MAX_STORED_EVENTS = EVENTS_PER_OBSERVER * 4;
export function recentEvents(events: GameEvent[]): GameEvent[] {
  const counts: Record<Faction | 'legacy', number> = { you: 0, vesper: 0, null: 0, legacy: 0 };
  return events.filter(event => {
    const audience: (Faction | 'legacy')[] = event.audience?.length ? event.audience : ['legacy'];
    if (!audience.some(f => counts[f] < EVENTS_PER_OBSERVER)) return false;
    for (const faction of audience) counts[faction]++;
    return true;
  });
}
