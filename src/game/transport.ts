/**
 * ---
 * purpose: Ten-minute launch preparation, manifest editing, cancellation, and public departure telemetry.
 * ---
 */
import type { Faction, Fleet, Game } from './simulation';
import { recentEvents } from './events';
import { observers } from './sensors';
import { cancelGift, markGift } from './gifts';

export const LAUNCH_PREPARATION = 1 / 6;
export type HaulerChange = { fleet: number } & ({ action: 'cancel-launch' | 'gift' | 'cancel-gift' } | { action: 'edit-launch'; drones: number });
export function commandHauler(game: Game, owner: Faction, command: HaulerChange): Game {
  switch (command.action) {
    case 'cancel-launch': return cancelLaunch(game, command.fleet, owner);
    case 'edit-launch': return editLaunch(game, command.fleet, owner, command.drones);
    case 'gift': return markGift(game, command.fleet, owner);
    case 'cancel-gift': return cancelGift(game, command.fleet, owner);
    default: throw new Error('Unknown hauler command.');
  }
}
function preparation(game: Game, id: number, owner: Faction): Fleet {
  const fleet = game.fleets.find(f => f.id === id && f.owner === owner);
  if (game.version !== 2 || game.winner || game.eliminated.includes(owner) || !fleet?.preparing || fleet.departed <= game.hour) throw new Error('This launch has departed or is no longer editable.');
  if (game.rocks.find(r => r.id === fleet.from)?.owner !== owner) throw new Error('The departure rock is no longer controlled.');
  return fleet;
}
export function cancelLaunch(game: Game, id: number, owner: Faction): Game {
  const fleet = preparation(game, id, owner);
  const rock = game.rocks.find(r => r.id === fleet.from)!;
  if (fleet.module && rock.module) throw new Error('Free the departure module bay before canceling this loaded launch.');
  return { ...game, fleets: game.fleets.filter(f => f.id !== id),
    rocks: game.rocks.map(r => r.id === rock.id ? { ...r, drones: r.drones + fleet.drones, ...(fleet.module ? { module: fleet.module } : {}) } : r),
    events: recentEvents([{ hour: game.hour, audience: [owner], message: `${rock.name}: launch canceled; manifest returned to station.` }, ...game.events]),
  };
}
export function editLaunch(game: Game, id: number, owner: Faction, drones: number): Game {
  const fleet = preparation(game, id, owner);
  const rock = game.rocks.find(r => r.id === fleet.from)!;
  if (!Number.isSafeInteger(drones) || drones < 1 || drones > rock.drones + fleet.drones) throw new Error('Drone count exceeds the available launch inventory.');
  return { ...game, fleets: game.fleets.map(f => f.id === id ? { ...f, drones } : f), rocks: game.rocks.map(r => r.id === rock.id ? { ...r, drones: r.drones + fleet.drones - drones } : r) };
}
export function completePreparations(game: Game): void {
  for (const fleet of game.fleets) {
    if (!fleet.preparing || fleet.departed > game.hour) continue;
    delete fleet.preparing;
    const rock = game.rocks.find(r => r.id === fleet.from)!;
    game.events.unshift({ hour: game.hour, audience: [...new Set([fleet.owner, ...observers(game, rock)])], message: `${rock.name}: hauler departed with ${fleet.drones} drones.` });
  }
}
export function defendWithPreparations(game: Game, rockId: string): void {
  const rock = game.rocks.find(r => r.id === rockId)!;
  const launches = game.fleets.filter(f => f.preparing && f.from === rockId);
  for (const fleet of launches) {
    rock.drones += fleet.drones;
    if (fleet.module && !rock.module) rock.module = fleet.module;
    game.events.unshift({ hour: game.hour, audience: [fleet.owner], message: `${rock.name}: combat canceled a preparing launch; its drones defend the site.` });
  }
  game.fleets = game.fleets.filter(f => !launches.includes(f));
}
