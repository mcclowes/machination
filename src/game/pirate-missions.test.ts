import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfiguredGame } from './world';
import { advance, dispatch } from './simulation';
import { releaseSpecialist } from './specialist-travel';

test('released captive Pirates travel at ordinary speed and retain it while returning', () => {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 54);
  const holding = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  holding.specialists!.push({ id: 'held-pirate', owner: 'vesper', kind: 'pirate', captive: true });
  const released = releaseSpecialist(game, 'you', 'held-pirate');
  assert.equal(released.fleets[0]!.speed, 8);
  assert.equal(advance(released, 0.1).fleets[0]!.speed, 8);
});

test('Pirates on ordinary route battles continue toward their destination after winning', () => {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 54);
  const source = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const enemy = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  Object.assign(source, { x: 10, y: 50, drones: 40 });
  Object.assign(enemy, { x: 30, y: 50, drones: 40 });
  source.specialists!.push({ id: 'ordinary-pirate', kind: 'pirate', owner: 'you' });
  const sent = dispatch(dispatch(game, source.id, enemy.id, 30, 'you', false, ['ordinary-pirate']), enemy.id, source.id, 10, 'vesper');
  const met = advance(sent, sent.fleets[0]!.departed + 1.25);
  const survivor = met.fleets[0]!;
  assert.equal(survivor.owner, 'you');
  assert.equal(survivor.drones, 20);
  assert.equal(survivor.returning, undefined);
  assert.equal(survivor.to, enemy.id);
  assert.equal(survivor.speed, 8);
});

test('targeted interception retains quadruple return speed across polling and saved reload', async () => {
  const { dispatchIntercept } = await import('./interception');
  const { decodeSave } = await import('./save-format');
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 54);
  const source = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const enemy = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  Object.assign(source, { x: 10, y: 50, drones: 40 });
  Object.assign(enemy, { x: 30, y: 50, drones: 40 });
  source.specialists!.push({ id: 'targeting-pirate', kind: 'pirate', owner: 'you' });
  const moving = advance(dispatch(game, enemy.id, source.id, 10, 'vesper'), 0.2);
  const targeted = dispatchIntercept(moving, source.id, moving.fleets[0]!.id, 20, 'you', true, ['targeting-pirate']);
  const rig = targeted.fleets.find(f => f.intercept)!;
  assert.equal(rig.speed, 16);
  const met = advance(targeted, rig.arrives);
  const returning = met.fleets.find(f => f.id === rig.id)!;
  assert.equal(returning.speed, 32);
  assert.equal(returning.returning, true);
  const restored = decodeSave(JSON.stringify({ savedAt: 0, game: met })).game;
  const later = advance(restored, restored.hour + 0.05);
  assert.equal(later.fleets.find(f => f.id === rig.id)!.speed, 32);
});

test('an interception tie returns the surviving Pirate specialist at mission speed', async () => {
  const { dispatchIntercept } = await import('./interception');
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 54);
  const source = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const enemy = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  Object.assign(source, { x: 10, y: 50, drones: 40 });
  Object.assign(enemy, { x: 30, y: 50, drones: 40 });
  source.specialists!.push({ id: 'tie-pirate', kind: 'pirate', owner: 'you' });
  enemy.specialists!.push({ id: 'tie-helmsman', kind: 'helmsman', owner: 'vesper' });
  const moving = advance(dispatch(game, enemy.id, source.id, 0, 'vesper', false, ['tie-helmsman']), 0.2);
  const targeted = dispatchIntercept(moving, source.id, moving.fleets[0]!.id, 0, 'you', true, ['tie-pirate']);
  const rig = targeted.fleets.find(f => f.intercept)!;
  const result = advance(targeted, rig.arrives);
  const convoy = result.fleets.find(f => f.specialists?.some(u => u.id === 'tie-pirate'))!;
  assert.equal(convoy.returning, true);
  assert.equal(convoy.interceptionReturn, true);
  assert.equal(convoy.speed, 32);
  assert.equal(result.fleets.find(f => f.owner === 'vesper')!.speed, 16);
});

test('older mechanics retain their recorded generic Pirate return bonus', () => {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 54);
  game.rules!.mechanicsVersion = 2;
  const holding = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  holding.specialists!.push({ id: 'old-held-pirate', owner: 'vesper', kind: 'pirate', captive: true });
  const released = releaseSpecialist(game, 'you', 'old-held-pirate');
  assert.equal(released.fleets[0]!.speed, 32);
  assert.equal(released.fleets[0]!.interceptionReturn, undefined);
});

test('Navigator redirection ends the interception return bonus and its persisted mission marker', async () => {
  const { dispatchIntercept } = await import('./interception');
  const { changeCourse } = await import('./specialist-navigation');
  const { decodeSave } = await import('./save-format');
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 54);
  const source = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
  const enemy = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  Object.assign(source, { x: 10, y: 50, drones: 40 });
  Object.assign(enemy, { x: 30, y: 50, drones: 40 });
  source.specialists!.push({ id: 'routed-pirate', kind: 'pirate', owner: 'you' }, { id: 'routed-navigator', kind: 'navigator', owner: 'you' });
  const moving = advance(dispatch(game, enemy.id, source.id, 10, 'vesper'), 0.2);
  const targeted = dispatchIntercept(moving, source.id, moving.fleets[0]!.id, 20, 'you', true, ['routed-pirate', 'routed-navigator']);
  const rig = targeted.fleets.find(f => f.intercept)!;
  const met = advance(targeted, rig.arrives);
  assert.equal(met.fleets[0]!.interceptionReturn, true);
  const routed = changeCourse(met, rig.id, 'you', enemy.id);
  assert.equal(routed.fleets[0]!.interceptionReturn, undefined);
  assert.equal(routed.fleets[0]!.returning, undefined);
  assert.equal(routed.fleets[0]!.speed, 8);
  assert.equal(advance(routed, routed.hour + 0.05).fleets[0]!.speed, 8);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: routed })).game, routed);
  const invalid = structuredClone(routed); invalid.fleets[0]!.interceptionReturn = true;
  assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game: invalid })));
});
