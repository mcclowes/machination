import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameView } from '../game/visibility';
import { presentObservation } from './presentation';
import { SHARED_REPLAY_LIMITS as L, type SharedReplay } from './timeline';
import { decodeSharedReplay, encodeSharedReplay, utf8Size } from './codec';

function fixture(): SharedReplay {
  const view: GameView = {
    version: 2, hour: 0, epoch: 123, scheduled: [], events: [], uncertain: [], interceptionUncertain: false,
    rocks: [
      { id: 'a', name: '<b>Alpha</b>', x: 0, y: 0, kind: 'core', known: true, owner: 'you', drones: 7.5, coreOf: 'you', shield: 0, shieldMax: 20, shieldsDisabled: false, module: 'routing', specialists: [{ id: 'private-unit', kind: 'queen', owner: 'you' }] },
      { id: 'b', name: 'Remote', x: 10, y: 20, kind: 'mine', known: false, owner: 'vesper' },
    ],
    fleets: [{ id: 987, owner: 'you', from: 'a', to: 'b', drones: 3, departed: 0, arrives: 2.5, preparing: true, returning: true, giftAt: 1, speed: 4, module: 'scavenger', specialists: [{ id: 'private-2', kind: 'pirate', owner: 'vesper', captive: true }], route: { from: { x: 0, y: 0 }, to: { x: 10, y: 20 } }, intercept: { home: 'a', target: 987 } }],
    coverage: [{ x: 0, y: 0, radius: 30 }], cargo: { you: 0.25 }, standings: { you: { cargo: 0.25, funders: 1 } }, eliminated: [], winner: null,
    rules: { players: ['you', 'vesper'], portraits: ['pilot', 'admiral'], mode: 'mining', victoryTarget: 200, mechanicsVersion: 5, map: { generator: 'balanced.v2', width: 100, height: 80, topology: 'torus' } },
  };
  const first = presentObservation(view);
  const second = structuredClone(first); second.hour = 0.5; second.rocks[0]!.drones = 8;
  const third = structuredClone(second); third.rocks[0]!.owner = 'vesper'; third.rocks[0]!.kind = 'factory'; third.rocks[0]!.destroyed = true;
  return { kind: 'machination.observed-timeline', schemaVersion: 1, presentationVersion: 1, history: 'canonical-events', perspective: 'you', from: 0, through: 0.5,
    groups: [{ hour: 0, states: [first] }, { hour: 0.5, states: [second, third] }], spans: [{ from: 0, through: 0.5, scene: structuredClone(first) }] };
}
function reject(change: (r: any) => void) {
  const r = fixture(); change(r); const before = structuredClone(r);
  assert.throws(() => encodeSharedReplay(r)); assert.deepEqual(r, before);
  assert.throws(() => decodeSharedReplay(JSON.stringify(r))); assert.deepEqual(r, before);
}

test('actual public projector roundtrip preserves fractional bounds, causal order, metadata, and detached data', () => {
  const r = fixture(); const raw = encodeSharedReplay(r); const decoded = decodeSharedReplay(raw);
  assert.deepEqual(decoded, r); assert.ok(!raw.includes('private-unit')); assert.ok(!raw.includes('987'));
  assert.equal(decoded.groups[1]!.states[0]!.rocks[0]!.owner, 'you');
  assert.equal(decoded.groups[1]!.states[1]!.rocks[0]!.owner, 'vesper');
  decoded.groups[0]!.states[0]!.rules!.portraits![0] = 'engineer';
  assert.equal(r.groups[0]!.states[0]!.rules!.portraits![0], 'pilot');
  assert.equal(r.groups[0]!.states[0]!.rocks[0]!.name, '<b>Alpha</b>');
});

test('zero duration has exactly one group, including ordered same-hour states', () => {
  const r = fixture(); r.through = 0; r.groups = [r.groups[0]!]; r.spans = [];
  r.groups[0]!.states.push(structuredClone(r.groups[0]!.states[0]!));
  assert.deepEqual(decodeSharedReplay(encodeSharedReplay(r)), r);
  reject(r => { r.through = 0; });
});

