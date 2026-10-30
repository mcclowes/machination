import { clonePulse } from '../game/pulse';
import { advancePulseTime } from '../game/pulse-simulation';
/** Build public presentation records from one validated, frozen private event trace. */
import { moveReplayScene } from './motion';
import type { LocalOperation } from '../game/operation-save';
import { decodeReplay } from '../game/replay-save';
import { exportArchive, traceReplayTo } from '../game/replay';
import { playersIn, type Faction } from '../game/players';
import type { Game } from '../game/simulation';
import { observe } from '../game/visibility';
import { encodeSharedReplay, utf8Size } from './codec';
import { observationIntervals } from './observation-intervals';
import { createReplayAliases, presentObservation, type ReplayScene } from './presentation';
import { SHARED_REPLAY_LIMITS as L, type SharedReplay } from './timeline';

export class SharedReplayCapacityError extends Error {
  readonly code = 'replay-capacity';
  constructor() { super('This observed timeline is too large. Choose a shorter interval.'); }
}
type Cost = { records: number; bytes: number };
function cost(value: unknown): Cost {
  let records = 1, bytes = 0;
  if (typeof value === 'string') bytes = utf8Size(value);
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    const c = cost(child); records += c.records; bytes += c.bytes + utf8Size(key);
  }
  return { records, bytes };
}
const law = (scene: ReplayScene) => JSON.stringify(moveReplayScene(scene, 0));

/** The caller owns authentication and must supply a retained authoritative frontier. */
export function generateSharedReplay(operation: LocalOperation, perspective: Faction, from: number, through: number): SharedReplay {
  const data = exportArchive(operation.archive);
  if (!Number.isFinite(from) || !Number.isFinite(through) || from < data.baseline.hour || through < from || through > operation.game.hour) throw new RangeError('Choose an interval within retained history.');
  if (!playersIn(operation.game).includes(perspective)) throw new Error('Replay perspective is not part of this operation.');
  if (operation.game.version !== 2) throw new Error('Continuous version-one economy is not yet supported by shared replays.');
  const archive = decodeReplay(data, operation.game, data.rivals);
  const aliases = createReplayAliases();
  const result: SharedReplay = { kind: 'machination.observed-timeline', schemaVersion: operation.game.rocks.some(r => r.drift) ? 2 : 1, presentationVersion: 1,
    history: 'canonical-events', perspective, from, through, groups: [], spans: [] };
  const keys = new WeakMap<ReplayScene, string>();
  const costs = new WeakMap<ReplayScene, Cost>();
  let records = 32, bytes = 512, largestRecords = 0, largestBytes = 0;
  function key(scene: ReplayScene) {
    let k = keys.get(scene); if (k === undefined) { k = law(scene); keys.set(scene, k); }
    return k;
  }
  function charge(scene: ReplayScene, sign = 1, overhead = 0) {
    let c = costs.get(scene); if (!c) { c = cost(scene); costs.set(scene, c); }
    largestRecords = Math.max(largestRecords, c.records); largestBytes = Math.max(largestBytes, c.bytes);
    records += sign * (c.records + overhead); bytes += sign * (c.bytes + overhead * 16);
    // A uniform pending boundary can disappear on the next span. Reserve only that bounded slack.
    if (records > L.records + 2 * largestRecords + 16 || bytes > L.bytes + 2 * largestBytes + 256) throw new SharedReplayCapacityError();
  }
  function point(scene: ReplayScene) {
    const group = result.groups.at(-1);
    if (group?.hour === scene.hour) {
      if (key(group.states.at(-1)!) !== key(scene)) { group.states.push(scene); charge(scene); }
    } else {
      if (group) throw new Error('Replay trace contains an uncovered interval.');
      result.groups.push({ hour: scene.hour, states: [scene] }); charge(scene, 1, 3);
    }
  }
  function span(start: ReplayScene, end: ReplayScene, scene: ReplayScene) {
    point(start);
    const boundary = result.groups.at(-1)!;
    const previous = result.spans.at(-1);
    if (previous && key(previous.scene) === key(scene) && boundary.states.every(s => key(s) === key(scene))) {
      previous.through = end.hour;
      boundary.states.forEach((s, i) => charge(s, -1, i === 0 ? 3 : 0));
      result.groups.pop();
    } else {
      result.spans.push({ from: start.hour, through: end.hour, scene }); charge(scene, 1, 3);
    }
    result.groups.push({ hour: end.hour, states: [end] }); charge(end, 1, 3);
  }
  const project = (game: Game, hour = game.hour) => {
    const projected = { ...game, ...(game.pulse ? { pulse: clonePulse(game.pulse) } : {}) };
    advancePulseTime(projected, hour); projected.hour = hour;
    return presentObservation(observe(projected, perspective), aliases);
  };
  traceReplayTo(archive, operation.game.hour, { rivals: data.rivals, knownThrough: operation.game.hour }, record => {
    if (record.type === 'point') {
      if (record.game.hour >= from && record.game.hour <= through) point(project(record.game));
      return;
    }
    const start = Math.max(from, record.from.hour), end = Math.min(through, record.to.hour);
    if (end < start) return;
    if (end === start) { point(project(record.from, start)); return; }
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
      span(first, last, scene);
    }
  });
  if (result.groups[0]?.hour !== from || result.groups.at(-1)?.hour !== through) throw new Error('Replay trace did not cover the requested interval.');
  if (records > L.records || bytes > L.bytes) throw new SharedReplayCapacityError();
  encodeSharedReplay(result);
  return result;
}
