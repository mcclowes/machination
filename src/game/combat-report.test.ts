import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame, dispatch, type Game } from './simulation';
import { dispatchIntercept } from './interception';
import { giftTransfer } from './gifts';
import type { EncounterAsset, EncounterReport } from './combat-report';
import type { SpecialistKind } from './specialist-catalog';
import { createConfiguredGame } from './world';
import { nextRouteEncounter } from './route-encounters';

function record(game: Game, hour: number): { end: Game; reports: EncounterReport[] } {
  const reports: EncounterReport[] = [];
  const end = advance(game, hour, { rivals: false, encounters: report => reports.push(report) });
  return { end, reports };
}

test('an arrival report matches the site the public advance produced', () => {
  const sent = dispatch(createGame(0), 'c', 'f', 40, 'you');
  const fleet = sent.fleets[0]!;
  const { end, reports } = record(sent, fleet.arrives);
  assert.equal(reports.length, 1);
  const [report] = reports as [EncounterReport];
  const site = end.rocks.find(r => r.id === 'f')!;
  assert.equal(report.kind, 'arrival');
  assert.equal(report.site, 'f');
  assert.equal(report.hour, fleet.arrives);
  assert.deepEqual(report.before[0].asset, { type: 'hauler', id: fleet.id });
  assert.equal(report.before[0].drones, 40);
  assert.equal(report.after[0], null);
  assert.deepEqual(report.after[1], { asset: { type: 'site', id: 'f' }, owner: site.owner, drones: site.drones, shield: site.shield ?? 0, specialists: (site.specialists ?? []).map(u => ({ id: u.id, kind: u.kind, owner: u.owner, captive: !!u.captive })) });
  assert.equal(report.outcome, site.owner === 'you' ? 'captured' : 'held');
});

const KINDS: SpecialistKind[] = ['martyr', 'elder', 'saboteur', 'thief', 'infiltrator', 'doubleAgent', 'assassin', 'lieutenant', 'warHero', 'helmsman', 'engineer', 'inspector', 'general', 'king'];
function routeEncounter(a: SpecialistKind, b: SpecialistKind, dronesA = 20, dronesB = 30): { game: Game; hour: number } {
  let game = createGame(0);
  game.rocks.find(r => r.id === 'c')!.specialists!.push({ id: 'encounter-a', kind: a, owner: 'you' });
  game.rocks.find(r => r.id === 'f')!.specialists!.push({ id: 'encounter-b', kind: b, owner: 'vesper' });
  game = dispatch(game, 'c', 'f', dronesA, 'you', false, ['encounter-a']);
  game = dispatch(game, 'f', 'c', dronesB, 'vesper', false, ['encounter-b']);
  const [first, second] = game.fleets;
  const ta = first!.arrives - first!.departed; const tb = second!.arrives - second!.departed;
  return { game, hour: (1 + first!.departed / ta + second!.departed / tb) / (1 / ta + 1 / tb) };
}
const hauler = (game: Game, asset: EncounterAsset | null) => asset && asset.asset.type === 'hauler' ? game.fleets.find(f => f.id === asset.asset.id) : undefined;
function deeplyFrozen(value: unknown): boolean {
  return !value || typeof value !== 'object' || Object.isFrozen(value) && Object.values(value).every(deeplyFrozen);
}

test('recording encounters never changes the advanced game', () => {
  for (const a of KINDS) for (const b of KINDS) {
    const { game, hour } = routeEncounter(a, b);
    const quiet = advance(game, hour + 30, { rivals: false });
    const { end } = record(game, hour + 30);
    assert.equal(JSON.stringify(end), JSON.stringify(quiet), `${a} vs ${b}`);
  }
});

test('route reports agree with the haulers the public advance leaves behind, for every specialist pairing', () => {
  for (const a of KINDS) for (const b of KINDS) {
    const { game, hour } = routeEncounter(a, b);
    const { end, reports } = record(game, hour);
    const label = `${a} vs ${b}`;
    assert.equal(reports.length, 1, label);
    const [report] = reports as [EncounterReport];
    assert.equal(report.kind, 'route', label);
    assert.ok(deeplyFrozen(report), label);
    assert.deepEqual(report.before.map(s => s.drones), [20, 30], label);
    for (const side of report.after) {
      if (!side) continue;
      const fleet = hauler(end, side)!;
      assert.ok(fleet, label);
      assert.equal(side.owner, fleet.owner, label);
      assert.equal(side.drones, fleet.drones, label);
      assert.deepEqual(side.specialists.map(u => u.id).sort(), (fleet.specialists ?? []).map(u => u.id).sort(), label);
    }
    for (const [i, side] of report.after.entries()) if (!side) assert.ok(!end.fleets.some(f => f.id === report.before[i]!.asset.id), label);
    if (report.outcome === 'ended') assert.ok(report.steps.some(s => s.type === 'ability' && s.ended), label);
  }
});

