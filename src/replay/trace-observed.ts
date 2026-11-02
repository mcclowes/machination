/** One frozen canonical observation trace, shared by legacy and packed recorders. */
import { clonePulse } from '../game/pulse';
import { advancePulseTime } from '../game/pulse-simulation';
import type { LocalOperation } from '../game/operation-save';
import { traceValidatedReplay } from '../game/replay-save';
import { exportArchive } from '../game/replay';
import { playersIn, type Faction } from '../game/players';
import type { Game } from '../game/simulation';
import { sameSnapshot } from '../game/snapshot-equality';
import { observe } from '../game/visibility';
import { moveReplayScene } from './motion';
import { observationIntervals } from './observation-intervals';
import { createReplayAliases, presentObservation, type ReplayScene } from './presentation';

/** Provisional recorder output; publish only after traceObservedReplay returns successfully. */
export type ObservedReplaySink = { point(scene: ReplayScene): void; span(start: ReplayScene, end: ReplayScene, scene: ReplayScene): void };
export function traceObservedReplay(operation: LocalOperation, perspective: Faction, from: number, through: number, sink: ObservedReplaySink): void {
  const data = exportArchive(operation.archive);
  if (!Number.isFinite(from) || !Number.isFinite(through) || from < data.baseline.hour || through < from || through > operation.game.hour) throw new RangeError('Choose an interval within retained history.');
  if (!playersIn(operation.game).includes(perspective)) throw new Error('Replay perspective is not part of this operation.');
  if (operation.game.version !== 2) throw new Error('Continuous version-one economy is not yet supported by shared replays.');
  const aliases = createReplayAliases();
  const project = (game: Game, hour = game.hour) => {
    const projected = { ...game, ...(game.pulse ? { pulse: clonePulse(game.pulse) } : {}) };
    advancePulseTime(projected, hour); projected.hour = hour;
    return presentObservation(observe(projected, perspective), aliases);
  };
  let previousPoint: Game | undefined;
  traceValidatedReplay(data, operation.game, data.rivals, { from, through }, record => {
    if (record.type === 'point') {
      if (record.game.hour >= from && record.game.hour <= through) {
        // Both recorders coalesce identical adjacent points; avoid projecting the same exact state again.
        if (!previousPoint || !sameSnapshot(previousPoint, record.game)) sink.point(project(record.game));
        previousPoint = record.game;
      }
      return;
    }
    previousPoint = undefined;
    const start = Math.max(from, record.from.hour), end = Math.min(through, record.to.hour);
    if (end < start) return;
    if (end === start) { sink.point(project(record.from, start)); return; }
    const support = observationIntervals(record.from, perspective, record.to.hour, 'continuous');
    const boundaries = new Set([start, end]);
    for (const windows of [...support.sites.values(), ...support.fleets.values()]) for (const w of windows) {
      if (w.from > start && w.from < end) boundaries.add(w.from);
      if (w.through > start && w.through < end) boundaries.add(w.through);
    }
    const hours = [...boundaries].sort((a, b) => a - b);
    for (let i = 1; i < hours.length; i++) {
      const a = hours[i - 1]!, b = hours[i]!;
      // All analytic visibility boundaries are retained; this selects the fixed open-span membership.
      const interior = a + (b - a) / 2;
      const first = project(record.from, a);
      const scene = moveReplayScene(project(record.from, interior), a);
      const last = project(record.from, b);
      sink.span(first, last, scene);
    }
  });
}
