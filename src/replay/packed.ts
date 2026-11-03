/** Exact whole-site dictionaries. Validation and playback expand at most one scene at a time. */
import type { ReplayRock, ReplayScene } from './presentation';
import { inspectReplayData, parseReplayJson, utf8Size, validateReplayScene, encodeSharedReplay } from './codec';
import { locateReplay } from './playback';
import { moveReplayScene } from './motion';
import { SHARED_REPLAY_LIMITS as L, type SharedReplay } from './timeline';

export type PackedScene = Omit<ReplayScene, 'rocks' | 'rules'> & { rocks: number[] };
export type PackedReplay = Omit<SharedReplay, 'schemaVersion' | 'groups' | 'spans'> & {
  schemaVersion: 3;
  geometryVersion: 1 | 2;
  siteDictionary: ReplayRock[];
  rules?: ReplayScene['rules'];
  groups: { hour: number; states: PackedScene[] }[];
  spans: { from: number; through: number; scene: PackedScene }[];
};

// Stored nodes and each selected frame retain the existing limit. This separately bounds repeated validation work.
export const PACKED_VALIDATION_RECORDS = L.records * 32;
type Obj = Record<string, any>;
function need(value: unknown): asserts value { if (!value) throw new Error('Invalid packed replay'); }
function object(value: unknown, required: string[], optional: string[] = []): asserts value is Obj {
  need(value !== null && typeof value === 'object' && !Array.isArray(value));
  need(required.every(k => Object.hasOwn(value, k)) && Object.keys(value).every(k => required.includes(k) || optional.includes(k)));
}
function array(value: unknown, max: number = L.records): asserts value is any[] { need(Array.isArray(value) && value.length <= max); }
function hour(value: unknown): asserts value is number { need(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER); }

