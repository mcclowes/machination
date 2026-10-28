import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameView } from '../game/visibility';
import { createReplayAliases, presentObservation } from './presentation';

function view(): GameView {
  return { hour: 4, epoch: 123, rocks: [{ id: 'a', name: 'Alpha', x: 1, y: 2, kind: 'core', known: true, owner: 'you', drones: 7, productionAt: 99 }], fleets: [], cargo: { you: 3 }, eliminated: [], winner: null, scheduled: [], events: [{ hour: 4, message: 'PRIVATE' }], coverage: [{ x: 1, y: 2, radius: 10 }], uncertain: [], interceptionUncertain: false };
}

test('projects chart fields and omits legacy optional fields and private clocks', () => {
  assert.deepEqual(presentObservation(view()), { hour: 4, rocks: [{ id: 'a', name: 'Alpha', x: 1, y: 2, known: true, kind: 'core', owner: 'you', drones: 7 }], fleets: [], coverage: [{ x: 1, y: 2, radius: 10 }], cargo: { you: 3 }, eliminated: [], winner: null });
});

const keys = (value: object, expected: string[]) => assert.deepEqual(Object.keys(value).sort(), expected.sort());
function fleet(id: number): GameView['fleets'][number] {
  return { id, owner: 'you', from: 'a', to: 'b', drones: 8, departed: 5, arrives: 9 };
}
function richView(): GameView {
  const v = view();
  v.version = 2;
  v.draw = true;
  v.rules = { players: ['you', 'vesper'], mode: 'mining', victoryTarget: 200, mechanicsVersion: 4, map: { generator: 'balanced.v2', width: 300, height: 200, topology: 'torus' } };
  v.standings = { you: { cargo: 3, funders: 2 } };
  const unit = { id: 'canonical-unit-900', kind: 'pirate' as const, owner: 'vesper' as const, captive: true as const, nextActionAt: 999, lastCourseAt: 888 };
  Object.assign(v.rocks[0]!, { destroyed: true, coreOf: 'you', shield: 0, shieldMax: 20, shieldsDisabled: false, module: 'routing', specialists: [unit] });
  v.rocks.push({ id: 'b', name: 'Remote mine', x: 20, y: 30, kind: 'mine', known: false, owner: 'vesper' }, { id: 'c', name: 'Unknown', x: 50, y: 60, kind: 'unknown', known: false });
  v.fleets = [{ ...fleet(-500), preparing: true, returning: true, giftAt: 6, module: 'scavenger', specialists: [{ ...unit, id: 'seat-alias-unit', captive: undefined }], speed: 16, route: { from: { x: 1, y: 2 }, to: { x: 8, y: 9 } }, intercept: { home: 'a', target: 987 }, interceptionReturn: true, courseLocked: true, lastContacts: [{ id: 111, hour: 2 }] }, fleet(987)];
  return v;
}

// Add an unknown nested property to every object, including arrays and dictionaries.
function inject(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const child of Object.values(value)) inject(child);
  Object.assign(value, { privateSentinel: { secret: 'FORBIDDEN' } });
}

test('nested allowlists preserve observed chart fields and strip unknown properties everywhere', () => {
  const v = richView();
  // Even malformed unknown-site payloads cannot reveal the hidden asset.
  Object.assign(v.rocks[1]!, { drones: 999, specialists: [{ id: 'hidden', kind: 'queen', owner: 'you' }], shield: 100 });
  inject(v);
  const s = presentObservation(v);
  assert.ok(!JSON.stringify(s).includes('FORBIDDEN'));
  keys(s, ['version', 'hour', 'rocks', 'fleets', 'coverage', 'cargo', 'standings', 'eliminated', 'winner', 'draw', 'rules']);
  keys(s.rocks[0]!, ['id', 'name', 'x', 'y', 'known', 'kind', 'owner', 'drones', 'destroyed', 'coreOf', 'shield', 'shieldMax', 'shieldsDisabled', 'module', 'specialists']);
  keys(s.rocks[1]!, ['id', 'name', 'x', 'y', 'known', 'kind', 'owner']);
  keys(s.rocks[2]!, ['id', 'name', 'x', 'y', 'known', 'kind']);
  assert.equal(s.rocks[1]!.kind, 'mine');
  assert.equal(s.rocks[2]!.kind, 'unknown');
  keys(s.rocks[0]!.specialists![0]!, ['id', 'kind', 'owner', 'captive']);
  assert.equal(s.rocks[0]!.specialists![0]!.captive, true);
  keys(s.fleets[0]!, ['id', 'owner', 'from', 'to', 'drones', 'departed', 'arrives', 'preparing', 'returning', 'giftAt', 'module', 'specialists', 'speed', 'route', 'intercept']);
  keys(s.fleets[1]!, ['id', 'owner', 'from', 'to', 'drones', 'departed', 'arrives']);
  assert.equal(s.fleets[0]!.preparing, true);
  keys(s.fleets[0]!.specialists![0]!, ['id', 'kind', 'owner']);
  keys(s.fleets[0]!.route!, ['from', 'to']);
  keys(s.fleets[0]!.route!.from, ['x', 'y']);
  keys(s.fleets[0]!.route!.to, ['x', 'y']);
  keys(s.fleets[0]!.intercept!, ['home', 'target']);
  assert.equal(s.fleets[0]!.intercept!.target, 2);
  keys(s.coverage[0]!, ['x', 'y', 'radius']);
  keys(s.cargo, ['you']);
  keys(s.standings!, ['you']);
  keys(s.standings!.you!, ['cargo', 'funders']);
  keys(s.rules!, ['players', 'mode', 'victoryTarget', 'mechanicsVersion', 'map']);
  keys(s.rules!.map, ['generator', 'width', 'height', 'topology']);
  assert.ok(!JSON.stringify(s).includes('canonical-unit'));
  assert.ok(!JSON.stringify(s).includes('seat-alias'));
});

