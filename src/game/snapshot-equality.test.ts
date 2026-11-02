import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sameSnapshot } from './snapshot-equality';

test('snapshot equality distinguishes precise values and absent data', () => {
  const game = { hour: -0, cargo: { you: NaN }, warning: undefined, limits: [Infinity, -Infinity] };
  assert.equal(sameSnapshot(game, structuredClone(game)), true);
  assert.equal(sameSnapshot(game, { ...game, hour: 0 }), false);
  const { warning: _warning, ...withoutWarning } = game;
  assert.equal(sameSnapshot(game, withoutWarning), false);
  assert.equal(sameSnapshot({ hour: 1 }, { hour: 1 + Number.EPSILON }), false);
});

test('snapshot equality preserves array order, holes, and lengths', () => {
  assert.equal(sameSnapshot([1, 2], [2, 1]), false);
  assert.equal(sameSnapshot(new Array(1), []), false);
  assert.equal(sameSnapshot(new Array(1), [undefined]), false);
  assert.equal(sameSnapshot({ cargo: [1, 2] }, { cargo: [1, 2] }), true);
  assert.equal(sameSnapshot([], {}), false);
});

test('snapshot equality compares own data without depending on property insertion order', () => {
  assert.equal(sameSnapshot({ hour: 1, cargo: 2 }, { cargo: 2, hour: 1 }), true);
  assert.equal(sameSnapshot({ hour: 1 }, Object.create({ hour: 1 })), false);
  assert.equal(sameSnapshot(null, {}), false);
});
