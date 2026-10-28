/** Launch irrevocable support under the recipient's ownership and sensor policy. */
import { dispatch, FACTIONS, type Faction, type Game } from './simulation';
import { inRange, observers, sensors } from './sensors';
import { recentEvents } from './events';
export function giftTransfer(game: Game, fromId: string, toId: string, drones: number, donor: Faction, recipient: Faction, carryModule = false): Game {
  if (!Object.hasOwn(FACTIONS, recipient) || recipient === donor || game.eliminated.includes(recipient)) throw new Error('Choose another operational intelligence.');
  const destination = game.rocks.find(r => r.id === toId);
  if (!destination || !inRange(sensors(game, donor), destination) || destination.owner !== recipient) throw new Error('Choose an observed rock controlled by the recipient.');
  const launched = dispatch(game, fromId, toId, drones, donor, carryModule);
  const source = game.rocks.find(r => r.id === fromId)!;
  return { ...launched,
    fleets: launched.fleets.map(f => f.id === game.nextId ? { ...f, owner: recipient } : f),
    events: recentEvents([{ hour: game.hour, audience: [...new Set([donor, recipient, ...observers(game, source)])],
      message: `${FACTIONS[donor].name} gifted ${drones} drones${carryModule ? ' and a module' : ''} to ${FACTIONS[recipient].name}, bound for ${destination.name}. Ownership transferred at launch.` }, ...game.events]),
  };
}
