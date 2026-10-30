/** @format */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planningTransition, type PlanningMode } from './planning-mode';

test('choosing a course and planning a transfer are mutually exclusive', () => {
  let mode: PlanningMode = { kind: 'idle' };
  mode = planningTransition(mode, { type: 'transfer', enabled: true });
  assert.deepEqual(mode, { kind: 'transfer' });
  mode = planningTransition(mode, { type: 'course', fleet: 7 });
  assert.deepEqual(mode, { kind: 'course', fleet: 7 });
  mode = planningTransition(mode, { type: 'transfer', enabled: false });
  assert.deepEqual(
    mode,
    { kind: 'course', fleet: 7 },
    'closing transfer controls preserves course selection',
  );
  mode = planningTransition(mode, { type: 'transfer', enabled: true });
  assert.deepEqual(mode, { kind: 'transfer' });
  mode = planningTransition(mode, { type: 'course' });
  assert.deepEqual(
    mode,
    { kind: 'transfer' },
    'clearing course selection preserves transfer planning',
  );
  assert.deepEqual(planningTransition(mode, { type: 'transfer', enabled: false }), {
    kind: 'idle',
  });
});
