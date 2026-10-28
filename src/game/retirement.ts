/**
 * ---
 * purpose: Voluntary and simultaneous inactive retirement without deleting surviving assets.
 * ---
 */
import { playersIn } from './players';
import { advance, FACTIONS, type Faction, type Game } from './simulation';
import { defendWithPreparations } from './transport';
import { reconcileFunding } from './funding';
import { recentEvents } from './events';
export const INACTIVITY_HOURS = 48;
export const HOUR_MS = 3_600_000;
function retire(input: Game, owners: readonly Faction[], reason: 'resigned' | 'inactive'): Game {
  if (input.version !== 2 || input.winner || input.draw || !owners.length || new Set(owners).size !== owners.length || owners.some(owner => !playersIn(input).includes(owner) || input.eliminated.includes(owner))) throw new Error('Choose an active intelligence in an unfinished operation.');
  const game = advance(input, input.hour, { rivals: false });
  for (const owner of owners) {
    game.eliminated.push(owner); game.cargo[owner] = 0;
    game.scheduled = (game.scheduled ?? []).filter(p => p.owner !== owner);
    for (const rock of game.rocks.filter(r => r.owner === owner)) defendWithPreparations(game, rock.id);
    game.events.unshift({ hour: game.hour, audience: [...playersIn(game)], message: `${FACTIONS[owner].name}: ${reason === 'inactive' ? 'automatically resigned after 48 hours of inactivity' : 'resigned'}. Orders and extraction terminated; remaining assets persist.` });
  }
  reconcileFunding(game);
  const remaining = playersIn(game).filter(owner => !game.eliminated.includes(owner));
  if (remaining.length === 1) {
    game.winner = remaining[0]!;
    game.events.unshift({ hour: game.hour, audience: [...playersIn(game)], message: `${FACTIONS[game.winner].name}: last operational intelligence. Contract complete.` });
  } else if (!remaining.length) {
    game.draw = true;
    game.events.unshift({ hour: game.hour, audience: [...playersIn(game)], message: 'All intelligences retired. The operation ended in a draw.' });
  }
  if (game.winner || game.draw) game.scheduled = [];
  game.events = recentEvents(game.events);
  return game;
}
export function resign(game: Game, owner: Faction): Game { return retire(game, [owner], 'resigned'); }
/** The server owns inactivity deadlines; retire all seats due at the same instant together. */
export function resignInactive(game: Game, owners: readonly Faction[]): Game { return retire(game, owners, 'inactive'); }
