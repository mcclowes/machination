/**
 * ---
 * purpose: Local save envelope and offline advancement with validated private history.
 * ---
 */
import { advance, type Game } from './simulation';
import { decodeSave, type Save } from './save-format';
import { createArchive, exportArchive, type ReplayArchive } from './replay';
import { decodeReplay } from './replay-save';
export type LocalOperation = { game: Game; archive: ReplayArchive };
export function decodeOperation(raw: string, now: number): LocalOperation {
  const saved = decodeSave(raw);
  const archive = saved.replay === undefined ? createArchive(saved.game, { rivals: true }) : decodeReplay(saved.replay, saved.game, true);
  return { archive, game: advance(saved.game, saved.game.hour + Math.max(0, now - saved.savedAt) / 3_600_000) };
}
export function encodeOperation(operation: LocalOperation, savedAt: number): string {
  return JSON.stringify({ savedAt, game: operation.game, replay: exportArchive(operation.archive) } satisfies Save);
}
