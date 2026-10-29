import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TRAINING_SCENARIOS } from './training';
import { TRAINING_DIALOGUE, trainingDialoguePhase } from './training-dialogue';

test('every exercise has a commander introduction, enemy reply, and both outcome exchanges', () => {
  for (const scenario of TRAINING_SCENARIOS) {
    const dialogue = TRAINING_DIALOGUE[scenario.id];
    assert.equal(dialogue.briefing[0]!.speaker, 'commander');
    for (const phase of ['briefing', 'underway', 'passed', 'failed'] as const) {
      assert.ok(dialogue[phase].some(line => line.speaker === 'enemy'), `${scenario.id}: ${phase} includes enemy backchat`);
      assert.ok(dialogue[phase].every(line => line.text.trim().length > 0));
    }
    assert.ok(dialogue.passed.some(line => line.speaker === 'commander'));
    assert.ok(dialogue.failed.some(line => line.speaker === 'commander'));
  }
});

test('dialogue follows the actual exercise clock and prioritizes its assessed result', () => {
  assert.equal(trainingDialoguePhase('active', 0), 'briefing');
  assert.equal(trainingDialoguePhase('active', 0.25), 'underway');
  assert.equal(trainingDialoguePhase('passed', 0), 'passed');
  assert.equal(trainingDialoguePhase('failed', 6), 'failed');
});