test('legacy scenes without optional public metadata remain valid', () => {
  const r = fixture();
  for (const s of [...r.groups.flatMap(g => g.states), ...r.spans.map(s => s.scene)]) { delete s.rules; delete s.version; delete s.standings; }
  assert.deepEqual(decodeSharedReplay(encodeSharedReplay(r)), r);
});

test('every nested object and array refuses private extra properties before export', () => {
  const paths: string[][] = [];
  function walk(v: any, path: string[]) {
    if (!v || typeof v !== 'object') return;
    paths.push(path); for (const k of Object.keys(v)) walk(v[k], [...path, k]);
  }
  walk(fixture(), []);
  for (const path of paths) {
    const r: any = fixture(); let target = r; for (const k of path) target = target[k];
    target.privateSentinel = 'SECRET'; assert.throws(() => encodeSharedReplay(r), path.join('.'));
    if (!Array.isArray(target)) assert.throws(() => decodeSharedReplay(JSON.stringify(r)), path.join('.'));
  }
});

test('private envelopes and forbidden nested fields are refused', () => {
  for (const key of ['seed', 'queue', 'recruitment', 'events', 'funding', 'session', 'room', 'checkpoint', 'metadata', 'url']) {
    reject(r => { r.groups[0].states[0][key] = 'PRIVATE'; });
    reject(r => { r.groups[0].states[0].rules.map[key] = 'PRIVATE'; });
  }
  for (const body of [{ kind: 'machination.save', game: fixture() }, { kind: 'machination.replay', archive: fixture() }, null, [], {}, 1]) assert.throws(() => decodeSharedReplay(JSON.stringify(body)));
});

const cases: [string, (r: any) => void][] = [
  ['schema', r => r.schemaVersion = 2], ['presentation', r => r.presentationVersion = 2], ['history', r => r.history = 'verified'],
  ['negative time', r => r.from = -1], ['bounds', r => r.groups[1].hour = 0.6], ['empty states', r => r.groups[0].states = []],
  ['duplicate hours', r => r.groups[1].hour = 0], ['order', r => r.groups.reverse()], ['missing span', r => r.spans = []],
  ['span bounds', r => r.spans[0].through = 0.4], ['span hour', r => r.spans[0].scene.hour = 0.1], ['state hour', r => r.groups[1].states[0].hour = 0],
  ['static name', r => r.groups[1].states[0].rocks[0].name = 'Other'], ['static coord', r => r.spans[0].scene.rocks[0].x = 3],
  ['static rules', r => r.groups[1].states[0].rules.victoryTarget = 300], ['unknown payload', r => r.groups[0].states[0].rocks[1].drones = 3],
  ['duplicate site', r => r.groups[0].states[0].rocks.push(r.groups[0].states[0].rocks[0])], ['coordinate', r => r.groups[0].states[0].rocks[0].x = L.coordinate + 1],
  ['name bound', r => r.groups[0].states[0].rocks[0].name = 'a'.repeat(L.text + 1)], ['boolean', r => r.groups[0].states[0].rocks[0].known = 1],
  ['module', r => r.groups[0].states[0].rocks[0].module = 'private'], ['kind', r => r.groups[0].states[0].rocks[0].specialists[0].kind = 'private'],
  ['unit alias', r => r.groups[0].states[0].rocks[0].specialists[0].id = 'canonical-8'], ['unit zero', r => r.groups[0].states[0].rocks[0].specialists[0].id = 'u0'],
  ['duplicate unit', r => r.groups[0].states[0].fleets[0].specialists[0].id = 'u1'], ['fleet alias', r => r.groups[0].states[0].fleets[0].id = 0],
  ['duplicate fleet', r => r.groups[0].states[0].fleets.push(r.groups[0].states[0].fleets[0])], ['from ref', r => r.groups[0].states[0].fleets[0].from = 'missing'],
  ['to ref', r => r.groups[0].states[0].fleets[0].to = 'missing'], ['home ref', r => r.groups[0].states[0].fleets[0].intercept.home = 'missing'],
  ['target ref', r => r.groups[0].states[0].fleets[0].intercept.target = 2], ['negative cargo', r => r.groups[0].states[0].cargo.you = -1],
  ['fractional funders', r => r.groups[0].states[0].standings.you.funders = 1.2], ['foreign roster', r => r.groups[0].states[0].cargo.echo = 2],
  ['portrait', r => r.groups[0].states[0].rules.portraits[0] = 'https://host/image'], ['portrait count', r => r.groups[0].states[0].rules.portraits.pop()],
  ['portrait duplicate', r => r.groups[0].states[0].rules.portraits[0] = 'admiral'], ['rules version', r => r.groups[0].states[0].rules.mechanicsVersion = 6],
  ['radius', r => r.groups[0].states[0].coverage[0].radius = -1], ['eliminated', r => r.groups[0].states[0].eliminated = ['you', 'you']],
];
for (const [name, change] of cases) test(`rejects ${name} without mutation`, () => reject(change));

