/**
 * ---
 * purpose: Private immutable command history reconstructed with the authoritative engine.
 * related:
 *   - ../../docs/replay-contract.md
 * ---
 */
import { tracePoint, type SimulationTraceSink } from './simulation-trace';
import { scheduleAction, type ActionPlan } from './future-actions';
import { advance, dispatch, installModule, type Faction, type Game } from './simulation';
import { giftTransfer } from './gifts';
import { dispatchIntercept } from './interception';
import { commandHauler, type HaulerChange } from './transport';
import { scheduleTransfer, cancelTransfer, editScheduledLaunch, type LaunchEdit, type TransferPlan } from './orders';
import { hireSpecialist, promoteSpecialist } from './specialists';
import { releaseSpecialist } from './specialist-travel';
import { drillMine, setShields } from './economy';
import { setFunding } from './funding';
import { resign, resignInactive } from './retirement';
import type { ModuleKind } from './modules';
import type { SpecialistKind } from './specialist-catalog';

export type GameCommand = { owner: Faction } & (
  | { type: 'dispatch'; from: string; to: string; drones: number; carryModule?: boolean; specialists?: string[] }
  | { type: 'gift'; from: string; to: string; drones: number; recipient: Faction; carryModule?: boolean; specialists?: string[] }
  | { type: 'intercept'; from: string; target: number; drones: number; specialists?: string[] }
  | { type: 'hauler'; change: HaulerChange }
  | { type: 'schedule-action'; plan: Omit<ActionPlan, 'owner'> }
  | { type: 'schedule'; plan: Omit<TransferPlan, 'owner'> }
  | { type: 'cancel-schedule'; id: string }
  | { type: 'edit-schedule'; change: LaunchEdit }
  | { type: 'hire'; kind: SpecialistKind }
  | { type: 'promote' | 'release'; id: string }
  | { type: 'drill-mine'; rock: string }
  | { type: 'shields'; rock: string; disabled: boolean }
  | { type: 'funding'; to: Faction; enabled: boolean }
  | { type: 'install-module'; rock: string; kind: ModuleKind }
  | { type: 'resign' }
) | { type: 'inactivity'; owners: Faction[] };

// Plain engine data only; preserve undefined and numeric values without structuredClone.
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => clone(item)) as T;
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  return value;
}

/** Trusted, canonical internal IDs only. Authentication and request decoding belong to the caller. */
export function executeCommand(input: Game, command: GameCommand): Game {
  const game = clone(input);
  const c = clone(command);
  switch (c.type) {
    case 'resign': return resign(game, c.owner);
    case 'inactivity': return resignInactive(game, c.owners);
    case 'dispatch': return dispatch(game, c.from, c.to, c.drones, c.owner, c.carryModule, c.specialists);
    case 'gift': return giftTransfer(game, c.from, c.to, c.drones, c.owner, c.recipient, c.carryModule, c.specialists);
    case 'intercept': return dispatchIntercept(game, c.from, c.target, c.drones, c.owner, true, c.specialists);
    case 'hauler': return commandHauler(game, c.owner, c.change);
    case 'schedule-action': return scheduleAction(game, { ...c.plan, owner: c.owner });
    case 'schedule': return scheduleTransfer(game, { ...c.plan, owner: c.owner });
    case 'cancel-schedule': return cancelTransfer(game, c.id, c.owner);
    case 'edit-schedule': return editScheduledLaunch(game, c.owner, c.change);
    case 'hire': return hireSpecialist(game, c.owner, c.kind);
    case 'promote': return promoteSpecialist(game, c.owner, c.id);
    case 'release': return releaseSpecialist(game, c.owner, c.id);
    case 'drill-mine': return drillMine(game, c.rock, c.owner);
    case 'shields': return setShields(game, c.rock, c.owner, c.disabled);
    case 'funding': return setFunding(game, c.owner, c.to, c.enabled);
    case 'install-module': return installModule(game, c.rock, c.kind, c.owner);
    default: throw new Error('Unknown game command.');
  }
}

