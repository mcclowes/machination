/**
 * ---
 * purpose: Local save envelope and offline advancement with validated private history.
 * ---
 */
import { finishSteps } from './execution';

import { advanceSteps, operationStatus, type Game } from './simulation';
import { decodeSave, type Save } from './save-format';
import { createArchive, exportArchive, type ReplayArchive } from './replay';
import { decodeReplaySteps } from './replay-save';
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
export function* decodeOperationSteps(raw: string, now: number): Generator<void, LocalOperation, unknown> {
    const saved = decodeSave(raw);
    const archive = saved.replay === undefined ? createArchive(saved.game, { rivals: true }) : (yield* decodeReplaySteps(saved.replay, saved.game, true));
    return { archive, game: (yield* advanceSteps(saved.game, saved.game.hour + Math.max(0, now - saved.savedAt) / 3600000)) };
}
export function decodeOperation(raw: string, now: number): LocalOperation { return finishSteps(decodeOperationSteps(raw, now)); }
export function encodeOperation(operation: LocalOperation, savedAt: number): string {
  return JSON.stringify({ savedAt, game: operation.game, replay: exportArchive(operation.archive) } satisfies Save);
}
