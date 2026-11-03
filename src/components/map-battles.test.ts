import assert from 'node:assert/strict';
import { test } from 'node:test';
import { battlePoint } from './map-battles';

test('station battles burst from the site edge facing the attacker', () => {
  const battle = { x: 10, y: 20, site: 'f', toward: { x: 0.6, y: -0.8 } };
  assert.deepEqual(battlePoint(battle, 2, [{ id: 'f', owner: null }]), { x: 20 + 0.6 * 18, y: 40 - 0.8 * 18 });
  const shielded = battlePoint(battle, 2, [{ id: 'f', owner: 'you', shield: 25 }]);
  assert.ok(Math.abs(Math.hypot(shielded.x - 20, shielded.y - 40) - 30) < 1e-9, 'outermost shield arc is the contact surface');
});

test('battles without a site bearing stay where they were recorded', () => {
  assert.deepEqual(battlePoint({ x: 10, y: 20 }, 2, []), { x: 20, y: 40 });
  assert.deepEqual(battlePoint({ x: 10, y: 20, site: 'gone', toward: { x: 1, y: 0 } }, 2, []), { x: 20, y: 40 });
});
