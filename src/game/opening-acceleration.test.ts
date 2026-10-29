import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfiguredGame } from './world';
import { advance, dispatch } from './simulation';
import { fleetPosition } from './flight';
import { sitePosition, stationCourse } from './drift';
import { worldDistance } from './geometry';
import { recruitmentStatus } from './specialists';
import { absorbShields, maximumShield, drillMine } from './economy';
import { nextRouteEncounter } from './route-encounters';
import { dispatchIntercept } from './interception';
import { decodeSave } from './save-format';
import { createArchive, replayTo } from './replay';
import { withUnitEffects } from './specialist-effects';
import { editLaunch } from './transport';
import { afterWork } from './opening-clock';

function fixture() {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 73);
  game.rules!.mechanicsVersion = 9;
  game.rules!.map.width = 200; game.rules!.map.height = 200;
  for (const rock of game.rocks) { rock.productionAt = 1000; rock.shieldAt = 1000; }
  const source = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const target = game.rocks.find(r => r.owner === null)!;
  Object.assign(source, { x: 20, y: 20 }); Object.assign(target, { x: 36, y: 20 });
  return { game, source, target };
}

test('a launch departing at hour eleven slows at twelve and arrives at twelve thirty', () => {
  const { game, source, target } = fixture();
  game.hour = 11 - 1 / 6;
  const sent = dispatch(game, source.id, target.id, 10, 'you');
  const fleet = sent.fleets[0]!;
  assert.equal(fleet.departed, 11);
  assert.equal(fleet.arrives, 12.5);
  assert.deepEqual(fleetPosition({ ...sent, hour: 12 }, fleet), { x: 32, y: 20 });
  const end = advance(sent, 12.5, { rivals: false });
  assert.equal(end.rocks.find(r => r.id === target.id)!.drones, 10);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: end })).game, end);
  assert.deepEqual(replayTo(createArchive(sent), end.hour, { knownThrough: end.hour, rivals: false }), end);
  let split = sent;
  for (const hour of [11, 11.999999999, 12, 12.000000001, 12.37, 12.5]) split = advance(split, hour, { rivals: false });
  assert.deepEqual(split, end);
});

test('factory cycles preserve progress through the end of the opening', () => {
  const { game, source } = fixture();
  source.kind = 'factory'; source.productionAt = 16 / 3; source.drones = 0;
  const first = advance(game, 16 / 3, { rivals: false });
  assert.equal(first.rocks.find(r => r.id === source.id)!.drones, 6);
  assert.equal(first.rocks.find(r => r.id === source.id)!.productionAt, 32 / 3);
  const second = advance(first, 32 / 3, { rivals: false });
  assert.equal(second.rocks.find(r => r.id === source.id)!.drones, 12);
  assert.equal(second.rocks.find(r => r.id === source.id)!.productionAt, 18);
});

test('shield damage restarts a recharge cycle that slows at twelve', () => {
  const { game, source } = fixture(); game.hour = 11;
  Object.assign(source, { shieldMax: 20, shield: 20, shieldBonus: 0 });
  assert.equal(absorbShields(game, source, 1), 0);
  assert.equal(source.shieldAt, 12.9);
  const before = advance(game, 12.9 - 1e-9, { rivals: false });
  assert.equal(before.rocks.find(r => r.id === source.id)!.shield, 19);
  assert.equal(advance(before, 12.9, { rivals: false }).rocks.find(r => r.id === source.id)!.shield, 20);
});

test('opening recruitment earns credits at two forty, sixteen, and thirty-four', () => {
  const { game } = fixture();
  for (const [hour, credits, nextAt] of [[8 / 3 - 1e-9, 0, 8 / 3], [8 / 3, 1, 16], [12, 1, 16], [16, 2, 34], [34, 3, 52]]) {
    const status = recruitmentStatus({ ...game, hour: hour! }, 'you');
    assert.equal(status.credits, credits);
    assert.equal(status.nextAt, nextAt);
  }
});

test('a moving destination keeps actual-time drift while the sub slows at twelve', () => {
  const { game, source, target } = fixture();
  game.hour = 11 - 1 / 6;
  target.drift = { origin: { x: 36, y: 20 }, velocity: { x: .5, y: 0 } };
  game.rules!.driftingBases = true;
  Object.assign(target, sitePosition(game, target, game.hour));
  const preview = stationCourse(game, source, target, 8, 11);
  const sent = dispatch(game, source.id, target.id, 10, 'you');
  const fleet = sent.fleets[0]!;
  assert.ok(Math.abs(fleet.arrives - (13 + 1 / 3)) < 1e-9);
  assert.equal(fleet.arrives, preview.arrives);
  assert.ok(worldDistance(game, fleetPosition({ ...sent, hour: fleet.arrives }, fleet), sitePosition(game, target, fleet.arrives)) < 1e-9);
  assert.deepEqual(fleetPosition({ ...sent, hour: 12 }, fleet), { x: 32, y: 20 });
});

test('opposing ordinary routes meet after twelve using accelerated progress already traveled', () => {
  const { game, source } = fixture(); game.hour = 11 - 1 / 6;
  const enemy = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  Object.assign(enemy, { x: 68, y: 20, drones: 10 });
  const one = dispatch(game, source.id, enemy.id, 20, 'you');
  const both = dispatch(one, enemy.id, source.id, 10, 'vesper');
  const underway = advance(both, 11, { rivals: false });
  assert.equal(nextRouteEncounter(underway), 13.5);
  const end = advance(underway, 13.5, { rivals: false });
  assert.equal(end.fleets.length, 1);
  assert.equal(end.fleets[0]!.drones, 10);
  assert.deepEqual(fleetPosition(end, end.fleets[0]!), { x: 44, y: 20 });
  assert.deepEqual(advance(advance(underway, 12, { rivals: false }), 13.5, { rivals: false }), end);
});

