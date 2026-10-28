/**
 * ---
 * purpose: Deterministic asteroid-belt economy, transfer orders, combat, and rival decisions.
 * related:
 *   - ./simulation.test.ts - behavioral scenarios
 * ---
 */
import { positionSites, stationCourse, type Drift } from './drift';
import { mechanicsVersion } from './rules';
import { tracePoint, traceSnapshot, type SimulationTraceSink } from './simulation-trace';
import { wrappedBounds, worldDistance, type GeometryWorld } from './geometry';
import { resolveSpecialistInterceptions } from './specialist-interception';
import { reconcileFunding, type Funding } from './funding';
import { refreshMining } from './mining';
import { applyStationPassives, nextSpecialistEvent, settleSpecialistActions } from './specialist-actions';
import { resolveStationArrival } from './specialist-combat';
import { refreshUnitEffects, specialistSpeed } from './specialist-effects';
import { cloneUnits, manifestUnits, upgradeSpecialists, type Specialist, type Recruitment } from './specialists';
import { nextRouteEncounter, routeCandidates, resolveRouteEncounters } from './route-encounters';
import { LAUNCH_PREPARATION, completePreparations } from './transport';
import { nextEconomyEvent, settleEconomy } from './economy';
import { resolveInterceptions } from './interception';
import { transferDuration, type Point } from './flight';
import { isActionPlan, actionLabel, executeScheduledAction } from './future-actions';
import type { ScheduledOrder } from './orders';
import { recentEvents, type GameEvent } from './events';
import { observers } from './sensors';
import { MODULES, isModule, CONVERSION_FRACTION, CONVERSION_LIMIT, SALVAGE_FRACTION, BLAST_MULTIPLIER, type ModuleKind } from './modules';
import { FACTIONS, playersIn, type Faction, type PlayerValues } from './players';
import { victoryProgress, victoryTarget, type GameRules } from './rules';
export { FACTIONS, type Faction } from './players';
export type Rock = {
  id: string; name: string; x: number; y: number; drift?: Drift;
  owner: Faction | null; drones: number; kind: 'core' | 'reactor' | 'mine' | 'factory' | 'generator';
  shield?: number; shieldMax?: number; shieldAt?: number; shieldsDisabled?: boolean; productionAt?: number; productionInterval?: number; miningAt?: number; miningInterval?: number;
  specialists?: Specialist[]; shieldBonus?: number; destroyed?: true;
  coreOf?: Faction; module?: ModuleKind;
};
export type Fleet = { id: number; owner: Faction; from: string; to: string; drones: number; departed: number; arrives: number; preparing?: true; speed?: number; lastContacts?: { id: number; hour: number }[]; specialists?: Specialist[]; giftAt?: number; module?: ModuleKind; route?: { from: Point; to: Point }; intercept?: { target?: number; home: string }; returning?: true; interceptionReturn?: true; courseLocked?: true };
export type Game = {
  version: 1 | 2; hour: number; epoch: number; rocks: Rock[]; fleets: Fleet[];
  rules?: GameRules; cargo: PlayerValues<number>; eliminated: Faction[]; nextId: number;
  specialistVersion?: 1;
  recruitment?: PlayerValues<Recruitment>;
  funding?: Funding[];
  minesDrilled?: PlayerValues<number>;
  scheduled?: ScheduledOrder[]; events: GameEvent[]; winner: Faction | null; draw?: true;
};
export function operationStatus(game: Pick<Game, 'winner' | 'eliminated' | 'draw'>, faction: Faction): 'active' | 'victory' | 'defeat' | 'eliminated' | 'draw' {
  if (game.draw) return 'draw';
  if (game.winner === faction) return 'victory';
  if (game.eliminated.includes(faction)) return 'eliminated';
  return game.winner ? 'defeat' : 'active';
}
const LEGACY_CARGO_TARGET = 300;
const LEGACY_PRODUCTION = 4;
const LEGACY_MINING = 2;
const INVENTORY_ROUNDING_TOLERANCE = 1e-9;
function inventoryUnits(value: number): number {
  const whole = Math.round(value);
  return Math.abs(value - whole) < INVENTORY_ROUNDING_TOLERANCE ? whole : value;
}
export { createGame } from './world';
export function travelHours(from: Pick<Rock, 'x' | 'y'>, to: Pick<Rock, 'x' | 'y'>, module?: ModuleKind, version: 1 | 2 = 1, world: GeometryWorld = {}): number {
  return transferDuration(from, to, module, version, world);
}
export function installModule(game: Game, rockId: string, kind: ModuleKind, owner: Faction): Game {
  if (game.version === 2) throw new Error('Recruit modules at your core using time credits.');
  const rock = game.rocks.find(r => r.id === rockId);
  if (!playersIn(game).includes(owner) || game.winner || game.draw || game.eliminated.includes(owner)) throw new Error('This intelligence is no longer operational.');
  if (!isModule(kind)) throw new Error('Unknown module.');
  if (!rock || rock.owner !== owner) throw new Error('Modules can only be built on a controlled rock.');
  if (rock.module) throw new Error('This rock already has a module. Load it onto a hauler to free the bay.');
  if (rock.drones < MODULES[kind].cost) throw new Error('Not enough drones to build this module.');
  return { ...game, rocks: game.rocks.map(r => r.id === rockId ? { ...r, module: kind, drones: r.drones - MODULES[kind].cost } : r),
    events: recentEvents([{ hour: game.hour, audience: observers(game, rock), message: `${rock.name}: ${MODULES[kind].name} constructed for ${MODULES[kind].cost} drones.` }, ...game.events]) };
}
export function dispatch(game: Game, fromId: string, toId: string, drones: number, owner: Faction, carryModule = false, specialists: string[] = [], fleetId?: number): Game {
  const from = game.rocks.find(r => r.id === fromId);
  const to = game.rocks.find(r => r.id === toId);
  if (!playersIn(game).includes(owner) || game.winner || game.draw || game.eliminated.includes(owner)) throw new Error('This intelligence is no longer operational.');
  if (!from || !to || from === to || from.owner !== owner || from.destroyed || to.destroyed) throw new Error('Select an owned departure rock and a different destination.');
  const manifest = manifestUnits(from, owner, specialists);
  if (!Number.isSafeInteger(drones) || drones < (game.version === 2 && specialists.length ? 0 : 1) || drones > from.drones) throw new Error('Drone count exceeds available inventory.');
  if (typeof carryModule !== 'boolean' || carryModule && !from.module) throw new Error('There is no module available to load.');
  const module = carryModule ? from.module : undefined;
  const speed = specialistSpeed(game, owner, manifest, to.owner === owner);
  const duration = game.version === 2 ? Math.max(1e-6, worldDistance(game, from, to) / speed) : travelHours(from, to, module, game.version);
  const departed = game.hour + (game.version === 2 ? LAUNCH_PREPARATION : 0);
  const course = game.version === 2 && (from.drift || to.drift) ? stationCourse(game, from, to, speed, departed) : undefined;
  return {
    ...game, nextId: game.nextId + (fleetId === undefined ? 1 : 0),
    rocks: game.rocks.map(r => {
      if (r.id !== fromId) return r;
      const departure = { ...r, drones: r.drones - drones, ...(r.specialists ? { specialists: r.specialists.filter(u => !specialists.includes(u.id)) } : {}) };
      if (carryModule) delete departure.module;
      return departure;
    }),
    fleets: [...game.fleets, { id: fleetId ?? game.nextId, owner, from: fromId, to: toId, drones, departed, arrives: course?.arrives ?? departed + duration, ...(course ? { route: course.route } : {}), ...(game.version === 2 ? { preparing: true as const } : {}), ...(module ? { module } : {}), ...(game.version === 2 ? { specialists: manifest, speed } : {}) }],
    events: recentEvents([{ hour: game.hour, audience: game.version === 2 ? [owner] : [...new Set([owner, ...observers(game, from)])], message: `${FACTIONS[owner].name}: ${drones} drones dispatched to ${to.name}.` }, ...game.events]),
  };
}
export function advance(saved: Game, targetHour: number, options: { trace?: SimulationTraceSink; rivals?: boolean; unknownDestinations?: readonly string[]; unknownInterceptions?: readonly number[]; territoryOwners?: ReadonlyMap<string, Faction | null>; stopWhen?: (game: Readonly<Game>) => boolean } = {}): Game {
  const input = upgradeSpecialists(saved);
  if (!Number.isFinite(targetHour) || targetHour < input.hour) throw new Error('Time can only move forward.');
  let game: Game = {
    ...input, ...(input.rules ? { rules: { ...input.rules, players: [...input.rules.players], map: { ...input.rules.map } } } : {}), rocks: input.rocks.map(cloneUnits), fleets: input.fleets.map(cloneUnits),
    ...(input.scheduled ? { scheduled: input.scheduled.map(p => ({ ...p })) } : {}),
    ...(input.minesDrilled ? { minesDrilled: { ...input.minesDrilled } } : {}),
    cargo: { ...input.cargo }, eliminated: [...input.eliminated], events: input.events.map(e => ({ ...e })),
  };
  const trace = options.trace;
  tracePoint(trace, 'advance:initial', game);
  if (game.winner || game.draw) { tracePoint(trace, 'advance:final', game); return game; }
  reconcileFunding(game); tracePoint(trace, 'funding', game);
  refreshMining(game); tracePoint(trace, 'mining', game);
  const preserveDueClocks = mechanicsVersion(game) >= 5;
  refreshUnitEffects(game, preserveDueClocks); tracePoint(trace, 'effects', game);
  if (game.version === 2) { applyStationPassives(game, trace); refreshUnitEffects(game, preserveDueClocks); tracePoint(trace, 'effects', game); }
  while (game.hour < targetHour && !game.winner && !game.draw && !options.stopWhen?.(game)) {
    const nextArrival = Math.min(...game.fleets.map(f => f.arrives));
    const quotaTimes = playersIn(game).filter(f => !game.eliminated.includes(f)).map(f => {
      if (game.version === 2) return Infinity;
      const rate = game.rocks.filter(r => r.owner === f && r.kind === 'mine').length * LEGACY_MINING;
      return rate ? game.hour + Math.max(0, LEGACY_CARGO_TARGET - (game.cargo[f] ?? 0)) / rate : Infinity;
    });
    const contacts = mechanicsVersion(game) >= 5 ? routeCandidates(game) : undefined;
    const routeHour = game.version === 2 ? contacts ? Math.min(...contacts.map(c => c.hour)) : nextRouteEncounter(game) : Infinity;
    const next = Math.min(targetHour, game.version === 2 ? Math.min(nextEconomyEvent(game), routeHour, nextSpecialistEvent(game)) : Infinity, Math.floor(game.hour) + 1, nextArrival, ...game.fleets.filter(f => f.preparing).map(f => f.departed), ...quotaTimes, ...(game.scheduled ?? []).map(p => p.executeAt));
    const elapsed = next - game.hour;
    const spanFrom = trace ? traceSnapshot(game) : undefined;
    if (game.version === 1) for (const rock of game.rocks) {
      if (!rock.owner) continue;
      if (rock.kind === 'mine') {
        game.cargo[rock.owner] = inventoryUnits((game.cargo[rock.owner] ?? 0) + LEGACY_MINING * elapsed);
        if ((game.cargo[rock.owner] ?? 0) >= LEGACY_CARGO_TARGET - 1e-9) game.cargo[rock.owner] = LEGACY_CARGO_TARGET;
      }
      else rock.drones = inventoryUnits(rock.drones + LEGACY_PRODUCTION * elapsed);
    }
    game.hour = next;
    positionSites(game);
    if (trace && spanFrom) trace({ type: 'span', from: spanFrom, to: traceSnapshot(game) });
    if (game.version === 2) { settleEconomy(game); tracePoint(trace, 'economy', game); settleSpecialistActions(game, trace); }
    if (game.version === 2) resolveRouteEncounters(game, trace, contacts);
    if (game.version === 2) resolveSpecialistInterceptions(game, options.unknownInterceptions, trace);
    else resolveInterceptions(game, options.unknownInterceptions, trace);
    const arrivals = game.fleets.filter(f => f.arrives <= next).sort((a, b) => a.id - b.id);
    if (game.version === 1) game.fleets = game.fleets.filter(f => f.arrives > next);
    for (const fleet of arrivals) {
      if (game.version === 2 && !game.fleets.some(f => f.id === fleet.id)) continue;
      if (game.version === 1 && game.eliminated.includes(fleet.owner)) continue;
      try {
        const rock = game.rocks.find(r => r.id === fleet.to)!;
        if (options.unknownDestinations?.includes(fleet.to)) {
          game.fleets = game.fleets.filter(f => f.id !== fleet.id);
          game.events.unshift({ hour: next, audience: [fleet.owner], unresolvedDestination: fleet.to, message: `${rock.name}: arrival outcome unknown outside observed territory.` });
          continue;
        }
        if (game.version === 2) { resolveStationArrival(game, fleet, rock); continue; }
        const audience = [...new Set([fleet.owner, ...(rock.owner ? [rock.owner] : []), ...observers(game, rock)])];
        if (rock.owner === fleet.owner) {
          rock.drones += fleet.drones;
          if (fleet.module && !rock.module) rock.module = fleet.module;
          else if (fleet.module) game.events.unshift({ hour: next, audience, message: `${rock.name}: occupied module bay; incoming ${MODULES[fleet.module].name} recycled.` });
          continue;
        }
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
        if (fleet.drones <= rock.drones) {
          rock.drones -= fleet.drones;
          game.events.unshift({ hour: next, audience, message: `${rock.name}: ${FACTIONS[fleet.owner].name} transfer neutralized.` });
        } else {
          const defeated = rock.coreOf;
          const recovered = fleet.module === 'scavenger' ? Math.floor(rock.drones * SALVAGE_FRACTION) : 0;
          rock.drones = fleet.drones - rock.drones + recovered;
          if (recovered) game.events.unshift({ hour: next, audience, message: `${rock.name}: scavenger rig recovered ${recovered} drones.` });
          rock.owner = fleet.owner;
          delete rock.module;
          if (fleet.module) rock.module = fleet.module;
          game.events.unshift({ hour: next, audience, message: `${rock.name} acquired by ${FACTIONS[fleet.owner].name}.` });
          if (defeated && !game.eliminated.includes(defeated)) {
            game.eliminated.push(defeated);
            for (const asset of game.rocks) if (asset.owner === defeated) asset.owner = null;
            game.fleets = game.fleets.filter(f => f.owner !== defeated);
            if (game.scheduled) game.scheduled = game.scheduled.filter(p => p.owner !== defeated);
            game.events.unshift({ hour: next, audience: [...playersIn(game)], message: `${FACTIONS[defeated].name}: core destroyed. Operations terminated.` });
          }
          delete rock.coreOf;
        }
      } finally { tracePoint(trace, 'arrival', game); }
    }
    if (game.version === 2) {
      applyStationPassives(game, trace);
      completePreparations(game); tracePoint(trace, 'preparation', game);
      refreshUnitEffects(game); tracePoint(trace, 'effects', game);
      refreshMining(game); tracePoint(trace, 'mining', game);
      reconcileFunding(game); tracePoint(trace, 'funding', game);
    }
    const factions = playersIn(game).filter(f => !game.eliminated.includes(f));
    // Public ownership counts toward domination without activating hidden simulation assets.
    const victoryState = game.rules?.mode === 'domination' && options.territoryOwners
      ? { ...game, rocks: game.rocks.map(r => ({ owner: options.territoryOwners!.has(r.id) ? options.territoryOwners!.get(r.id)! : r.owner })) }
      : game;
    game.winner = factions.find(f => victoryProgress(victoryState, f) >= victoryTarget(game)) ?? (factions.length === 1 ? factions[0]! : null);
    if (factions.length === 0) { game.draw = true; game.events.unshift({ hour: next, audience: [...playersIn(game)], message: 'All cores lost. The operation ended in a draw.' }); }
    if (game.winner) game.events.unshift({ hour: next, audience: [...playersIn(game)], message: `${FACTIONS[game.winner].name}: ${game.rules?.mode === 'domination' ? 'domination target secured' : 'corporate quota secured'}. Contract complete.` });
    if ((game.winner || game.draw) && game.scheduled) game.scheduled = [];
    tracePoint(trace, 'victory', game);
    if (!game.winner && !game.draw) game = executeScheduled(game, trace);
    if (options.rivals !== false && !game.winner && !game.draw && Number.isInteger(next) && next % 6 === 0) game = actRivals(game, trace);
    game.events = recentEvents(game.events);
    tracePoint(trace, 'retention', game);
  }
  tracePoint(trace, 'advance:final', game);
  return game;
}
function actRivals(input: Game, trace?: SimulationTraceSink): Game {
  let game = input;
  for (const faction of playersIn(game).filter(f => f !== 'you')) {
    if (game.eliminated.includes(faction)) continue;
    const sources = game.rocks.filter(r => r.owner === faction && r.drones > 35).sort((a, b) => b.drones - a.drones);
    const source = sources[0];
    if (!source) { tracePoint(trace, 'rival', game); continue; }
    const available = Math.floor(source.drones * 0.65);
    const travel = (to: Rock) => wrappedBounds(game) ? travelHours(source, to, undefined, game.version, game) : travelHours(source, to);
    const destination = game.rocks.filter(r => !r.destroyed && r.owner !== faction && r.drones + (r.owner && r.kind !== 'mine' ? LEGACY_PRODUCTION * travel(r) : 0) < available)
      .sort((a, b) => travel(a) - travel(b) || a.drones - b.drones)[0];
    if (destination) game = dispatch(game, source.id, destination.id, available, faction);
    tracePoint(trace, 'rival', game);
  }
  return game;
}

