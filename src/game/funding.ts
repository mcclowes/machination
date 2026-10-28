/**
 * ---
 * purpose: Free diplomatic support gated by cargo lead, with automatic withdrawal and scoped identities.
 * ---
 */
import type { Faction, Game } from './simulation';
import { recentEvents } from './events';
export type Funding = { from: Faction; to: Faction };
export const FUNDING_LEAD = 20;
export const FUNDING_POWER = 50;
export const FUNDING_OUTPUT = 2;
const factions: Faction[] = ['you', 'vesper', 'null'];
export function eligibleFunding(game: Pick<Game, 'version' | 'cargo' | 'eliminated'>, from: Faction, to: Faction): boolean {
  return game.version === 2 && factions.includes(from) && factions.includes(to) && from !== to && !game.eliminated.includes(from) && !game.eliminated.includes(to) && game.cargo[from] - game.cargo[to] >= FUNDING_LEAD;
}
export function fundingCount(game: { funding?: Funding[] }, owner: Faction): number { return (game.funding ?? []).filter(f => f.to === owner).length; }
export function setFunding(game: Game, from: Faction, to: Faction, enabled: boolean): Game {
  if (game.version !== 2 || game.winner || game.draw || game.eliminated.includes(from) || !factions.includes(to) || from === to || typeof enabled !== 'boolean') throw new Error('Choose another active intelligence to fund.');
  if (enabled && !eligibleFunding(game, from, to)) throw new Error('Funding requires a cargo lead of at least 20 and two active intelligences.');
  const exists = game.funding?.some(f => f.from === from && f.to === to) ?? false;
  if (enabled === exists) return game;
  return { ...game, funding: enabled ? [...(game.funding ?? []), { from, to }] : (game.funding ?? []).filter(f => f.from !== from || f.to !== to),
    events: recentEvents([{ hour: game.hour, audience: [from, to], message: `${from} ${enabled ? 'began funding' : 'withdrew funding from'} ${to}.` }, ...game.events]),
  };
}
export function reconcileFunding(game: Game): void {
  if (!game.funding) return;
  game.funding = game.funding.filter(f => {
    if (eligibleFunding(game, f.from, f.to)) return true;
    game.events.unshift({ hour: game.hour, audience: [f.from, f.to], message: `Funding from ${f.from} to ${f.to} ended: cargo lead or operational requirements no longer met.` });
    return false;
  });
}