test('Pirate interception crosses noon and returns at its normal mission multiplier', () => {
  const { game, source } = fixture(); game.hour = 10;
  source.specialists!.push({ id: 'opening-pirate', owner: 'you', kind: 'pirate' });
  const enemy = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  const destination = game.rocks.find(r => r.owner === 'you' && r.id !== source.id && !r.coreOf)!;
  Object.assign(enemy, { x: 68, y: 40, drones: 10 }); Object.assign(destination, { x: 20, y: 40 });
  const target = dispatch(game, enemy.id, destination.id, 10, 'vesper');
  const moving = advance(target, 11.7, { rivals: false });
  const intercept = dispatchIntercept(moving, source.id, moving.fleets[0]!.id, 20, 'you', false, ['opening-pirate']);
  const pirate = intercept.fleets.find(f => f.owner === 'you')!;
  assert.ok(pirate.arrives > 12);
  const contact = { ...intercept, hour: pirate.arrives };
  assert.ok(worldDistance(game, fleetPosition(contact, pirate), fleetPosition(contact, intercept.fleets.find(f => f.owner === 'vesper')!)) < 1e-8);
  const end = advance(intercept, pirate.arrives, { rivals: false });
  const returning = end.fleets.find(f => f.owner === 'you')!;
  assert.equal(returning.speed, 32);
  assert.equal(returning.interceptionReturn, true);
  assert.equal(returning.drones, 10);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: end })).game, end);
  assert.deepEqual(advance(advance(intercept, 12, { rivals: false }), end.hour, { rivals: false }), end);
});

test('editing preparation applies the manifest speed at departure without shortening ten minutes', () => {
  const { game, source, target } = fixture(); game.hour = 11 - 1 / 6;
  target.x = 68;
  source.specialists!.push({ id: 'opening-helmsman', owner: 'you', kind: 'helmsman' });
  const sent = dispatch(game, source.id, target.id, 10, 'you');
  assert.equal(sent.fleets[0]!.arrives, 16.5);
  const edited = editLaunch(sent, sent.fleets[0]!.id, 'you', 10, ['opening-helmsman']);
  assert.equal(edited.fleets[0]!.departed, 11);
  assert.equal(edited.fleets[0]!.speed, 16);
  assert.equal(edited.fleets[0]!.arrives, 13.5);
  assert.deepEqual(fleetPosition({ ...edited, hour: 12 }, edited.fleets[0]!), { x: 44, y: 20 });
  const atNoon = dispatch({ ...game, hour: 12 - 1 / 6 }, source.id, target.id, 10, 'you');
  assert.equal(atNoon.fleets[0]!.departed, 12);
  assert.equal(atNoon.fleets[0]!.arrives, 18);
});

test('a Tycoon preserves remaining factory work when its faster cycle crosses noon', () => {
  const { game, source } = fixture(); game.hour = 11;
  Object.assign(source, { kind: 'factory', productionAt: 14.5, productionInterval: 8 });
  source.specialists!.push({ id: 'opening-tycoon', owner: 'you', kind: 'tycoon' });
  const changed = withUnitEffects(game).rocks.find(r => r.id === source.id)!;
  assert.equal(changed.productionInterval, 8 / 1.5);
  assert.equal(changed.productionAt, afterWork(game, 11, 4 / 1.5));
});

test('fresh configured games initialize accelerated factory and shield deadlines', () => {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 73);
  assert.equal(game.rules!.mechanicsVersion, 12);
  for (const rock of game.rocks) {
    assert.equal(rock.productionAt, 16 / 3);
    assert.equal(rock.shieldAt, (48 / maximumShield(rock)) / 1.5);
  }
  assert.equal(recruitmentStatus(game, 'you').nextAt, 8 / 3);
});

test('mines and station abilities keep their ordinary actual-hour cadence', () => {
  const { game, source } = fixture(); game.hour = 11; source.drones = 100;
  source.specialists!.push({ id: 'opening-sentry', owner: 'you', kind: 'sentry' }, { id: 'opening-tinkerer', owner: 'you', kind: 'tinkerer' });
  const mine = drillMine(game, source.id, 'you');
  assert.equal(mine.rocks.find(r => r.id === source.id)!.miningAt, 11 + 24 / 5);
  const refreshed = withUnitEffects(mine).rocks.find(r => r.id === source.id)!;
  assert.equal(refreshed.specialists!.find(u => u.kind === 'sentry')!.nextActionAt, 13);
  assert.equal(refreshed.specialists!.find(u => u.kind === 'tinkerer')!.nextActionAt, 11 + 1 / 3);
});

test('revision-eight games retain their original travel and recruitment clocks', () => {
  const { game, source, target } = fixture(); game.hour = 11 - 1 / 6;
  game.rules!.mechanicsVersion = 8;
  const sent = dispatch(game, source.id, target.id, 10, 'you');
  assert.equal(sent.fleets[0]!.arrives, 13);
  assert.deepEqual(fleetPosition({ ...sent, hour: 12 }, sent.fleets[0]!), { x: 28, y: 20 });
  assert.equal(recruitmentStatus({ ...game, hour: 0 }, 'you').nextAt, 4);
});
