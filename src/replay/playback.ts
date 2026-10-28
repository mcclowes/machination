import { nearestImage, wrappedBounds, wrapPoint, type Point } from '../game/geometry';
import type { ReplayFleet, ReplayScene } from './presentation';
import type { SharedReplay } from './timeline';

export type ReplayPosition = { hour: number; ordinal?: number };

function locate(replay: SharedReplay, hour: number, ordinal?: number) {
  if (!Number.isFinite(hour)) throw new RangeError('Replay hour must be finite');
  if (ordinal !== undefined && (!Number.isSafeInteger(ordinal) || ordinal < 0)) {
    throw new RangeError('Replay ordinal must be a nonnegative safe integer');
  }
  const clamped = Math.max(replay.from, Math.min(replay.through, hour));
  let low = 0, high = replay.groups.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (replay.groups[mid]!.hour <= clamped) low = mid + 1;
    else high = mid;
  }
  const index = low - 1;
  const group = replay.groups[index];
  if (!group) throw new RangeError('Replay has no boundary at its start');
  const exact = group.hour === clamped;
  if (ordinal !== undefined && (!exact || ordinal >= group.states.length)) {
    throw new RangeError('Replay ordinal must select a state at an exact boundary');
  }
  return { hour: clamped, index, group, exact, ordinal: ordinal ?? group.states.length - 1 };
}

/** Accepts a validated shared replay. Ordinals apply after clamping, only at exact groups. */
export function seekReplay(replay: SharedReplay, hour: number, ordinal?: number): ReplayScene {
  const at = locate(replay, hour, ordinal);
  const source = at.exact ? at.group.states[at.ordinal] : replay.spans[at.index]?.scene;
  if (!source) throw new RangeError('Replay has no scene at this position');
  const scene = structuredClone(source);
  scene.hour = at.hour;
  return scene;
}

/** Missing ordinal means the final causal state at a boundary. Ends return null. */
export function previousReplayStep(replay: SharedReplay, position: ReplayPosition): ReplayPosition | null {
  const at = locate(replay, position.hour, position.ordinal);
  if (!at.exact) return { hour: at.group.hour, ordinal: at.group.states.length - 1 };
  if (at.ordinal > 0) return { hour: at.hour, ordinal: at.ordinal - 1 };
  const previous = replay.groups[at.index - 1];
  return previous ? { hour: previous.hour, ordinal: previous.states.length - 1 } : null;
}

export function nextReplayStep(replay: SharedReplay, position: ReplayPosition): ReplayPosition | null {
  const at = locate(replay, position.hour, position.ordinal);
  if (at.exact && at.ordinal + 1 < at.group.states.length) return { hour: at.hour, ordinal: at.ordinal + 1 };
  const next = replay.groups[at.index + 1];
  return next ? { hour: next.hour, ordinal: 0 } : null;
}

/** Matches flight.ts arithmetic, including NaN at an instantaneous flight's exact departure. */
export function replayFleetPosition(scene: ReplayScene, fleet: ReplayFleet): Point {
  let leg = fleet.route;
  if (!leg) {
    const from = scene.rocks.find(r => r.id === fleet.from);
    const to = scene.rocks.find(r => r.id === fleet.to);
    if (!from || !to) throw new RangeError('Replay fleet endpoints are missing');
    leg = { from, to: wrappedBounds(scene) ? nearestImage(scene, from, to) : to };
  }
  const progress = Math.max(0, Math.min(1, (scene.hour - fleet.departed) / (fleet.arrives - fleet.departed)));
  return wrapPoint(scene, { x: leg.from.x + (leg.to.x - leg.from.x) * progress, y: leg.from.y + (leg.to.y - leg.from.y) * progress });
}
