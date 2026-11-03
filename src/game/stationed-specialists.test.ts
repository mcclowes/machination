import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advance, dispatch } from './simulation';
import { temporalWorld } from './temporal-test-world';
import { dilationMultiplier } from './temporal-travel';

test('a newly assimilated Envoy releases friendly captives during the same passive phase', () => {
  const game = temporalWorld();
  const home = game.rocks[0]!, prison = game.rocks[10]!;
  home.specialists!.push(
    { id: 'assimilator', owner: 'you', kind: 'hypnotist' },
    { id: 'captive-envoy', owner: 'vesper', kind: 'diplomat', captive: true },
  );
  Object.assign(prison, { x: 16, y: 0 });
  prison.specialists!.push({ id: 'prisoner', owner: 'you', kind: 'helmsman', captive: true });
  const before = structuredClone(game);
  const result = advance(game, game.hour, { rivals: false });
  const envoy = result.rocks[0]!.specialists!.find(unit => unit.id === 'captive-envoy')!;
  assert.equal(envoy.owner, 'you');
  assert.equal(envoy.captive, undefined);
  assert.ok(!result.rocks[10]!.specialists!.some(unit => unit.id === 'prisoner'));
  const returning = result.fleets.find(fleet => fleet.specialists?.some(unit => unit.id === 'prisoner'))!;
  assert.equal(returning.owner, 'you');
  assert.equal(returning.specialists![0]!.captive, undefined);
  assert.ok(returning.arrives > result.hour);
  assert.deepEqual(game, before);
});

test('a preparing Dilation specialist supplies its field until its launch completes', () => {
  const game = temporalWorld();
  const home = game.rocks[0]!, destination = game.rocks[1]!;
  home.specialists!.push({ id: 'departing-dilation', owner: 'you', kind: 'dilation' });
  game.fleets.push({ id: 99, owner: 'vesper', from: game.rocks[10]!.id, to: home.id,
    drones: 1, departed: game.hour, arrives: game.hour + 100, speed: 8,
    route: { from: { x: 4, y: 0 }, to: { x: 0, y: 0 } }, specialists: [] });
  const preparing = dispatch(game, home.id, destination.id, 0, 'you', false, ['departing-dilation']);
  const before = structuredClone(preparing);
  assert.equal(dilationMultiplier(preparing, preparing.fleets[0]!), 0.5);
  const result = advance(preparing, preparing.fleets.at(-1)!.departed, { rivals: false, temporalForecast: true });
  assert.equal(result.fleets.find(fleet => fleet.id !== 99)!.preparing, undefined);
  assert.equal(dilationMultiplier(result, result.fleets.find(fleet => fleet.id === 99)!), 1);
  assert.deepEqual(preparing, before);
});
