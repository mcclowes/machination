/** Incremental schema-3 retention. Only packed scenes and live dictionary entries survive projection. */
import type { LocalOperation } from '../game/operation-save';
import type { Faction } from '../game/players';
import { moveReplayScene } from './motion';
import type { ReplayRock, ReplayScene } from './presentation';
import { encodePackedReplay, exactReplayIdentity, PACKED_VALIDATION_RECORDS, type PackedScene, type PackedReplay } from './packed';
import { replayCost, SharedReplayCapacityError, type Cost } from './replay-capacity';
import { SHARED_REPLAY_LIMITS as L } from './timeline';
import { traceObservedReplay } from './trace-observed';

type Entry = { rock: ReplayRock; key: string; refs: number; cost: Cost };
export function generatePackedReplay(operation: LocalOperation, perspective: Faction, from: number, through: number): PackedReplay {
  const result: PackedReplay = { kind: 'machination.observed-timeline', schemaVersion: 3,
    geometryVersion: operation.game.rocks.some(r => r.drift) ? 2 : 1, presentationVersion: 1,
    history: 'canonical-events', perspective, from, through, siteDictionary: [], groups: [], spans: [] };
  const entries: (Entry | undefined)[] = [], free: number[] = [], dictionary = new Map<string, number>();
  const costs = new WeakMap<PackedScene, { stored: Cost; expanded: Cost }>();
  const initial = replayCost(result);
  let records = initial.records, bytes = initial.bytes, work = 0, largestRecords = 0, largestBytes = 0;
  let rulesKey: string | undefined;
  let pending: { hour: number; states: PackedScene[]; lastKey: string; uniformKey: string | undefined } | undefined;
  let previousLaw: string | undefined;
  function charge(cost: Cost, sign = 1, overhead = 0) { records += sign * (cost.records + overhead); bytes += sign * (cost.bytes + overhead * 16); }
  function capacity(final = false) {
    // Only the pending boundary and next candidate may disappear under the unchanged coalescing policy.
    const slackRecords = final ? 0 : 2 * largestRecords + 16, slackBytes = final ? 0 : 2 * largestBytes + 256;
    if (records > L.records + slackRecords || bytes > L.bytes + slackBytes || work > PACKED_VALIDATION_RECORDS + slackRecords) throw new SharedReplayCapacityError();
  }
  function pack(scene: ReplayScene): PackedScene {
    const expanded = replayCost(scene);
    if (expanded.records > L.records || expanded.bytes > L.bytes) throw new SharedReplayCapacityError();
    largestRecords = Math.max(largestRecords, expanded.records); largestBytes = Math.max(largestBytes, expanded.bytes);
    const nextRules = exactReplayIdentity(scene.rules ?? null);
    if (rulesKey === undefined) {
      rulesKey = nextRules;
      if (scene.rules) { result.rules = scene.rules; charge(replayCost(scene.rules)); bytes += 5; }
    } else if (rulesKey !== nextRules) throw new Error('Replay public rules changed within retained history.');
    const { rocks, rules: _rules, ...rest } = scene;
    const packed: PackedScene = { ...rest, rocks: rocks.map(rock => {
      const key = exactReplayIdentity(rock);
      let id = dictionary.get(key);
      if (id === undefined) {
        id = free.pop() ?? entries.length;
        const entry = { rock, key, refs: 0, cost: replayCost(rock) };
        entries[id] = entry; dictionary.set(key, id); charge(entry.cost);
      }
      entries[id]!.refs++;
      return id;
    }) };
    const stored = replayCost(packed);
    costs.set(packed, { stored, expanded }); charge(stored); work += expanded.records; capacity();
    return packed;
  }
  function release(scene: PackedScene) {
    const cost = costs.get(scene)!; charge(cost.stored, -1); work -= cost.expanded.records;
    for (const id of scene.rocks) {
      const entry = entries[id]!;
      if (--entry.refs === 0) { charge(entry.cost, -1); dictionary.delete(entry.key); entries[id] = undefined; free.push(id); }
    }
  }
  const key = (scene: ReplayScene) => JSON.stringify(moveReplayScene(scene, 0));
  function point(scene: ReplayScene) {
    const next = key(scene);
    if (pending) {
      if (pending.hour !== scene.hour) throw new Error('Replay trace contains an uncovered interval.');
      if (pending.lastKey === next) return;
      pending.states.push(pack(scene)); pending.lastKey = next;
      if (pending.uniformKey !== next) pending.uniformKey = undefined;
    } else {
      pending = { hour: scene.hour, states: [pack(scene)], lastKey: next, uniformKey: next };
      charge({ records: 0, bytes: 0 }, 1, 3);
    }
    capacity();
  }
  function span(start: ReplayScene, end: ReplayScene, scene: ReplayScene) {
    point(start);
    const boundary = pending!, previous = result.spans.at(-1), law = key(scene);
    if (previous && previousLaw === law && boundary.uniformKey === law) {
      previous.through = end.hour;
      boundary.states.forEach(release); charge({ records: 0, bytes: 0 }, -1, 3);
    } else {
      result.groups.push({ hour: boundary.hour, states: boundary.states });
      result.spans.push({ from: start.hour, through: end.hour, scene: pack(scene) });
      charge({ records: 0, bytes: 0 }, 1, 3); previousLaw = law;
    }
    pending = undefined; point(end);
  }
  traceObservedReplay(operation, perspective, from, through, { point, span });
  if (!pending || result.groups[0]?.hour !== from && pending.hour !== from || pending.hour !== through) throw new Error('Replay trace did not cover the requested interval.');
  result.groups.push({ hour: pending.hour, states: pending.states }); capacity(true);
  // Compact only live entries; all references remain typed site indexes and every entry is reachable.
  const remap = new Map<number, number>();
  entries.forEach((entry, id) => { if (entry) { remap.set(id, result.siteDictionary.length); result.siteDictionary.push(entry.rock); } });
  const rewrite = (scene: PackedScene) => { scene.rocks = scene.rocks.map(id => remap.get(id)!); };
  result.groups.forEach(group => group.states.forEach(rewrite)); result.spans.forEach(span => rewrite(span.scene));
  encodePackedReplay(result);
  return result;
}
