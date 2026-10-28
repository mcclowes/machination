/** Gift orders with contact-time ownership in new operations and legacy launch-time support. */
import { dispatch, FACTIONS, type Faction, type Game } from './simulation';
import { inRange, observers, sensors } from './sensors';
import { recentEvents } from './events';
export function giftTransfer(game: Game, fromId: string, toId: string, drones: number, donor: Faction, recipient: Faction, carryModule = false): Game {
  if (!Object.hasOwn(FACTIONS, recipient) || recipient === donor || game.eliminated.includes(recipient)) throw new Error('Choose another operational intelligence.');
  const destination = game.rocks.find(r => r.id === toId);
  if (!destination || game.version === 1 && (!inRange(sensors(game, donor), destination) || destination.owner !== recipient)) throw new Error('Choose an observed rock controlled by the recipient.');
  const launched = dispatch(game, fromId, toId, drones, donor, carryModule);
  if (game.version === 2) return { ...launched, fleets: launched.fleets.map(f => f.id === game.nextId ? { ...f, giftAt: f.departed } : f) };
  const source = game.rocks.find(r => r.id === fromId)!;
  return { ...launched,
    fleets: launched.fleets.map(f => f.id === game.nextId ? { ...f, owner: recipient } : f),
    events: recentEvents([{ hour: game.hour, audience: [...new Set([donor, recipient, ...observers(game, source)])],
      message: `${FACTIONS[donor].name} gifted ${drones} drones${carryModule ? ' and a module' : ''} to ${FACTIONS[recipient].name}, bound for ${destination.name}. Ownership transferred at launch.` }, ...game.events]),
  };
}

export function markGift(game: Game, id: number, owner: Faction): Game {
  const fleet = game.fleets.find(f => f.id === id && f.owner === owner);
  if (game.version !== 2 || game.winner || game.eliminated.includes(owner) || !fleet || fleet.giftAt !== undefined) throw new Error('Choose one of your ordinary haulers.');
  return { ...game, fleets: game.fleets.map(f => f.id === id ? { ...f, giftAt: game.hour + 1 / 6 } : f), events: recentEvents([{ hour: game.hour, audience: [owner], message: 'Gift ordered; you have ten minutes to cancel it.' }, ...game.events]) };
}
export function cancelGift(game: Game, id: number, owner: Faction): Game {
  const fleet = game.fleets.find(f => f.id === id && f.owner === owner);
  if (game.version !== 2 || game.winner || game.eliminated.includes(owner) || !fleet || fleet.giftAt === undefined || game.hour >= fleet.giftAt) throw new Error('The gift order is already active or no longer available.');
  return { ...game, fleets: game.fleets.map(f => { if (f.id !== id) return f; const changed = { ...f }; delete changed.giftAt; return changed; }) };
}