declare const archiveBrand: unique symbol;
export type ReplayArchive = { readonly [archiveBrand]: true };
export type ReplayOptions = { rivals: boolean; knownThrough: number };
export type ReplayEntry = { hour: number; command: GameCommand };
type Entry = ReplayEntry;
type History = { baseline: Game; entries: readonly Entry[]; rivals: boolean };
export type ReplayData = { version: 1; rules: 1; baseline: Game; entries: ReplayEntry[]; rivals: boolean };
const histories = new WeakMap<ReplayArchive, History>();
function archive(history: History): ReplayArchive {
  const handle = Object.freeze({}) as ReplayArchive;
  histories.set(handle, history);
  return handle;
}
function historyOf(handle: ReplayArchive): History {
  const history = histories.get(handle);
  if (!history) throw new Error('Unknown replay archive.');
  return history;
}

export function createArchive(baseline: Game, options: { rivals: boolean } = { rivals: false }): ReplayArchive {
  if (!Number.isFinite(baseline.hour) || baseline.hour < 0) throw new Error('Invalid replay baseline hour.');
  return archive({ baseline: clone(baseline), entries: [], rivals: options.rivals });
}

/** Private storage only. Importers must validate this envelope before restoring it. */
export function exportArchive(handle: ReplayArchive): ReplayData {
  const history = historyOf(handle);
  return clone({ version: 1, rules: 1, baseline: history.baseline, entries: [...history.entries], rivals: history.rivals });
}
export function restoreArchive(data: ReplayData): ReplayArchive {
  return archive(clone({ baseline: data.baseline, entries: data.entries, rivals: data.rivals }));
}

/** Includes all successful submissions at targetHour, in original submission order. */
export function replayTo(handle: ReplayArchive, targetHour: number, options: ReplayOptions): Game {
  return reconstruct(handle, targetHour, options);
}

/** Private callbacks follow replayTo's exact advancement and submission schedule. */
export function traceReplayTo(handle: ReplayArchive, targetHour: number, options: ReplayOptions, sink: SimulationTraceSink): Game {
  return reconstruct(handle, targetHour, options, sink);
}
function reconstruct(handle: ReplayArchive, targetHour: number, options: ReplayOptions, trace?: SimulationTraceSink): Game {
  const history = historyOf(handle);
  if (options.rivals !== history.rivals) throw new Error('Replay rival mode cannot change.');
  if (!Number.isFinite(targetHour) || !Number.isFinite(options.knownThrough) || targetHour < history.baseline.hour || targetHour > options.knownThrough || options.knownThrough < (history.entries.at(-1)?.hour ?? history.baseline.hour)) throw new Error('Replay hour is outside known history.');
  let game = clone(history.baseline);
  tracePoint(trace, 'replay:initial', game);
  for (const entry of history.entries) {
    if (entry.hour > targetHour) break;
    if (entry.hour > game.hour) game = advance(game, entry.hour, { rivals: history.rivals, trace });
    tracePoint(trace, 'command:before', game);
    game = executeCommand(game, entry.command);
    tracePoint(trace, 'command:after', game);
  }
  if (targetHour > game.hour) game = advance(game, targetHour, { rivals: history.rivals, trace });
  tracePoint(trace, 'replay:final', game);
  return game;
}

/** Apply only at the trusted live frontier; publish both returned values atomically. */
export function applyCommand(handle: ReplayArchive, command: GameCommand, options: ReplayOptions): { archive: ReplayArchive; game: Game } {
  const history = historyOf(handle);
  if (history.rivals && (command.type === 'inactivity' || command.owner !== 'you')) throw new Error('Automatic rival decisions must not be logged as player commands.');
  const current = replayTo(handle, options.knownThrough, options);
  if (current.hour !== options.knownThrough) throw new Error('The operation ended before this command hour.');
  const canonical = clone(command);
  const game = executeCommand(current, canonical);
  return { game, archive: archive({ ...history, entries: [...history.entries, { hour: current.hour, command: canonical }] }) };
}
