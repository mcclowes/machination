import { ALLEGIANCES, type Allegiance } from './factions';
import { withUnitEffects } from './specialist-effects';
import type { Faction, Game } from './simulation';

export function factionOpening(game: Game, members: readonly { player: Faction; faction: Allegiance }[]): Game {
  if (game.version !== 2 || game.hour !== 0) throw new Error('Faction mode needs a new operation.');
  const result = { ...game, rocks: game.rocks.map(r => ({ ...r, specialists: [...(r.specialists ?? [])] })) };
  for (const { player, faction } of members) {
    const home = result.rocks.find(r => r.owner === player && r.specialists.some(u => u.owner === player && u.kind === 'queen' && !u.captive));
    if (!home) throw new Error('Faction mode needs a starting core for every player.');
    home.specialists.push({ id: `faction-${player}`, owner: player, kind: ALLEGIANCES[faction].elite });
  }
  return withUnitEffects(result);
}
