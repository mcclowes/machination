/**
 * ---
 * purpose: Ten-minute launch preparation, manifest editing, cancellation, and public departure telemetry.
 * ---
 */
import { afterWork } from './opening-clock';
import { stationCourse } from './drift';
import { worldDistance } from './geometry';
import type { Faction, Fleet, Game } from './simulation';
import { recentEvents } from './events';
import { observers } from './sensors';
import { cancelCourse, changeCourse } from './specialist-navigation';
import { manifestUnits } from './specialists';
import { specialistSpeed, withUnitEffects } from './specialist-effects';
import { cancelGift, markGift } from './gifts';

export const LAUNCH_PREPARATION = 1 / 6;
export type HaulerChange = { fleet: number } & ({ action: 'cancel-launch' | 'gift' | 'cancel-gift' | 'cancel-course' } | { action: 'edit-launch'; drones: number; specialists?: string[] } | { action: 'course'; to: string });
export function commandHauler(game: Game, owner: Faction, command: HaulerChange): Game {
  switch (command.action) {
    case 'cancel-launch': return cancelLaunch(game, command.fleet, owner);
    case 'edit-launch': return editLaunch(game, command.fleet, owner, command.drones, command.specialists);
    case 'cancel-course': return cancelCourse(game, command.fleet, owner);
    case 'course': return changeCourse(game, command.fleet, owner, command.to);
    case 'gift': return markGift(game, command.fleet, owner);
    case 'cancel-gift': return cancelGift(game, command.fleet, owner);
    default: throw new Error('Unknown hauler command.');
  }
}
function preparation(game: Game, id: number, owner: Faction): Fleet {
  const fleet = game.fleets.find(f => f.id === id && f.owner === owner);
  if (game.version !== 2 || game.winner || game.draw || game.eliminated.includes(owner) || !fleet?.preparing || fleet.departed <= game.hour) throw new Error('This launch has departed or is no longer editable.');
  if (game.rocks.find(r => r.id === fleet.from)?.owner !== owner) throw new Error('The departure rock is no longer controlled.');
  return fleet;
}
export function cancelLaunch(game: Game, id: number, owner: Faction): Game {
  const fleet = preparation(game, id, owner);
  const rock = game.rocks.find(r => r.id === fleet.from)!;
  if (fleet.module && rock.module) throw new Error('Free the departure module bay before canceling this loaded launch.');
  return { ...game, fleets: game.fleets.filter(f => f.id !== id),
    rocks: game.rocks.map(r => r.id === rock.id ? { ...r, drones: r.drones + fleet.drones, specialists: [...(r.specialists ?? []), ...(fleet.specialists ?? [])], ...(fleet.module ? { module: fleet.module } : {}) } : r),
    events: recentEvents([{ hour: game.hour, audience: [owner], message: `${rock.name}: launch canceled; manifest returned to station.` }, ...game.events]),
  };
}
export function editLaunch(game: Game, id: number, owner: Faction, drones: number, specialists?: string[]): Game {
  const fleet = preparation(game, id, owner);
  const rock = game.rocks.find(r => r.id === fleet.from)!;
  const available = { ...rock, specialists: [...(rock.specialists ?? []), ...(fleet.specialists ?? [])] };
  const units = manifestUnits(available, owner, specialists ?? (fleet.specialists ?? []).map(u => u.id));
  if (!Number.isSafeInteger(drones) || drones < (units.length ? 0 : 1) || drones > rock.drones + fleet.drones) throw new Error('Drone count exceeds the available launch inventory.');
  if (fleet.intercept && !units.some(u => u.kind === 'pirate')) throw new Error('Keep a scavenger rig in an interception manifest.');
  const selected = new Set(units.map(u => u.id));
  const target = game.rocks.find(r => r.id === fleet.to)!;
  const speed = specialistSpeed(game, owner, units, target.owner === owner, fleet.intercept ? 'intercept' : undefined);
  const course = !fleet.intercept && (rock.drift || target.drift) ? stationCourse(game, rock, target, speed, fleet.departed) : undefined;
  const changed = { ...fleet, drones, specialists: units, speed, ...(course ? course : {}), ...(fleet.intercept ? {} : { arrives: course?.arrives ?? afterWork(game, fleet.departed, Math.max(1e-6, worldDistance(game, rock, target) / speed)) }) };
  return withUnitEffects({ ...game, fleets: game.fleets.map(f => f.id === id ? changed : f), rocks: game.rocks.map(r => r.id === rock.id ? { ...r, drones: r.drones + fleet.drones - drones, specialists: available.specialists.filter(u => !selected.has(u.id)) } : r) });
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
    rock.specialists = [...(rock.specialists ?? []), ...(fleet.specialists ?? [])];
    if (fleet.module && !rock.module) rock.module = fleet.module;
    game.events.unshift({ hour: game.hour, audience: [fleet.owner], message: `${rock.name}: combat canceled a preparing launch; its drones defend the site.` });
  }
  game.fleets = game.fleets.filter(f => !launches.includes(f));
}