test('arrival reports capture preparing defenders and shield absorption before the drone exchange', () => {
  let game = createGame(0);
  const target = game.rocks.find(r => r.id === 'f')!;
  Object.assign(target, { drones: 10, shield: 6, shieldMax: 10, shieldAt: 1e6, productionAt: 1e6 });
  target.specialists = target.specialists!.filter(u => u.kind === 'queen');
  game = dispatch(game, 'c', 'f', 40, 'you');
  const attack = game.fleets[0]!;
  game.fleets.push({ id: 99, owner: 'vesper', from: 'f', to: 'c', drones: 7, departed: attack.arrives + 5, arrives: attack.arrives + 20, preparing: true, specialists: [{ id: 'launch-thief', kind: 'thief', owner: 'vesper' }] });
  const { end, reports } = record(game, attack.arrives);
  const [report] = reports as [EncounterReport];
  assert.equal(report.before[1].drones, 10);
  assert.deepEqual(report.reinforcement!.haulers.map(h => [h.asset, h.drones, h.specialists.map(u => u.id)]), [[{ type: 'hauler', id: 99 }, 7, ['launch-thief']]]);
  assert.equal(report.reinforcement!.site.drones, 17);
  assert.ok(report.reinforcement!.site.specialists.some(u => u.id === 'launch-thief'));
  assert.equal(report.shield!.before, 6);
  assert.equal(report.shield!.absorbed, 6);
  assert.equal(report.shield!.after, 0);
  const site = end.rocks.find(r => r.id === 'f')!;
  assert.equal(report.outcome, 'captured');
  assert.equal(report.winner, 0);
  assert.equal(site.owner, 'you');
  assert.equal(report.after[1]!.drones, site.drones);
  assert.equal(site.drones, 40 - 6 - 17 + report.repaired);
  assert.ok(report.captured.includes('launch-thief'));
  assert.ok(!end.fleets.some(f => f.id === 99));
});

test('an even route encounter is a tie that removes both haulers', () => {
  const { game, hour } = routeEncounter('helmsman', 'helmsman', 25, 25);
  const { reports } = record(game, hour);
  const [report] = reports as [EncounterReport];
  assert.equal(report.outcome, 'tie');
  assert.equal(report.winner, undefined);
  assert.deepEqual(report.after, [null, null]);
  assert.deepEqual(report.steps, []);
});

test('ability early exits are reported as the ending step, with no drone exchange afterwards', () => {
  const { game, hour } = routeEncounter('infiltrator', 'thief');
  const { end, reports } = record(game, hour);
  const [report] = reports as [EncounterReport];
  assert.equal(report.outcome, 'ended');
  assert.deepEqual(report.steps.map(s => s.type === 'ability' && [s.priority, s.kinds, s.ended]), [[4, ['thief'], false], [5, ['infiltrator'], true]]);
  assert.deepEqual(report.after.map(s => s!.drones), end.fleets.map(f => f.drones));
  assert.equal(report.shield, undefined);
});

test('a martyr arrival reports the destroyed site and no surviving hauler', () => {
  const game = createGame(0);
  game.rocks.find(r => r.id === 'c')!.specialists!.push({ id: 'martyr', owner: 'you', kind: 'martyr' });
  const sent = dispatch(game, 'c', 'f', 5, 'you', false, ['martyr']);
  const { reports } = record(sent, sent.fleets[0]!.arrives);
  const [report] = reports as [EncounterReport];
  assert.equal(report.outcome, 'ended');
  assert.equal(report.after[0], null);
  assert.equal(report.after[1]!.destroyed, true);
  assert.equal(report.steps[0]!.type === 'ability' && report.steps[0]!.priority, 1);
});

test('elder asymmetry is reported as suppression and stops later priorities', () => {
  const { game, hour } = routeEncounter('elder', 'lieutenant');
  const { reports } = record(game, hour);
  const [report] = reports as [EncounterReport];
  assert.equal(report.suppressed, true);
  assert.deepEqual(report.steps.map(s => s.type === 'ability' && s.priority), [2]);
});

test('owner-wide generals are reported as a global step with the drones they removed', () => {
  const { game, hour } = routeEncounter('helmsman', 'helmsman', 30, 30);
  game.rocks.find(r => r.id === 'c')!.specialists!.push({ id: 'home-general', owner: 'you', kind: 'general' });
  const { end, reports } = record(game, hour);
  const [report] = reports as [EncounterReport];
  const global = report.steps.find(s => s.type === 'global')!;
  assert.ok(global && global.type === 'global');
  assert.deepEqual(global.generals, [0, 10]);
  assert.deepEqual(global.after.map(s => s.drones), [30, 20]);
  assert.equal(report.outcome, 'won');
  assert.equal(report.winner, 0);
  assert.equal(report.after[0]!.drones, end.fleets.find(f => f.id === report.before[0].asset.id)!.drones);
});

