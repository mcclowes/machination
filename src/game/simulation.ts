/**
 * ---
 * purpose: Deterministic asteroid-belt economy, transfer orders, combat, and rival decisions.
 * related:
 *   - ./simulation.test.ts - behavioral scenarios
 * ---
 */
import { nextRouteEncounter, resolveRouteEncounters } from './route-encounters';
import { LAUNCH_PREPARATION, completePreparations, defendWithPreparations } from './transport';
import { absorbShields, cargoTarget, nextEconomyEvent, settleEconomy } from './economy';
import { resolveInterceptions } from './interception';
import { transferDuration, type Point } from './flight';
import type { ScheduledTransfer } from './orders';
import { recentEvents, type GameEvent } from './events';
import { observers } from './sensors';
import { MODULES, isModule, CONVERSION_FRACTION, CONVERSION_LIMIT, SALVAGE_FRACTION, BLAST_MULTIPLIER, type ModuleKind } from './modules';
export type Faction = 'you' | 'vesper' | 'null';
export type Rock = {
  id: string; name: string; x: number; y: number;
  owner: Faction | null; drones: number; kind: 'core' | 'reactor' | 'mine' | 'factory' | 'generator';
  shield?: number; shieldMax?: number; shieldAt?: number; shieldsDisabled?: boolean; productionAt?: number; miningAt?: number;
  coreOf?: Faction; module?: ModuleKind;
};
export type Fleet = { id: number; owner: Faction; from: string; to: string; drones: number; departed: number; arrives: number; preparing?: true; giftAt?: number; module?: ModuleKind; route?: { from: Point; to: Point }; intercept?: { target?: number; home: string }; returning?: true };
export type Game = {
  version: 1 | 2; hour: number; epoch: number; rocks: Rock[]; fleets: Fleet[];
  cargo: Record<Faction, number>; eliminated: Faction[]; nextId: number;
  minesDrilled?: Record<Faction, number>;
  scheduled?: ScheduledTransfer[]; events: GameEvent[]; winner: Faction | null;
};
export function operationStatus(game: Pick<Game, 'winner' | 'eliminated'>, faction: Faction): 'active' | 'victory' | 'defeat' | 'eliminated' {
  if (game.winner === faction) return 'victory';
  if (game.eliminated.includes(faction)) return 'eliminated';
  return game.winner ? 'defeat' : 'active';
}
export const FACTIONS = {
  you: { name: 'Mnemosyne', color: '#b8e986', code: 'MN' },
  vesper: { name: 'Vesper', color: '#e9a775', code: 'VS' },
  null: { name: 'Null collective', color: '#a3a1ef', code: 'NC' },
};
const LEGACY_CARGO_TARGET = 300;
const LEGACY_PRODUCTION = 4;
const LEGACY_MINING = 2;
const INVENTORY_ROUNDING_TOLERANCE = 1e-9;
function inventoryUnits(value: number): number {
  const whole = Math.round(value);
  return Math.abs(value - whole) < INVENTORY_ROUNDING_TOLERANCE ? whole : value;
}
export { createGame } from './world';
export function travelHours(from: Pick<Rock, 'x' | 'y'>, to: Pick<Rock, 'x' | 'y'>, module?: ModuleKind, version: 1 | 2 = 1): number {
  return transferDuration(from, to, module, version);
}
export function installModule(game: Game, rockId: string, kind: ModuleKind, owner: Faction): Game {
  const rock = game.rocks.find(r => r.id === rockId);
  if (game.winner || game.eliminated.includes(owner)) throw new Error('This intelligence is no longer operational.');
  if (!isModule(kind)) throw new Error('Unknown module.');
  if (!rock || rock.owner !== owner) throw new Error('Modules can only be built on a controlled rock.');
  if (rock.module) throw new Error('This rock already has a module. Load it onto a hauler to free the bay.');
  if (rock.drones < MODULES[kind].cost) throw new Error('Not enough drones to build this module.');
  return { ...game, rocks: game.rocks.map(r => r.id === rockId ? { ...r, module: kind, drones: r.drones - MODULES[kind].cost } : r),
    events: recentEvents([{ hour: game.hour, audience: observers(game, rock), message: `${rock.name}: ${MODULES[kind].name} constructed for ${MODULES[kind].cost} drones.` }, ...game.events]) };
}
export function dispatch(game: Game, fromId: string, toId: string, drones: number, owner: Faction, carryModule = false): Game {
  const from = game.rocks.find(r => r.id === fromId);
  const to = game.rocks.find(r => r.id === toId);
  if (game.winner || game.eliminated.includes(owner)) throw new Error('This intelligence is no longer operational.');
  if (!from || !to || from === to || from.owner !== owner) throw new Error('Select an owned departure rock and a different destination.');
  if (!Number.isInteger(drones) || drones < 1 || drones > from.drones) throw new Error('Drone count exceeds available inventory.');
  if (typeof carryModule !== 'boolean' || carryModule && !from.module) throw new Error('There is no module available to load.');
  const module = carryModule ? from.module : undefined;
  const departed = game.hour + (game.version === 2 ? LAUNCH_PREPARATION : 0);
  return {
    ...game, nextId: game.nextId + 1,
    rocks: game.rocks.map(r => {
      if (r.id !== fromId) return r;
      const departure = { ...r, drones: r.drones - drones };
      if (carryModule) delete departure.module;
      return departure;
    }),
    fleets: [...game.fleets, { id: game.nextId, owner, from: fromId, to: toId, drones, departed, arrives: departed + travelHours(from, to, module, game.version), ...(game.version === 2 ? { preparing: true as const } : {}), ...(module ? { module } : {}) }],
    events: recentEvents([{ hour: game.hour, audience: game.version === 2 ? [owner] : [...new Set([owner, ...observers(game, from)])], message: `${FACTIONS[owner].name}: ${drones} drones dispatched to ${to.name}.` }, ...game.events]),
  };
}
export function advance(input: Game, targetHour: number, options: { rivals?: boolean; unknownDestinations?: readonly string[]; unknownInterceptions?: readonly number[] } = {}): Game {
  if (!Number.isFinite(targetHour) || targetHour < input.hour) throw new Error('Time can only move forward.');
  let game: Game = {
    ...input, rocks: input.rocks.map(r => ({ ...r })), fleets: input.fleets.map(f => ({ ...f })),
    ...(input.scheduled ? { scheduled: input.scheduled.map(p => ({ ...p })) } : {}),
    ...(input.minesDrilled ? { minesDrilled: { ...input.minesDrilled } } : {}),
    cargo: { ...input.cargo }, eliminated: [...input.eliminated], events: input.events.map(e => ({ ...e })),
  };
  while (game.hour < targetHour && !game.winner) {
    const nextArrival = Math.min(...game.fleets.map(f => f.arrives));
    const quotaTimes = (Object.keys(FACTIONS) as Faction[]).filter(f => !game.eliminated.includes(f)).map(f => {
      if (game.version === 2) return Infinity;
      const rate = game.rocks.filter(r => r.owner === f && r.kind === 'mine').length * LEGACY_MINING;
      return rate ? game.hour + Math.max(0, LEGACY_CARGO_TARGET - game.cargo[f]) / rate : Infinity;
    });
    const next = Math.min(targetHour, game.version === 2 ? Math.min(nextEconomyEvent(game), nextRouteEncounter(game)) : Infinity, Math.floor(game.hour) + 1, nextArrival, ...game.fleets.filter(f => f.preparing).map(f => f.departed), ...quotaTimes, ...(game.scheduled ?? []).map(p => p.executeAt));
    const elapsed = next - game.hour;
    if (game.version === 1) for (const rock of game.rocks) {
      if (!rock.owner) continue;
      if (rock.kind === 'mine') {
        game.cargo[rock.owner] = inventoryUnits(game.cargo[rock.owner] + LEGACY_MINING * elapsed);
        if (game.cargo[rock.owner] >= LEGACY_CARGO_TARGET - 1e-9) game.cargo[rock.owner] = LEGACY_CARGO_TARGET;
      }
      else rock.drones = inventoryUnits(rock.drones + LEGACY_PRODUCTION * elapsed);
    }
    game.hour = next;
    if (game.version === 2) settleEconomy(game);
    if (game.version === 2) resolveRouteEncounters(game);
    resolveInterceptions(game, options.unknownInterceptions);
    const arrivals = game.fleets.filter(f => f.arrives <= next).sort((a, b) => a.id - b.id);
    game.fleets = game.fleets.filter(f => f.arrives > next);
    for (const fleet of arrivals) {
      if (game.version === 1 && game.eliminated.includes(fleet.owner)) continue;
      const rock = game.rocks.find(r => r.id === fleet.to)!;
      if (options.unknownDestinations?.includes(fleet.to)) {
        game.events.unshift({ hour: next, audience: [fleet.owner], unresolvedDestination: fleet.to, message: `${rock.name}: arrival outcome unknown outside observed territory.` });
        continue;
      }
      const audience = [...new Set([fleet.owner, ...(rock.owner ? [rock.owner] : []), ...observers(game, rock)])];
      if (game.version === 2 && fleet.giftAt !== undefined && fleet.giftAt <= game.hour && rock.owner) fleet.owner = rock.owner;
      if (rock.owner === fleet.owner) {
        rock.drones += fleet.drones;
        if (fleet.module && !rock.module) rock.module = fleet.module;
        else if (fleet.module) game.events.unshift({ hour: next, audience, message: `${rock.name}: occupied module bay; incoming ${MODULES[fleet.module].name} recycled.` });
        continue;
      }
      if (game.version === 2) defendWithPreparations(game, rock.id);
      if (fleet.module === 'charge') {
        const damage = Math.min(rock.drones, fleet.drones * BLAST_MULTIPLIER);
        rock.drones -= damage;
        game.events.unshift({ hour: next, audience, message: `${rock.name}: self-destruct charge consumed its hauler and destroyed ${Math.floor(damage)} defending drones.` });
        continue;
      }
      if (fleet.module === 'virus') {
        const converted = Math.min(CONVERSION_LIMIT, Math.floor(rock.drones * CONVERSION_FRACTION));
        rock.drones -= converted; fleet.drones += converted;
        game.events.unshift({ hour: next, audience, message: `${rock.name}: conversion virus assimilated ${converted} defending drones.` });
      }
      if (game.version === 2) fleet.drones = absorbShields(game, rock, fleet.drones);
      if (fleet.drones <= rock.drones) {
        rock.drones -= fleet.drones;
        game.events.unshift({ hour: next, audience, message: `${rock.name}: ${FACTIONS[fleet.owner].name} transfer neutralized.` });
      } else {
        const defeated = rock.coreOf;
        const recovered = fleet.module === 'scavenger' ? Math.floor(rock.drones * SALVAGE_FRACTION) : 0;
        rock.drones = fleet.drones - rock.drones + recovered;
        if (recovered) game.events.unshift({ hour: next, audience, message: `${rock.name}: scavenger rig recovered ${recovered} drones.` });
        if (game.version === 2 && rock.kind === 'mine') {
          if (rock.owner) game.cargo[rock.owner] *= 0.8;
          rock.miningAt = game.hour + 24;
        }
        if (game.version === 2) {
          rock.shieldAt = game.hour + 48 / (rock.shieldMax ?? 10);
          if (!rock.owner && rock.kind === 'factory') rock.productionAt = game.hour + 8;
        }
        rock.owner = fleet.owner;
        delete rock.module;
        if (fleet.module) rock.module = fleet.module;
        game.events.unshift({ hour: next, audience, message: `${rock.name} acquired by ${FACTIONS[fleet.owner].name}.` });
        if (defeated && !game.eliminated.includes(defeated)) {
          game.eliminated.push(defeated);
          if (game.version === 1) {
            for (const asset of game.rocks) if (asset.owner === defeated) asset.owner = null;
            game.fleets = game.fleets.filter(f => f.owner !== defeated);
          } else {
            game.cargo[defeated] = 0;
            for (const asset of game.rocks.filter(r => r.owner === defeated)) defendWithPreparations(game, asset.id);
          }
          if (game.scheduled) game.scheduled = game.scheduled.filter(p => p.owner !== defeated);
          game.events.unshift({ hour: next, audience: ['you', 'vesper', 'null'], message: `${FACTIONS[defeated].name}: core destroyed. Operations terminated.` });
        }
        delete rock.coreOf;
      }
    }
    if (game.version === 2) completePreparations(game);
    const factions = (Object.keys(FACTIONS) as Faction[]).filter(f => !game.eliminated.includes(f));
    game.winner = factions.find(f => game.cargo[f] >= cargoTarget(game)) ?? (factions.length === 1 ? factions[0]! : null);
    if (game.winner) game.events.unshift({ hour: next, audience: ['you', 'vesper', 'null'], message: `${FACTIONS[game.winner].name}: corporate quota secured. Contract complete.` });
    if (game.winner && game.scheduled) game.scheduled = [];
    if (!game.winner) game = executeScheduled(game);
    if (options.rivals !== false && !game.winner && Number.isInteger(next) && next % 6 === 0) game = actRivals(game);
    game.events = recentEvents(game.events);
  }
  return game;
}
function actRivals(input: Game): Game {
  let game = input;
  for (const faction of ['vesper', 'null'] as const) {
    if (game.eliminated.includes(faction)) continue;
    const sources = game.rocks.filter(r => r.owner === faction && r.drones > 35).sort((a, b) => b.drones - a.drones);
    const source = sources[0];
    if (!source) continue;
    const available = Math.floor(source.drones * 0.65);
    const destination = game.rocks.filter(r => r.owner !== faction && r.drones + (r.owner && r.kind !== 'mine' ? LEGACY_PRODUCTION * travelHours(source, r) : 0) < available)
      .sort((a, b) => travelHours(source, a) - travelHours(source, b) || a.drones - b.drones)[0];
    if (destination) game = dispatch(game, source.id, destination.id, available, faction);
  }
  return game;
}

function executeScheduled(input: Game): Game {
  let game = input;
  const due = (game.scheduled ?? []).filter(p => p.executeAt <= game.hour);
  if (!due.length) return game;
  game = { ...game, scheduled: game.scheduled!.filter(p => p.executeAt > game.hour) };
  for (const plan of due) {
    try {
      if (game.rocks.find(r => r.id === plan.from)?.owner !== plan.owner) throw new Error('The departure rock is no longer controlled.');
      if (plan.module && game.rocks.find(r => r.id === plan.from)?.module !== plan.module) throw new Error('The planned module is no longer in the departure bay.');
      game = dispatch(game, plan.from, plan.to, plan.drones, plan.owner, !!plan.module);
    } catch (error) {
      game.events = recentEvents([{ hour: game.hour, audience: [plan.owner], message: `Scheduled transfer from ${game.rocks.find(r => r.id === plan.from)!.name} to ${game.rocks.find(r => r.id === plan.to)!.name} aborted: ${(error as Error).message}` }, ...game.events]);
    }
  }
  return game;
}
