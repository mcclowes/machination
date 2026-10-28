import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame, dispatch } from './simulation';
import { dispatchIntercept } from './interception';
import { decodeSave } from './save-format';

test('scavenger specialists intercept at double speed and return to the nearest friendly site at quadruple speed without salvage', () => {
  const base = createGame(0);
  const site = base.rocks.find(r => r.id === 'c')!;
  site.drones = 100;
  site.specialists!.push({ id: 'pirate-test', owner: 'you', kind: 'pirate' });
  base.rocks.find(r => r.id === 'e')!.drones = 40;
  const target = advance(dispatch(base, 'e', 'c', 40, 'vesper'), 3, { rivals: false });
  const launched = dispatchIntercept(target, 'c', target.fleets[0]!.id, 50, 'you', false, ['pirate-test']);
  const rig = launched.fleets.find(f => f.intercept)!;
  assert.equal(rig.speed, 16);
  assert.ok(rig.preparing);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: launched })).game, launched);
  const met = advance(launched, rig.arrives, { rivals: false });
  const survivor = met.fleets.find(f => f.id === rig.id)!;
  assert.equal(survivor.drones, 10);
  assert.equal(survivor.speed, 32);
  assert.equal(survivor.returning, true);
  const point = rig.route!.to;
  const nearest = met.rocks.filter(r => r.owner === 'you').sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y))[0]!;
  assert.equal(survivor.to, nearest.id);
  assert.ok(!survivor.intercept);
});
