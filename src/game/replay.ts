/**
 * ---
 * purpose: Private immutable command history reconstructed with the authoritative engine.
 * related:
 *   - ../../docs/replay-contract.md
 * ---
 */
import { advance, dispatch, installModule, type Faction, type Game } from './simulation';
import { giftTransfer } from './gifts';
import { dispatchIntercept } from './interception';
import { commandHauler, type HaulerChange } from './transport';
import { scheduleTransfer, cancelTransfer, type TransferPlan } from './orders';
import { hireSpecialist, promoteSpecialist } from './specialists';
import { releaseSpecialist } from './specialist-travel';
import { drillMine, setShields } from './economy';
import { setFunding } from './funding';
import type { ModuleKind } from './modules';
import type { SpecialistKind } from './specialist-catalog';

export type GameCommand = { owner: Faction } & (
  | { type: 'dispatch'; from: string; to: string; drones: number; carryModule?: boolean; specialists?: string[] }
  | { type: 'gift'; from: string; to: string; drones: number; recipient: Faction; carryModule?: boolean; specialists?: string[] }
  | { type: 'intercept'; from: string; target: number; drones: number; specialists?: string[] }
  | { type: 'hauler'; change: HaulerChange }
  | { type: 'schedule'; plan: Omit<TransferPlan, 'owner'> }
  | { type: 'cancel-schedule'; id: string }
  | { type: 'hire'; kind: SpecialistKind }
  | { type: 'promote' | 'release'; id: string }
  | { type: 'drill-mine'; rock: string }
  | { type: 'shields'; rock: string; disabled: boolean }
  | { type: 'funding'; to: Faction; enabled: boolean }
  | { type: 'install-module'; rock: string; kind: ModuleKind }
);

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
    case 'dispatch': return dispatch(game, c.from, c.to, c.drones, c.owner, c.carryModule, c.specialists);
    case 'gift': return giftTransfer(game, c.from, c.to, c.drones, c.owner, c.recipient, c.carryModule, c.specialists);
    case 'intercept': return dispatchIntercept(game, c.from, c.target, c.drones, c.owner, true, c.specialists);
    case 'hauler': return commandHauler(game, c.owner, c.change);
    case 'schedule': return scheduleTransfer(game, { ...c.plan, owner: c.owner });
    case 'cancel-schedule': return cancelTransfer(game, c.id, c.owner);
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
type Entry = { hour: number; command: GameCommand };
type History = { baseline: Game; entries: readonly Entry[]; rivals: boolean };
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

/** Includes all successful submissions at targetHour, in original submission order. */
export function replayTo(handle: ReplayArchive, targetHour: number, options: ReplayOptions): Game {
  const history = historyOf(handle);
  if (options.rivals !== history.rivals) throw new Error('Replay rival mode cannot change.');
  if (!Number.isFinite(targetHour) || !Number.isFinite(options.knownThrough) || targetHour < history.baseline.hour || targetHour > options.knownThrough || options.knownThrough < (history.entries.at(-1)?.hour ?? history.baseline.hour)) throw new Error('Replay hour is outside known history.');
  let game = clone(history.baseline);
  for (const entry of history.entries) {
    if (entry.hour > targetHour) break;
    if (entry.hour > game.hour) game = advance(game, entry.hour, { rivals: history.rivals });
    game = executeCommand(game, entry.command);
  }
  return targetHour > game.hour ? advance(game, targetHour, { rivals: history.rivals }) : game;
}

/** Apply only at the trusted live frontier; publish both returned values atomically. */
export function applyCommand(handle: ReplayArchive, command: GameCommand, options: ReplayOptions): { archive: ReplayArchive; game: Game } {
  const history = historyOf(handle);
  if (history.rivals && command.owner !== 'you') throw new Error('Automatic rival decisions must not be logged as player commands.');
  const current = replayTo(handle, options.knownThrough, options);
  if (current.hour !== options.knownThrough) throw new Error('The operation ended before this command hour.');
  const canonical = clone(command);
  const game = executeCommand(current, canonical);
  return { game, archive: archive({ ...history, entries: [...history.entries, { hour: current.hour, command: canonical }] }) };
}
