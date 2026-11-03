/**
 * ---
 * purpose: Choose the single most significant sound cue for a change between two observed views.
 * ---
 */
import { allied, type TeamWorld } from '../game/teams';
import type { Faction } from '../game/players';

/** Controls: tap, select, back, confirm, time. Everything else answers a change in the operation. */
export type SoundCue =
  | 'tap' | 'select' | 'back' | 'confirm' | 'time'
  | 'launch' | 'schedule' | 'cancel' | 'signal' | 'combat' | 'capture' | 'loss' | 'alarm' | 'victory' | 'defeat' | 'error'
  | 'build' | 'recruit' | 'shield' | 'pulse' | 'council' | 'intel' | 'gift' | 'message';
type Owned = { owner?: Faction | null };
export type CueView = TeamWorld & {
  epoch: number; rocks: Owned[]; fleets: Owned[]; scheduled: Owned[];
  events: { hour: number; message: string }[]; eliminated: Faction[]; winner: Faction | null;
};

const ALARM = /core (lost|destroyed)|king's pulse detected|king eliminated|absorbing a hostile pulse|pulse shield collapsed|uplink lost/i;
const COMBAT = /destroy|neutraliz|assimilat|detonat|combat|sentry fire|encounter/i;
// Ordered by significance; the first matching telemetry line chooses the cue.
const TELEMETRY: [RegExp, SoundCue][] = [
  [/tactical pulse|disruptor charging|king's pulse/i, 'pulse'],
  [/recruited|promoted to/i, 'recruit'],
  [/constructed for|mine drilled/i, 'build'],
  [/shields? (enabled|disabled)/i, 'shield'],
  [/gifted|funding/i, 'gift'],
  [/belt council/i, 'council'],
  [/^(foresight|hindsight):/i, 'intel'],
  [/canceled|aborted|recycled/i, 'cancel'],
];

function newEvents(previous: CueView['events'], next: CueView['events']) {
  const head = previous[0];
  if (!head) return next;
  const seen = next.findIndex(e => e.hour === head.hour && e.message === head.message);
  return seen === -1 ? next : next.slice(0, seen);
}
const count = (items: Owned[], player: Faction) => items.filter(item => item.owner === player).length;
const defeated = (view: CueView, player: Faction) => (!!view.winner && !allied(view, view.winner, player)) || view.eliminated.includes(player);

export function cueForUpdate(previous: CueView | undefined, next: CueView, player: Faction): SoundCue | null {
  if (!previous || previous.epoch !== next.epoch) return null;
  if (next.winner && allied(next, next.winner, player) && (!previous.winner || !allied(previous, previous.winner, player))) return 'victory';
  if (defeated(next, player) && !defeated(previous, player)) return 'defeat';
  const territory = count(next.rocks, player) - count(previous.rocks, player);
  if (territory > 0) return 'capture';
  if (territory < 0) return 'loss';
  const events = newEvents(previous.events, next.events);
  if (events.some(e => ALARM.test(e.message))) return 'alarm';
  if (events.some(e => COMBAT.test(e.message))) return 'combat';
  const launched = count(next.fleets, player) > count(previous.fleets, player);
  if (launched) return 'launch';
  const scheduled = count(next.scheduled, player) - count(previous.scheduled, player);
  if (scheduled > 0) return 'schedule';
  for (const [pattern, cue] of TELEMETRY) if (events.some(e => pattern.test(e.message))) return cue;
  if (scheduled < 0) return 'cancel';
  return events.length ? 'signal' : null;
}

type Transmissions = { faction: Faction; messages: { from: Faction }[]; channels?: { messages: { from: Faction }[] }[] };
/** Messages other operators have sent this seat, across direct and channel traffic. */
export function incomingTransmissions({ faction, messages, channels = [] }: Transmissions) {
  return messages.filter(m => m.from !== faction).length
    + channels.reduce((sum, channel) => sum + channel.messages.filter(m => m.from !== faction).length, 0);
}
