/** Trusted engine snapshots only. Never serialize these records into a public replay. */
import type { Game } from './simulation';

// Points preserve callback order, including equal-hour effects; phase names are private.
// Spans end before discrete settling and retain legacy continuous economy endpoints.
export type SimulationTrace =
  | { type: 'point'; phase: string; game: Game }
  | { type: 'span'; from: Game; to: Game };
export type SimulationTraceSink = (record: SimulationTrace) => void;

// Engine state is plain data; retain undefined and non-finite numeric sentinels.
export function traceSnapshot<T>(value: T): T {
  if (Array.isArray(value)) return value.map(traceSnapshot) as T;
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, traceSnapshot(item)])) as T;
  return value;
}
export function tracePoint(sink: SimulationTraceSink | undefined, phase: string, game: Game): void {
  if (sink) sink({ type: 'point', phase, game: traceSnapshot(game) });
}
