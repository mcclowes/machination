import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectableLaunchUnits } from './launch-manifest';

test('manifest choices include owned known units and own queued hires, excluding captive and enemy cargo', () => {
  const unit = (id: string, owner: 'you' | 'vesper' = 'you', captive = false) => ({ id, owner, captive, kind: 'pirate' as const });
  const choices = selectableLaunchUnits({ rocks: [{ owner: 'you', specialists: [unit('own'), unit('enemy', 'vesper'), unit('captive', 'you', true)] }, { owner: 'vesper', specialists: [unit('held')] }, {}], fleets: [{ owner: 'you', specialists: [unit('flying'), unit('own')] }], scheduled: [
    { id: 'hire-own', owner: 'you', executeAt: 2, action: { type: 'hire', kind: 'saboteur' }, hireUnits: ['planned-1', 'planned-2'] },
    { id: 'hire-enemy', owner: 'vesper', executeAt: 1, action: { type: 'hire', kind: 'pirate' }, hireUnits: ['secret'] },
  ] }, 'you');
  assert.deepEqual(choices.map(u => [u.id, u.kind, u.planned]), [['own', 'pirate', false], ['flying', 'pirate', false], ['planned-1', 'saboteur', true], ['planned-2', 'saboteur', true]]);
});
