/**
 * ---
 * purpose: Choose the single most significant sound cue for a change between two observed views.
 * ---
 */
import type { Faction } from '../game/players';

export type SoundCue = 'tap' | 'launch' | 'schedule' | 'signal' | 'combat' | 'capture' | 'loss' | 'alarm' | 'victory' | 'defeat' | 'error';
type Owned = { owner?: Faction | null };
export type CueView = {
  epoch: number; rocks: Owned[]; fleets: Owned[]; scheduled: Owned[];
  events: { hour: number; message: string }[]; eliminated: Faction[]; winner: Faction | null;
};

const CORE_LOST = /core (lost|destroyed)/i;
const COMBAT = /destroy|neutraliz|assimilat|detonat|combat|sentry fire|encounter/i;

function newEvents(previous: CueView['events'], next: CueView['events']) {
  const head = previous[0];
  if (!head) return next;
  const seen = next.findIndex(e => e.hour === head.hour && e.message === head.message);
  return seen === -1 ? next : next.slice(0, seen);
}
const count = (items: Owned[], player: Faction) => items.filter(item => item.owner === player).length;
const defeated = (view: CueView, player: Faction) => (!!view.winner && view.winner !== player) || view.eliminated.includes(player);

export function cueForUpdate(previous: CueView | undefined, next: CueView, player: Faction): SoundCue | null {
  if (!previous || previous.epoch !== next.epoch) return null;
  if (next.winner === player && previous.winner !== player) return 'victory';
  if (defeated(next, player) && !defeated(previous, player)) return 'defeat';
  const territory = count(next.rocks, player) - count(previous.rocks, player);
  if (territory > 0) return 'capture';
  if (territory < 0) return 'loss';
  const events = newEvents(previous.events, next.events);
  if (events.some(e => CORE_LOST.test(e.message))) return 'alarm';
  if (events.some(e => COMBAT.test(e.message))) return 'combat';
  if (count(next.fleets, player) > count(previous.fleets, player)) return 'launch';
  if (count(next.scheduled, player) > count(previous.scheduled, player)) return 'schedule';
  return events.length ? 'signal' : null;
}
