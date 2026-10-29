/**
 * ---
 * purpose: Choose music from conflicts visible to the live player, without forecasting hidden state.
 * ---
 */
import type { Faction } from '../game/players';
import type { Fleet, Rock } from '../game/simulation';
import type { GameView } from '../game/visibility';
import { encounterHour } from '../game/route-encounters';

export type MusicTension = 'calm' | 'moderate' | 'tense';
type MusicRock = Pick<Rock, 'id' | 'x' | 'y'> & Partial<Pick<Rock, 'owner' | 'drones' | 'shield' | 'specialists'>> & { known?: boolean };
export type MusicView = Pick<GameView, 'hour' | 'rules' | 'version' | 'fleets' | 'winner' | 'draw' | 'eliminated'> & { rocks: MusicRock[] };
export const MODERATE_HOURS = 6;
export const IMMINENT_HOURS = 1;
const giftedBy = (fleet: Fleet, hour: number) => fleet.giftAt !== undefined && fleet.giftAt <= hour;

export function musicTension(view: MusicView | undefined, player: Faction | undefined): MusicTension | null {
  if (!view || !player) return null;
  if (view.winner || view.draw || view.eliminated.includes(player)) return 'calm';
  let nextBattle = Infinity;
  for (const fleet of view.fleets) {
    if (fleet.arrives < view.hour || giftedBy(fleet, fleet.arrives)) continue;
    if (fleet.intercept) {
      const target = view.fleets.find(f => f.id === fleet.intercept!.target);
      if (target && target.owner !== fleet.owner && (fleet.owner === player || target.owner === player) && !giftedBy(target, fleet.arrives)) nextBattle = Math.min(nextBattle, fleet.arrives);
      continue;
    }
    const destination = view.rocks.find(r => r.id === fleet.to);
    if (!destination || destination.known === false || destination.owner === fleet.owner) continue;
    const incoming = destination.owner === player;
    const attacking = fleet.owner === player && (destination.owner || (destination.drones ?? 0) > 0 || (destination.shield ?? 0) > 0 || destination.specialists?.some(u => !u.captive));
    if (incoming || attacking) nextBattle = Math.min(nextBattle, fleet.arrives);
  }
  if (view.version === 2) for (let i = 0; i < view.fleets.length; i++) for (let j = i + 1; j < view.fleets.length; j++) {
    const a = view.fleets[i]!, b = view.fleets[j]!;
    if (a.owner !== player && b.owner !== player) continue;
    // Legacy observations can omit a route endpoint; never infer an unseen contact.
    if ([a, b].some(f => !f.route && (!view.rocks.some(r => r.id === f.from) || !view.rocks.some(r => r.id === f.to)))) continue;
    const hour = encounterHour(view, a, b);
    if (hour >= view.hour && !giftedBy(a, hour) && !giftedBy(b, hour)) nextBattle = Math.min(nextBattle, hour);
  }
  const remaining = nextBattle - view.hour;
  return remaining <= IMMINENT_HOURS ? 'tense' : remaining <= MODERATE_HOURS ? 'moderate' : 'calm';
}
