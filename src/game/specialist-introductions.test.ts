import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTrainingAttempt, TRAINING_SCENARIOS } from './training';
import { TRAINING_DIALOGUE } from './training-dialogue';
import { SPECIALIST_INTRODUCTIONS, specialistIntroduction } from './specialist-introductions';
import { PRACTICE_EXCLUDED_SPECIALISTS } from './specialist-drills';
import { promotion, SPECIALISTS, type SpecialistKind } from './specialist-catalog';

const placed = (id: (typeof TRAINING_SCENARIOS)[number]['id']) => {
  const { game } = createTrainingAttempt(id);
  return new Set([...game.rocks, ...game.fleets].flatMap(asset => asset.specialists ?? []).map(u => u.kind));
};
const offered = (id: (typeof TRAINING_SCENARIOS)[number]['id']) => new Set(createTrainingAttempt(id).game.recruitment?.you?.offers ?? []);

test('practice introduces every specialist it can host exactly once', () => {
  const introduced = TRAINING_SCENARIOS.flatMap(s => SPECIALIST_INTRODUCTIONS[s.id] ?? []);
  assert.deepEqual([...introduced].sort(), (Object.keys(SPECIALISTS) as SpecialistKind[]).filter(k => !PRACTICE_EXCLUDED_SPECIALISTS.includes(k)).sort());
  assert.equal(new Set(introduced).size, introduced.length);
});

test('each introduction belongs to an exercise that features that specialist', () => {
  for (const scenario of TRAINING_SCENARIOS) {
    const present = placed(scenario.id), available = offered(scenario.id);
    for (const kind of SPECIALIST_INTRODUCTIONS[scenario.id] ?? []) {
      const featured = present.has(kind) || available.has(kind) || [...present, ...available].some(k => promotion(k) === kind);
      assert.ok(featured, `${scenario.id} introduces ${kind} without featuring it`);
    }
  }
});

test('no exercise places a specialist before its introduction', () => {
  const seen = new Set<SpecialistKind>();
  for (const scenario of TRAINING_SCENARIOS) {
    for (const kind of SPECIALIST_INTRODUCTIONS[scenario.id] ?? []) seen.add(kind);
    for (const kind of placed(scenario.id)) assert.ok(seen.has(kind), `${scenario.id} places ${kind} before introducing it`);
  }
});

test('introductions appear in the briefing, one line per specialist, before the orders', () => {
  for (const scenario of TRAINING_SCENARIOS) {
    const briefing = TRAINING_DIALOGUE[scenario.id].briefing.map(line => line.text);
    const profiles = (SPECIALIST_INTRODUCTIONS[scenario.id] ?? []).map(specialistIntroduction);
    assert.deepEqual(briefing.filter(text => text.startsWith('Specialist profile:')), profiles);
    assert.ok(!briefing.at(-1)!.startsWith('Specialist profile:'));
  }
});