export function exactReplayIdentity(value: unknown): string {
  if (typeof value === 'number' && Object.is(value, -0)) return '-0';
  if (Array.isArray(value)) return `[${value.map(exactReplayIdentity).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${exactReplayIdentity((value as Obj)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

function frame(replay: PackedReplay, scene: PackedScene): ReplayScene {
  return { ...scene, rocks: scene.rocks.map(id => replay.siteDictionary[id]!), ...(replay.rules ? { rules: replay.rules } : {}) };
}

export function validatePackedReplay(value: unknown): asserts value is PackedReplay {
  inspectReplayData(value);
  object(value, ['kind', 'schemaVersion', 'geometryVersion', 'presentationVersion', 'history', 'perspective', 'from', 'through', 'siteDictionary', 'groups', 'spans'], ['rules']);
  need(value.kind === 'machination.observed-timeline' && value.schemaVersion === 3 && [1, 2].includes(value.geometryVersion));
  need(value.presentationVersion === 1 && value.history === 'canonical-events');
  need(['you', 'vesper', 'null', 'aether', 'umbra', 'orbit', 'prism', 'echo', 'nadir', 'zenith'].includes(value.perspective));
  hour(value.from); hour(value.through); need(value.through >= value.from);
  array(value.siteDictionary); array(value.groups); array(value.spans);
  need(value.groups.length > 0 && value.spans.length === value.groups.length - 1);
  const dictionaryCosts = value.siteDictionary.map((site: unknown) => inspectReplayData(site));
  const rulesCost = Object.hasOwn(value, 'rules') ? inspectReplayData(value.rules) : 0;
  const referenced = new Set<number>();
  let work = 0;
  function preflight(scene: unknown, at: number) {
    object(scene, ['hour', 'rocks', 'fleets', 'coverage', 'cargo', 'eliminated', 'winner'], ['pulse', 'version', 'standings', 'draw', 'compact', 'foresight', 'discoveries']);
    need(scene.hour === at); array(scene.rocks, L.sites);
    let expanded = inspectReplayData(scene) + rulesCost;
    for (const id of scene.rocks) {
      need(Number.isSafeInteger(id) && id >= 0 && id < dictionaryCosts.length);
      referenced.add(id); expanded += dictionaryCosts[id]! - 1;
    }
    need(expanded <= L.records);
    work += expanded; need(work <= PACKED_VALIDATION_RECORDS);
  }
  for (let i = 0; i < value.groups.length; i++) {
    const group = value.groups[i]; object(group, ['hour', 'states']); hour(group.hour); array(group.states);
    need(group.states.length > 0 && (i === 0 ? group.hour === value.from : group.hour > value.groups[i - 1].hour));
    group.states.forEach((scene: unknown) => preflight(scene, group.hour));
  }
  need(value.groups.at(-1).hour === value.through);
  for (let i = 0; i < value.spans.length; i++) {
    const span = value.spans[i]; object(span, ['from', 'through', 'scene']);
    need(span.from === value.groups[i].hour && span.through === value.groups[i + 1].hour && span.through > span.from);
    preflight(span.scene, span.from);
  }
  need(referenced.size === value.siteDictionary.length);
  const replay = value as PackedReplay;
  let chart: Map<string, string> | undefined;
  // Check the entire expansion budget before any semantic validation or materialization.
  function check(scene: PackedScene) {
    const expanded = frame(replay, scene);
    inspectReplayData(expanded);
    validateReplayScene(expanded);
    need((replay.geometryVersion === 2) === expanded.rocks.some(r => !!r.drift));
    if (expanded.rules) need(expanded.rules.players.includes(replay.perspective));
    const next = new Map(expanded.rocks.map(r => [r.id, exactReplayIdentity({ name: r.name, ...(r.drift ? { drift: r.drift } : { x: r.x, y: r.y }) })]));
    if (!chart) chart = next;
    else need(chart.size === next.size && [...next].every(([id, key]) => chart!.get(id) === key));
  }
  for (const group of replay.groups) for (const scene of group.states) check(scene);
  for (const span of replay.spans) check(span.scene);
}

/** Takes a bounded legacy timeline. Generation of larger packed timelines needs incremental interning. */
export function packSharedReplay(replay: SharedReplay): PackedReplay {
  encodeSharedReplay(replay);
  const dictionary: ReplayRock[] = [], keys = new Map<string, number>();
  const publicRules = replay.groups[0]!.states[0]!.rules;
  const rulesKey = exactReplayIdentity(publicRules ?? null);
  function pack(scene: ReplayScene): PackedScene {
    need(exactReplayIdentity(scene.rules ?? null) === rulesKey);
    const { rocks, rules: _rules, ...rest } = scene;
    return { ...rest, rocks: rocks.map(rock => {
      const key = exactReplayIdentity(rock);
      let id = keys.get(key);
      if (id === undefined) { id = dictionary.length; keys.set(key, id); dictionary.push(rock); }
      return id;
    }) };
  }
  const { groups, spans, schemaVersion, ...rest } = replay;
  const result: PackedReplay = { ...rest, schemaVersion: 3, geometryVersion: schemaVersion, siteDictionary: dictionary,
    ...(publicRules ? { rules: publicRules } : {}),
    groups: groups.map(g => ({ hour: g.hour, states: g.states.map(pack) })),
    spans: spans.map(s => ({ from: s.from, through: s.through, scene: pack(s.scene) })) };
  validatePackedReplay(result);
  return clone(result);
}

// Plain validated JSON data only. Unlike JSON stringify/parse, this retains signed zero on Hermes too.
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  return value;
}

export function seekPackedReplay(replay: PackedReplay, atHour: number, ordinal?: number): ReplayScene {
  const at = locateReplay(replay, atHour, ordinal);
  const source = at.exact ? at.group.states[at.ordinal] : replay.spans[at.index]?.scene;
  if (!source) throw new RangeError('Replay has no scene at this position');
  return moveReplayScene(clone(frame(replay, source)), at.hour);
}

export function encodePackedReplay(replay: PackedReplay): string {
  validatePackedReplay(replay);
  const raw = serialize(replay); need(utf8Size(raw) <= L.bytes); return raw;
}

// JSON accepts -0, but JSON.stringify normalizes it. Preserve it without runtime-specific rawJSON support.
function serialize(value: unknown): string {
  if (typeof value === 'number' && Object.is(value, -0)) return '-0';
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}:${serialize(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function decodePackedReplay(raw: string): PackedReplay {
  const value = parseReplayJson(raw); validatePackedReplay(value); return value;
}