test('non-JSON encoder inputs cannot run hooks, hide fields, or mutate the input', () => {
  for (const value of [undefined, NaN, Infinity, () => 1]) {
    const r: any = fixture(); r.groups[0].states[0].cargo.you = value; assert.throws(() => encodeSharedReplay(r));
  }
  let invoked = false;
  const r = fixture(); Object.defineProperty(r, 'toJSON', { value: () => { invoked = true; return {}; } });
  assert.throws(() => encodeSharedReplay(r)); assert.equal(invoked, false);
  const getter = fixture(); Object.defineProperty(getter, 'kind', { enumerable: true, get() { invoked = true; return 'machination.observed-timeline'; } });
  assert.throws(() => encodeSharedReplay(getter)); assert.equal(invoked, false);
  const cycle: any = fixture(); cycle.groups[0].states[0].cycle = cycle; assert.throws(() => encodeSharedReplay(cycle));
});

test('UTF-8, size, aggregate work, and preparse depth bounds', () => {
  for (const s of ['', 'ascii', 'é', '漢', '😀', '\ud800', '\udfff', '\ud800A']) assert.equal(utf8Size(s), new TextEncoder().encode(s).length);
  assert.throws(() => decodeSharedReplay(' '.repeat(L.bytes + 1)));
  assert.throws(() => decodeSharedReplay('é'.repeat(L.bytes / 2 + 1)));
  assert.throws(() => decodeSharedReplay('['.repeat(L.depth + 1) + ']'.repeat(L.depth + 1)));
  assert.throws(() => decodeSharedReplay('{broken'));
  const r: any = fixture(); r.groups[0].states = Array.from({ length: L.records + 1 }, () => null); assert.throws(() => encodeSharedReplay(r));
  const large = fixture(); large.groups[0]!.states = Array.from({ length: 4000 }, () => structuredClone(large.groups[0]!.states[0]!));
  assert.throws(() => encodeSharedReplay(large));
  assert.throws(() => decodeSharedReplay(JSON.stringify(large)));
  const quoted = fixture(); for (const s of [...quoted.groups.flatMap(g => g.states), ...quoted.spans.map(s => s.scene)]) s.rocks[0]!.name = '[{\\"}]';
  assert.deepEqual(decodeSharedReplay(encodeSharedReplay(quoted)), quoted);
});


test('scene capacities and malformed nested shapes fail explicitly', () => {
  reject(r => { r.groups[0].states[0].rocks = Array.from({ length: L.sites + 1 }, (_, i) => ({ id: `r${i}`, name: 'Site', x: 0, y: 0, known: false, kind: 'unknown' })); });
  for (const change of [
    (s: any) => { delete s.fleets[0].route.from.x; },
    (s: any) => { s.fleets[0].route.to.y = '1'; },
    (s: any) => { delete s.standings.you.funders; },
    (s: any) => { s.fleets[0].arrives = -1; },
    (s: any) => { s.fleets[0].arrives = s.fleets[0].departed; },
    (s: any) => { s.coverage[0].radius = null; },
    (s: any) => { s.fleets[0].preparing = false; },
    (s: any) => { s.rules.players = ['you', 'you']; },
    (s: any) => { s.rules.map.generator = 'private-seeded'; },
    (s: any) => { s.rocks[0].specialists[0].captive = false; },
  ]) reject(r => change(r.groups[0].states[0]));
});