test('interceptions are reported with their own kind', () => {
  const base = createGame(0);
  const site = base.rocks.find(r => r.id === 'c')!;
  site.drones = 100;
  site.specialists!.push({ id: 'pirate-test', owner: 'you', kind: 'pirate' });
  base.rocks.find(r => r.id === 'e')!.drones = 40;
  const target = advance(dispatch(base, 'e', 'c', 40, 'vesper'), 3, { rivals: false });
  const launched = dispatchIntercept(target, 'c', target.fleets[0]!.id, 50, 'you', false, ['pirate-test']);
  const rig = launched.fleets.find(f => f.intercept)!;
  const { reports } = record(launched, rig.arrives);
  const [report] = reports as [EncounterReport];
  assert.equal(report.kind, 'interception');
  assert.deepEqual(report.before.map(s => s.asset), [{ type: 'hauler', id: rig.id }, { type: 'hauler', id: target.fleets[0]!.id }]);
  assert.equal(report.outcome, 'won');
  assert.equal(report.after[0]!.drones, 10);
  assert.equal(report.after[1], null);
});

test('a gift arrival is reported as a transfer, while a plain friendly arrival is not an encounter', () => {
  const gifted = giftTransfer(createGame(0), 'c', 'f', 5, 'you', 'vesper');
  const { reports } = record(gifted, gifted.fleets[0]!.arrives);
  assert.deepEqual(reports.map(r => [r.kind, r.outcome, r.before[0].owner, r.after[1]!.owner]), [['gift', 'transferred', 'you', 'vesper']]);
  const friendly = dispatch(createGame(0), 'c', 'a', 5, 'you');
  assert.deepEqual(record(friendly, friendly.fleets[0]!.arrives).reports, []);
});

test('a route contact is reported before the arrival it weakened, in simulation order', () => {
  const { game } = routeEncounter('helmsman', 'thief', 40, 10);
  const attack = game.fleets.find(f => f.owner === 'you')!;
  const { end, reports } = record(game, attack.arrives);
  assert.deepEqual(reports.map(r => r.kind), ['route', 'arrival']);
  const [route, arrival] = reports as [EncounterReport, EncounterReport];
  assert.ok(route.hour < arrival.hour);
  assert.equal(route.winner, 0);
  assert.deepEqual(arrival.before[0], route.after[0]);
  assert.equal(arrival.after[1]!.drones, end.rocks.find(r => r.id === 'f')!.drones);
});

for (const revision of [12, 13] as const) test(`configured revision ${revision} reports preserve outcomes for all specialist pairs and dispatch orders`, () => {
  for (const a of KINDS) for (const b of KINDS) for (const reverse of [false, true]) {
    let game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 2026);
    game.rules!.mechanicsVersion = revision;
    const sites = (['you', 'vesper'] as const).map(owner => game.rocks.find(r => r.owner === owner && !r.coreOf)!);
    for (const site of game.rocks) { site.productionAt = 1000; site.shieldAt = 1000; }
    for (const [i, kind] of [a, b].entries()) {
      Object.assign(sites[i]!, { x: 20 + i * 30, y: 20, drones: [37, 29][i]!, shield: 0 });
      sites[i]!.specialists = [{ id: `pair-${i}`, owner: sites[i]!.owner!, kind }];
    }
    for (const i of reverse ? [1, 0] : [0, 1]) game = dispatch(game, sites[i]!.id, sites[1 - i]!.id, [37, 29][i]!, sites[i]!.owner!, false, [`pair-${i}`]);
    game = advance(game, game.fleets[0]!.departed, { rivals: false });
    const hour = nextRouteEncounter(game);
    assert.ok(Number.isFinite(hour));
    const plain = advance(game, hour, { rivals: false });
    const { end, reports } = record(game, hour);
    const label = `${revision}: ${a}/${b}, reverse=${reverse}`;
    assert.equal(JSON.stringify(end), JSON.stringify(plain), label);
    assert.equal(reports.length, 1, label);
    const report = reports[0]!;
    for (const [i, side] of report.after.entries()) {
      const fleet = end.fleets.find(f => f.id === report.before[i]!.asset.id);
      assert.equal(!!side, !!fleet, label);
      if (side && fleet) {
        assert.equal(side.owner, fleet.owner, label);
        assert.equal(side.drones, fleet.drones, label);
        assert.deepEqual(side.specialists, (fleet.specialists ?? []).map(u => ({ id: u.id, kind: u.kind, owner: u.owner, captive: !!u.captive })), label);
      }
    }
  }
});
