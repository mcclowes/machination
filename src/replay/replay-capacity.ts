/** Stored-data accounting shared by both replay recorders. */
import { utf8Size } from './codec';

export class SharedReplayCapacityError extends Error {
  readonly code = 'replay-capacity';
  constructor() { super('This observed timeline is too large. Choose a shorter interval.'); }
}
export type Cost = { records: number; bytes: number };
export function replayCost(value: unknown): Cost {
  let records = 1, bytes = 0;
  if (typeof value === 'string') bytes = utf8Size(value);
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    const c = replayCost(child); records += c.records; bytes += c.bytes + utf8Size(key);
  }
  return { records, bytes };
}
