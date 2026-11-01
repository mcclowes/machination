/**
 * ---
 * purpose: Local save envelope and offline advancement with validated private history.
 * ---
 */
import { advance, operationStatus, type Game } from './simulation';
import { decodeSave, type Save } from './save-format';
import { createArchive, exportArchive, type ReplayArchive } from './replay';
import { decodeReplaySlices, finishSlices } from './replay-save';
import { playersIn } from './players';
import type { GameOptions } from './rules';
export type LocalOperation = { game: Game; archive: ReplayArchive };
export type OperationSummary = { hour: number; rivals: number; mode?: GameOptions['mode']; status: ReturnType<typeof operationStatus> };
/** Cheap glance at a save for menus: standing as saved, with the hour projected to now. */
export function summarizeOperation(raw: string, now: number): OperationSummary {
  const { game, savedAt } = decodeSave(raw);
  return {
    hour: game.hour + Math.max(0, now - savedAt) / 3_600_000,
    rivals: playersIn(game).length - 1,
    ...(game.rules ? { mode: game.rules.mode } : {}),
    status: operationStatus(game, 'you'),
  };
}
export function decodeOperation(raw: string, now: number): LocalOperation {
  return finishSlices(decodeOperationSlices(raw, () => now));
}
/**
 * Validate history and catch up time away in one-hour slices so a long absence never blocks the interface.
 * The clock is read again after each slice, so time spent loading is not lost.
 */
export function* decodeOperationSlices(raw: string, now: () => number): Generator<unknown, LocalOperation> {
  const saved = decodeSave(raw);
  const archive = saved.replay === undefined ? createArchive(saved.game, { rivals: true }) : yield* decodeReplaySlices(saved.replay, saved.game, true);
  const hourAt = (): number => saved.game.hour + Math.max(0, now() - saved.savedAt) / 3_600_000;
  let game = saved.game;
  for (let target = hourAt(); game.hour + 1 < target && !game.winner && !game.draw; target = hourAt()) {
    game = advance(game, Math.floor(game.hour) + 1);
    yield game.hour;
  }
  return { archive, game: advance(game, Math.max(game.hour, hourAt())) };
}
export function encodeOperation(operation: LocalOperation, savedAt: number): string {
  return JSON.stringify({ savedAt, game: operation.game, replay: exportArchive(operation.archive) } satisfies Save);
}