test('identical observations ignore private queues, offers, seeds, event prose, and funding edges', () => {
  const a = richView();
  const b = richView();
  Object.assign(a, { scheduled: [{ fleetId: -99999, specialists: ['private-unit'], action: { type: 'intercept', target: 12345 } }], recruitment: { you: { used: 8, offers: ['queen'], seed: 333, pool: { queen: 9 } } }, funding: [{ from: 'you', to: 'vesper' }], nextId: 999, epoch: 100 });
  Object.assign(b, { scheduled: [], recruitment: {}, funding: [], nextId: 1, epoch: 200 });
  Object.assign(a.rules!.map, { seed: 123 });
  Object.assign(b.rules!.map, { seed: 456 });
  a.events = [{ hour: 1, message: 'private funding and commands' }];
  b.events = [];
  const aa = createReplayAliases();
  const bb = createReplayAliases();
  assert.deepEqual(presentObservation(a, aa), presentObservation(b, bb));
  assert.equal(aa.fleet(777), 3);
  assert.equal(bb.fleet(777), 3);
  assert.equal(aa.unit('new-unit'), 'u3');
});

test('hidden interception targets never consume aliases, even previously observed targets', () => {
  const aliases = createReplayAliases();
  const v = view();
  v.fleets = [{ ...fleet(900), intercept: { home: 'a', target: 50 } }];
  assert.deepEqual(presentObservation(v, aliases).fleets[0]!.intercept, { home: 'a' });
  v.fleets.push(fleet(50));
  assert.equal(presentObservation(v, aliases).fleets[1]!.id, 2);
  v.fleets.pop();
  assert.deepEqual(presentObservation(v, aliases).fleets[0]!.intercept, { home: 'a' });
  assert.equal(aliases.fleet(600), 3);
});

test('first appearance determines export-local identities across capture, movement, gaps, and reappearance', () => {
  const aliases = createReplayAliases();
  const v = richView();
  const first = presentObservation(v, aliases);
  assert.deepEqual(first.fleets.map(f => f.id), [1, 2]);
  assert.equal(first.rocks[0]!.specialists![0]!.id, 'u1');
  assert.equal(first.fleets[0]!.specialists![0]!.id, 'u2');
  const u = v.rocks[0]!.specialists![0]!;
  v.rocks[0]!.specialists = [];
  v.fleets = [fleet(987), { ...fleet(10), specialists: [{ ...u, owner: 'you', captive: undefined }] }];
  const moved = presentObservation(v, aliases);
  assert.deepEqual(moved.fleets.map(f => f.id), [2, 3]);
  assert.deepEqual(moved.fleets[1]!.specialists![0], { id: 'u1', kind: 'pirate', owner: 'you' });
  v.fleets = [];
  presentObservation(v, aliases);
  v.fleets = [fleet(-500)];
  assert.equal(presentObservation(v, aliases).fleets[0]!.id, 1);
  assert.equal(presentObservation(v).fleets[0]!.id, 1);
  assert.equal(createReplayAliases().unit('seat-alias-unit'), 'u1');
});

test('output is detached from input and earlier frames, including every nested container', () => {
  const v = richView();
  const original = structuredClone(v);
  const aliases = createReplayAliases();
  const a = presentObservation(v, aliases);
  const b = presentObservation(v, aliases);
  function mutate(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    for (const child of Object.values(value)) mutate(child);
    if (Array.isArray(value)) value.length = 0;
    else for (const key of Object.keys(value)) Reflect.deleteProperty(value, key);
  }
  mutate(a);
  assert.deepEqual(v, original);
  assert.deepEqual(b, presentObservation(v, aliases));
  mutate(v);
  assert.deepEqual(b, presentObservation(original, aliases));
});
