/** Private binary64 support inside one fixed state span; never serialize motion sources. */
import { canObserveHauler, HAULER_SENSOR_RANGE, rockSensorRange } from '../game/sensors';
import type { Faction, Game } from '../game/simulation';
import { flightMotionSpans, visibilityIntervals, type AffineMotion, type MotionSpan, type MovingSensor, type VisibilityInterval } from './visibility-intervals';

export type ObservationIntervals = { sites: Map<string, VisibilityInterval[]>; fleets: Map<number, VisibilityInterval[]> };
const still = (x: number, y: number): AffineMotion => ({ position: { x, y }, velocity: { x: 0, y: 0 } });
function shifted(piece: MotionSpan, from: number): AffineMotion {
  return { source: piece.motion.source, position: { x: piece.motion.position.x + piece.motion.velocity.x * (from - piece.from), y: piece.motion.position.y + piece.motion.velocity.y * (from - piece.from) }, velocity: piece.motion.velocity };
}
function merge(windows: VisibilityInterval[]): VisibilityInterval[] {
  const merged: VisibilityInterval[] = [];
  for (const window of windows.sort((a, b) => a.from - b.from || a.through - b.through)) {
    const last = merged.at(-1);
    if (last && window.from <= last.through) last.through = Math.max(last.through, window.through);
    else merged.push({ ...window });
  }
  return merged;
}

export function observationIntervals(game: Game, faction: Faction, through: number): ObservationIntervals {
  if (!Number.isFinite(through) || through < game.hour) throw new RangeError('Choose an ordered fixed observation span.');
  const from = game.hour;
  const whole = (): VisibilityInterval[] => [{ from, through }];
  const fixed: MovingSensor[] = game.rocks.filter(r => r.owner === faction).map(r => ({ ...still(r.x, r.y), radius: rockSensorRange(game, r) }));
  const mobile = game.version === 2 ? [] : game.fleets.filter(f => f.owner === faction).flatMap(f => flightMotionSpans(game, f, from, through));
  function support(pieces: MotionSpan[]): VisibilityInterval[] {
    const windows: VisibilityInterval[] = [];
    for (const piece of pieces) {
      windows.push(...visibilityIntervals(game, piece.motion, fixed, piece.from, piece.through));
      for (const sensor of mobile) {
        const start = Math.max(piece.from, sensor.from), end = Math.min(piece.through, sensor.through);
        if (start <= end) windows.push(...visibilityIntervals(game, shifted(piece, start), [{ ...shifted(sensor, start), radius: HAULER_SENSOR_RANGE }], start, end));
      }
    }
    return merge(windows);
  }
  const sites = new Map<string, VisibilityInterval[]>();
  for (const rock of game.rocks) {
    const intervals = rock.owner === faction ? whole() : support([{ from, through, motion: still(rock.x, rock.y) }]);
    if (intervals.length) sites.set(rock.id, intervals);
  }
  const fleets = new Map<number, VisibilityInterval[]>();
  for (const fleet of game.fleets) {
    const intervals = canObserveHauler(game, faction, fleet, []) ? whole() : fleet.preparing ? [] : support(flightMotionSpans(game, fleet, from, through));
    if (intervals.length) fleets.set(fleet.id, intervals);
  }
  return { sites, fleets };
}
