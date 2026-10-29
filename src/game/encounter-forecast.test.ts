import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfiguredGame } from './world';
import { advance, dispatch } from './simulation';
import { observe } from './visibility';
import { forecastEncounters } from './encounter-forecast';

function battle() {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 2026);
  game.rules!.map.width = 500; game.rules!.map.height = 500;
  for (const [i, site] of game.rocks.entries()) {
    site.x = 150 + i; site.y = 150;
    site.productionAt = 1000; site.shieldAt = 1000;
  }
  const source = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const target = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  Object.assign(source, { x: 20, y: 20, drones: 60, shield: 0 });
  Object.assign(target, { x: 28, y: 20, drones: 46, shield: 3 });
  return { game, source, target };
}

test('contextual combat predicts from the observation without mutating it', () => {
  const { game, source, target } = battle();
  const launched = dispatch(game, source.id, target.id, 6, 'you');
  const view = observe(launched, 'you', id => -id * 91);
  const saved = structuredClone(view);
  const result = forecastEncounters(view, 'you', view.fleets[0]!.id);
  assert.equal(result.status, 'resolved');
  assert.equal(result.from, view.hour);
  assert.equal(result.reports.length, 1);
  const report = result.reports[0]!;
  assert.deepEqual(report.before[0].asset, { type: 'hauler', id: -91 });
  assert.equal(report.before[1].drones, 46);
  assert.equal(report.shield!.absorbed, 3);
  assert.equal(report.winner, 1);
  assert.equal(report.after[1]!.drones, 43);
  const actual = advance(launched, launched.fleets[0]!.arrives, { rivals: false });
  assert.equal(report.after[1]!.drones, actual.rocks.find(r => r.id === target.id)!.drones);
  assert.deepEqual(view, saved);
});

test('hidden global specialists and rival queued orders cannot influence an observed prediction', () => {
  const { game, source, target } = battle();
  target.drones = 20; target.shield = 0;
  target.specialists = [{ id: 'defender', owner: 'vesper', kind: 'helmsman' }];
  const hidden = game.rocks.find(r => r.owner === 'vesper' && r.id !== target.id && !r.coreOf)!;
  Object.assign(hidden, { x: 20, y: 150, drones: 40 });
  const launched = dispatch(game, source.id, target.id, 60, 'you');
  const before = observe(launched, 'you');
  assert.equal(before.rocks.find(r => r.id === hidden.id)!.known, false);
  const changed = structuredClone(launched);
  changed.rocks.find(r => r.id === hidden.id)!.specialists = [{ id: 'secret-general', owner: 'vesper', kind: 'general' }];
  changed.scheduled!.push({ id: 'private-plan', owner: 'vesper', from: hidden.id, to: target.id, drones: 40, executeAt: 0.1 });
  const after = observe(changed, 'you');
  assert.deepEqual(after, before);
  const predicted = forecastEncounters(after, 'you', after.fleets[0]!.id);
  assert.deepEqual(predicted, forecastEncounters(before, 'you', before.fleets[0]!.id));
  assert.equal(predicted.incomplete, true);
  assert.equal(predicted.reports[0]!.after[1]!.drones, 40);
  const actual = advance(changed, changed.fleets[0]!.arrives, { rivals: false });
  assert.notEqual(actual.rocks.find(r => r.id === target.id)!.drones, 40, 'hidden authoritative bonuses differ but never reach the prediction');
  assert.ok(!JSON.stringify(predicted).includes('secret-general'));
});

test('unknown destinations and lost interception targets produce no invented combat totals', () => {
  const { game, source, target } = battle();
  target.x = 20; target.y = 150;
  const launched = dispatch(game, source.id, target.id, 6, 'you');
  const view = observe(launched, 'you');
  assert.equal(view.rocks.find(r => r.id === target.id)!.known, false);
  const unknown = forecastEncounters(view, 'you', view.fleets[0]!.id);
  assert.equal(unknown.status, 'unknown-destination');
  assert.deepEqual(unknown.reports, []);
  const interception = structuredClone(view);
  interception.fleets[0]!.intercept = { home: source.id };
  const lost = forecastEncounters(interception, 'you', interception.fleets[0]!.id);
  assert.equal(lost.status, 'unknown-interception');
  assert.deepEqual(lost.reports, []);
});

test('earlier opposing-route combat weakens the reported arrival and preserves opaque ids in every step', () => {
  const { game, source, target } = battle();
  let launched = dispatch(game, source.id, target.id, 40, 'you');
  launched = dispatch(launched, target.id, source.id, 10, 'vesper');
  const underway = advance(launched, launched.fleets[0]!.departed, { rivals: false });
  const view = observe(underway, 'you', id => 1000 - id);
  const selected = view.fleets.find(f => f.owner === 'you')!;
  const forecast = forecastEncounters(view, 'you', selected.id);
  assert.equal(forecast.status, 'resolved');
  assert.deepEqual(forecast.reports.map(r => r.kind), ['route', 'arrival']);
  const [route, arrival] = forecast.reports;
  assert.ok(route!.hour < arrival!.hour);
  assert.deepEqual(route!.before.map(s => s.asset), [{ type: 'hauler', id: 999 }, { type: 'hauler', id: 998 }]);
  assert.deepEqual(arrival!.before[0], route!.after[0]);
  assert.equal(arrival!.before[0].drones, 30);
  assert.equal(arrival!.after[1]!.drones, 9);
});

test('the encounter uses production and shield recharge before arrival rather than the current inventories', () => {
  const { game, source, target } = battle();
  target.kind = 'factory'; target.productionAt = 0.5; target.shieldAt = 0.5;
  const sent = dispatch(game, source.id, target.id, 6, 'you');
  const view = observe(sent, 'you');
  const report = forecastEncounters(view, 'you', view.fleets[0]!.id).reports[0]!;
  assert.equal(report.before[1].drones, 52);
  assert.equal(report.before[1].shield, 4);
  assert.equal(report.after[1]!.drones, 50);
});

test('an inspected preparing hauler reports combat when it joins its departure site defence', () => {
  const { game, source, target } = battle();
  game.hour = 1;
  const sent = dispatch(game, source.id, target.id, 10, 'you');
  sent.fleets.push({ id: 50, owner: 'vesper', from: target.id, to: source.id, drones: 20, departed: 0, arrives: 1.1,
    route: { from: { x: target.x, y: target.y }, to: { x: source.x, y: source.y } } });
  const view = observe(sent, 'you', id => 1000 + id);
  const forecast = forecastEncounters(view, 'you', 1001);
  assert.equal(forecast.status, 'resolved');
  assert.equal(forecast.reports.length, 1);
  assert.equal(forecast.reports[0]!.site, source.id);
  assert.equal(forecast.reports[0]!.reinforcement!.haulers[0]!.asset.id, 1001);
  assert.equal(forecast.reports[0]!.after[1]!.drones, 40);
});
