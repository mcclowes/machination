import { utf8Size } from './codec';
import { SHARED_REPLAY_LIMITS } from './timeline';

export type ReplayFileErrorCode = 'unavailable' | 'oversize' | 'io';
const messages = {
  unavailable: 'Replay files are unavailable on this device.',
  oversize: 'Replay files must be no larger than 64 MiB.',
  io: 'The replay file could not be read, saved, or cleaned up.',
} as const;

export class ReplayFileError extends Error {
  constructor(readonly code: ReplayFileErrorCode) {
    super(messages[code]);
    this.name = 'ReplayFileError';
  }
}

export function checkReplayFileSize(bytes: number): void {
  if (!Number.isFinite(bytes) || bytes < 0) throw new ReplayFileError('io');
  if (bytes > SHARED_REPLAY_LIMITS.bytes) throw new ReplayFileError('oversize');
}

export function checkReplayText(raw: string): void {
  checkReplayFileSize(utf8Size(raw));
}

export function replayFileName(name: string): string {
  const stem = name.replace(/\.json$/i, '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
  return `${stem || 'shared-replay'}.json`;
}

export function replayFileFailure(error: unknown): ReplayFileError {
  return error instanceof ReplayFileError ? error : new ReplayFileError('io');
}