function executeScheduled(input: Game, trace?: SimulationTraceSink): Game {
  let game = input;
  const due = (game.scheduled ?? []).filter(p => p.executeAt <= game.hour);
  if (!due.length) return game;
  game = { ...game, scheduled: game.scheduled!.filter(p => p.executeAt > game.hour) };
  for (const plan of due) {
    try {
      if (isActionPlan(plan)) { game = executeScheduledAction(game, plan); continue; }
      if (game.rocks.find(r => r.id === plan.from)?.owner !== plan.owner) throw new Error('The departure rock is no longer controlled.');
      if (plan.module && game.rocks.find(r => r.id === plan.from)?.module !== plan.module) throw new Error('The planned module is no longer in the departure bay.');
      game = dispatch(game, plan.from, plan.to, plan.drones, plan.owner, !!plan.module, plan.specialists, plan.fleetId);
    } catch (error) {
      game.events = recentEvents([{ hour: game.hour, audience: [plan.owner], message: isActionPlan(plan) ? `${actionLabel(plan.action, game.rocks)} aborted: ${(error as Error).message}` : `Scheduled transfer from ${game.rocks.find(r => r.id === plan.from)!.name} to ${game.rocks.find(r => r.id === plan.to)!.name} aborted: ${(error as Error).message}` }, ...game.events]);
    } finally { tracePoint(trace, 'queue', game); }
  }
  return game;
}
