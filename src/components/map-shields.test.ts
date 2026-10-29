import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapShields } from './map-shields';

test('shield charge fills concentric ten-point arcs from the inside out', () => {
  const site = { owner: 'you', shield: 25 };
  assert.deepEqual(mapShields(site).map(arc => [arc.radius, arc.charge]), [[22, 10], [26, 10], [30, 5]]);
  assert.equal(mapShields({ ...site, shield: 40 }).length, 4);
  assert.equal(mapShields({ ...site, shield: 1 })[0]!.charge, 1);
  const full = mapShields({ ...site, shield: 10 })[0]!;
  const partial = mapShields({ ...site, shield: 5 })[0]!;
  assert.match(full.path, / A 22 22 0 1 1 /, 'A full layer wraps around the left of the base');
  assert.match(partial.path, / A 22 22 0 0 1 /, 'A partial layer fills only its charged portion');
});

test('inactive or unobserved shields never draw active defenses', () => {
  const site = { owner: 'you', shield: 20 };
  for (const patch of [{ shield: 0 }, { shield: undefined }, { owner: null }, { owner: undefined }, { known: false }, { destroyed: true }, { shieldsDisabled: true }]) {
    assert.deepEqual(mapShields({ ...site, ...patch }), []);
  }
});
