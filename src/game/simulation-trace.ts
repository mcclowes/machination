/** Trusted engine snapshots only. Never serialize these records into a public replay. */
import type { Game } from './simulation';

// Points preserve callback order, including equal-hour effects; phase names are private.
// Spans end before discrete settling and retain legacy continuous economy endpoints.
export type SimulationTrace =
  | { type: 'point'; phase: string; game: Game }
  | { type: 'span'; from: Game; to: Game };
export type SimulationTraceSink = ((record: SimulationTrace) => void) & {
  includes?: (from: number, through: number) => boolean;
};
export function traceIncludes(sink: SimulationTraceSink | undefined, from: number, through = from): boolean {
  return !!sink && (!sink.includes || sink.includes(from, through));
}

// Engine state is plain data; retain undefined and non-finite numeric sentinels.
export function traceSnapshot<T>(value: T): T {
  if (Array.isArray(value)) return value.map(traceSnapshot) as T;
  if (value !== null && typeof value === 'object') {
    const snapshot: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const item = traceSnapshot((value as Record<string, unknown>)[key]);
      if (key === '__proto__') Object.defineProperty(snapshot, key, { value: item, enumerable: true, writable: true, configurable: true });
      else snapshot[key] = item;
    }
    return snapshot as T;
  }
  return value;
}
export function tracePoint(sink: SimulationTraceSink | undefined, phase: string, game: Game): void {
  if (sink && traceIncludes(sink, game.hour)) sink({ type: 'point', phase, game: traceSnapshot(game) });
}
