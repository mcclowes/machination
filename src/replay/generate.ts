/** Record schemas 1/2 without changing released-client export behavior. */
import { moveReplayScene } from './motion';
import type { LocalOperation } from '../game/operation-save';
import type { Faction } from '../game/players';
import { encodeSharedReplay } from './codec';
import type { ReplayScene } from './presentation';
import { traceObservedReplay } from './trace-observed';
import { SharedReplayCapacityError, replayCost, type Cost } from './replay-capacity';
import { SHARED_REPLAY_LIMITS as L, type SharedReplay } from './timeline';
export { SharedReplayCapacityError } from './replay-capacity';

const law = (scene: ReplayScene) => JSON.stringify(moveReplayScene(scene, 0));

/** The caller owns authentication and must supply a retained authoritative frontier. */
export function generateSharedReplay(operation: LocalOperation, perspective: Faction, from: number, through: number): SharedReplay {
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
    let c = costs.get(scene); if (!c) { c = replayCost(scene); costs.set(scene, c); }
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
  traceObservedReplay(operation, perspective, from, through, { point, span });
  if (result.groups[0]?.hour !== from || result.groups.at(-1)?.hour !== through) throw new Error('Replay trace did not cover the requested interval.');
  if (records > L.records || bytes > L.bytes) throw new SharedReplayCapacityError();
  encodeSharedReplay(result);
  return result;
}
