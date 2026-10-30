import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessTrainingAttempt, createTrainingAttempt, TRAINING_SCENARIOS } from './training';
import { applyCommand, exportArchive, replayTo, type GameCommand } from './replay';
import { advance } from './simulation';
import { decodeSave } from './save-format';
import { encodeOperation, type LocalOperation } from './operation-save';
import { decodeReplay } from './replay-save';
import { TUTORIAL_MISSIONS, type TutorialMissionId } from './training-missions';
import { localLifecycle } from './local-lifecycle';

type Step = [number, GameCommand];
const launch = (from: string, to: string, drones: number, specialists?: string[]): GameCommand => ({ type: 'dispatch', owner: 'you', from, to, drones, ...(specialists ? { specialists } : {}) });
const solutions: Record<TutorialMissionId, Step[]> = {
  'joint-attack': [[0, launch('works', 'relay', 15)], [0, launch('home', 'relay', 15)]],
  reinforcements: [[0, launch('works', 'home', 25)]],
  'scheduled-arrival': [[0, { type: 'schedule', owner: 'you', plan: { id: 'tutorial-arrival-001', from: 'works', to: 'relay', drones: 25, executeAt: 1 } }]],
  'factory-specialist': [[0, launch('home', 'works', 0, ['training-foreman'])]],
  'hiring-specialists': [[4, { type: 'hire', owner: 'you', kind: 'lieutenant' }]],
  'combat-priority': [[0, launch('works', 'relay', 6, ['training-assassin', 'training-lieutenant'])]],
  promotion: [[4, { type: 'promote', owner: 'you', id: 'training-lieutenant' }], [4, launch('works', 'relay', 12, ['training-lieutenant'])]],
  'drilling-mines': [[0, { type: 'drill-mine', owner: 'you', rock: 'works' }]],
  'the-gift': [[0, { type: 'gift', owner: 'you', from: 'works', to: 'relay', drones: 6, recipient: 'vesper' }]],
  funding: [[0, { type: 'funding', owner: 'you', to: 'vesper', enabled: true }]],
  'combat-specialist': [[0, launch('works', 'relay', 6, ['training-lieutenant'])]],
  'route-combat': [[0, launch('works', 'relay', 25)]],
  'global-abilities': [[0, launch('works', 'relay', 6, ['training-helmsman'])]],
  'electrical-output': [[4, { type: 'hire', owner: 'you', kind: 'tinkerer' }]],
  'mining-rate': [[0, launch('works', 'relay', 6)]],
  'losing-mine': [[0, launch('works', 'relay', 20)]],
  'losing-core': [[0, launch('works', 'rival-home', 40)]],
  'disabling-shields': [[0, { type: 'shields', owner: 'you', rock: 'relay', disabled: true }]],
  'captive-specialists': [[0, { type: 'release', owner: 'you', id: 'training-captive' }]],
  'order-matters': [[0, launch('works', 'relay', 0, ['training-infiltrator'])], [0.5, launch('works', 'relay', 10)]],
  'fastest-route': [[0, launch('home', 'works', 0, ['training-smuggler', 'training-navigator'])], [1.5, launch('works', 'relay', 0, ['training-smuggler', 'training-navigator'])]],
  'against-the-odds': [[0, launch('works', 'home', 31, ['training-helmsman'])]],
  'test-of-character': [[0, launch('home', 'works', 0, ['core-you'])]],
};

function submit(op: LocalOperation, c: GameCommand): LocalOperation {
  return applyCommand(op.archive, c, { rivals: false, knownThrough: op.game.hour });
}
const clock = (op: LocalOperation, hour: number): LocalOperation => ({ ...op, game: advance(op.game, hour, { rivals: false }) });
const solo = { initial: () => { throw new Error('solo touched'); }, create: () => { throw new Error('solo touched'); }, load: async () => { throw new Error('solo touched'); }, save: async () => { throw new Error('solo touched'); } };

const wrongPlans: Partial<Record<TutorialMissionId, Step[]>> = {
  'joint-attack': [[0, launch('works', 'relay', 15)]],
  reinforcements: [[0, launch('works', 'relay', 25)]],
  'scheduled-arrival': [[1, launch('works', 'relay', 25)]],
  'factory-specialist': [[0, launch('home', 'relay', 0, ['training-foreman'])]],
  'hiring-specialists': [[4, { type: 'hire', owner: 'you', kind: 'inspector' }]],
  'combat-priority': [[0, launch('works', 'relay', 6, ['training-lieutenant'])]],
  promotion: [[4, launch('works', 'relay', 12, ['training-lieutenant'])]],
  'the-gift': [[0, launch('works', 'relay', 6)]],
  funding: [[0, { type: 'funding', owner: 'you', to: 'vesper', enabled: true }], [7, { type: 'funding', owner: 'you', to: 'vesper', enabled: false }]],
  'combat-specialist': [[0, launch('works', 'relay', 6)]],
  'route-combat': [[0, launch('works', 'relay', 10)]],
  'global-abilities': [[0, launch('works', 'relay', 6)]],
  'electrical-output': [[4, { type: 'hire', owner: 'you', kind: 'inspector' }]],
  'mining-rate': [[0, launch('works', 'relay', 4)]],
  'losing-mine': [[0, launch('works', 'relay', 8)]],
  'losing-core': [[0, launch('works', 'rival-home', 20)]],
  'disabling-shields': [[0, { type: 'shields', owner: 'you', rock: 'home', disabled: true }]],
  'captive-specialists': [[0, launch('works', 'home', 1)]],
  'order-matters': [[0, launch('works', 'relay', 10)], [0.5, launch('works', 'relay', 0, ['training-infiltrator'])]],
  'fastest-route': [[0, launch('home', 'relay', 0, ['training-smuggler', 'training-navigator'])]],
  'against-the-odds': [[0, launch('works', 'home', 10, ['training-helmsman'])]],
  'test-of-character': [[0, launch('home', 'relay', 0, ['core-you'])]],
};
for (const [id, steps] of Object.entries(wrongPlans) as [TutorialMissionId, Step[]][]) {
  test(`${id}: a plausible incorrect plan fails`, () => {
    let op = createTrainingAttempt(id);
    for (const [hour, c] of steps) op = submit(clock(op, hour), c);
    const deadline = TUTORIAL_MISSIONS.find(m => m.id === id)!.deadline;
    assert.equal(assessTrainingAttempt(id, clock(op, deadline)).status, 'failed');
  });
}

test('canceling an arrival transfer cannot supply proof for a later manual attack', () => {
  let op = submit(createTrainingAttempt('scheduled-arrival'), solutions['scheduled-arrival'][0]![1]);
  op = submit(op, { type: 'cancel-schedule', owner: 'you', id: 'tutorial-arrival-001' });
  op = submit(clock(op, 1), launch('works', 'relay', 25));
  op = clock(op, 4);
  assert.equal(op.game.rocks.find(r => r.id === 'relay')!.owner, 'you');
  assert.equal(assessTrainingAttempt('scheduled-arrival', op).status, 'failed');
});

test('previewing a solved future does not complete the actual attempt', () => {
  const queued = submit(createTrainingAttempt('scheduled-arrival'), solutions['scheduled-arrival'][0]![1]);
  assert.equal(advance(queued.game, 4, { rivals: false }).rocks.find(r => r.id === 'relay')!.owner, 'you');
  assert.equal(assessTrainingAttempt('scheduled-arrival', queued).status, 'active');
});

test('waiting out a raid at the station cannot pass the hauler combat lesson', () => {
  let op = clock(createTrainingAttempt('route-combat'), 2);
  op = clock(submit(op, launch('works', 'relay', 20)), 4);
  assert.equal(op.game.rocks.find(r => r.id === 'relay')!.owner, 'you');
  assert.equal(assessTrainingAttempt('route-combat', op).status, 'failed');
});

test('mine construction alone does not pass before actual extraction', () => {
  const op = submit(createTrainingAttempt('drilling-mines'), { type: 'drill-mine', owner: 'you', rock: 'works' });
  assert.equal(op.game.rocks.find(r => r.id === 'works')!.kind, 'mine');
  assert.equal(assessTrainingAttempt('drilling-mines', op).status, 'active');
  assert.equal(assessTrainingAttempt('drilling-mines', clock(op, 11.99)).status, 'active');
  assert.equal(assessTrainingAttempt('drilling-mines', clock(op, 12)).status, 'passed');
});

test('commands issued after the deadline cannot satisfy recruitment or crash assessment', () => {
  let op = clock(createTrainingAttempt('hiring-specialists'), 7);
  op = submit(op, { type: 'hire', owner: 'you', kind: 'lieutenant' });
  assert.equal(assessTrainingAttempt('hiring-specialists', op).status, 'failed');
});

test('practice accounts for all 24 source missions without dropping the five existing IDs', () => {
  const references = TRAINING_SCENARIOS.flatMap(s => s.reference ? [s.reference] : []);
  const expected = ['Combat 1', 'Combat 2', 'Combat 3', 'Combat 4', 'Specialists 1', 'Specialists 2', 'Specialists 3', 'Specialists 4', 'Winning 1', 'Diplomacy 1', 'Diplomacy 2', 'Combat 5', 'Combat 6', 'Specialists 5', 'Specialists 6', 'Winning 2', 'Winning 3', 'Winning 4', 'Diplomacy 3', 'Diplomacy 4', 'Advanced 1', 'Advanced 2', 'Advanced 3', 'Kobayashi Maru'];
  assert.deepEqual(references, expected);
  assert.equal(TRAINING_SCENARIOS.length, 28);
  assert.equal(new Set(TRAINING_SCENARIOS.map(s => s.id)).size, 28);
  for (const id of ['first-launch', 'shield-combat', 'unit-transport', 'future-production', 'interception']) assert.ok(TRAINING_SCENARIOS.some(s => s.id === id));
});

for (const mission of TUTORIAL_MISSIONS) {
  test(`${mission.id}: public commands solve a deterministic, valid, replayable mission`, () => {
    const initial = createTrainingAttempt(mission.id);
    const bytes = encodeOperation(initial, 0);
    assert.deepEqual(decodeSave(bytes).game, initial.game);
    assert.doesNotThrow(() => decodeReplay(exportArchive(initial.archive), initial.game, false));
    assert.deepEqual(createTrainingAttempt(mission.id).game, initial.game);
    assert.equal(assessTrainingAttempt(mission.id, initial).status, 'active');
    let op = initial, split = createTrainingAttempt(mission.id);
    for (const [hour, c] of solutions[mission.id]) {
      op = submit(clock(op, hour), c);
      for (let h = split.game.hour + 0.25; h < hour; h += 0.25) split = clock(split, h);
      split = clock(split, hour);
      split = submit(split, c);
    }
    op = clock(op, mission.deadline);
    for (let h = split.game.hour + 0.25; h < mission.deadline; h += 0.25) split = clock(split, h);
    split = clock(split, mission.deadline);
    assert.equal(assessTrainingAttempt(mission.id, op).status, 'passed');
    assert.deepEqual(split.game, op.game);
    assert.deepEqual(replayTo(op.archive, op.game.hour, { rivals: false, knownThrough: op.game.hour }), op.game);
    assert.deepEqual(decodeSave(encodeOperation(op, 0)).game, op.game);
    assert.doesNotThrow(() => decodeReplay(exportArchive(op.archive), op.game, false));
    assert.equal(encodeOperation(initial, 0), bytes);
    const retry = createTrainingAttempt(mission.id); retry.game.rocks[0]!.specialists!.length = 0;
    assert.equal(encodeOperation(initial, 0), bytes);
    const solvedBytes = encodeOperation(op, 0); assessTrainingAttempt(mission.id, op);
    assert.equal(encodeOperation(op, 0), solvedBytes);
  });
  test(`${mission.id}: idle, timeout, and core loss do not pass`, () => {
    const op = createTrainingAttempt(mission.id);
    assert.equal(assessTrainingAttempt(mission.id, clock(op, mission.deadline)).status, 'failed');
    assert.equal(assessTrainingAttempt(mission.id, submit(op, { type: 'resign', owner: 'you' })).status, 'failed');
  });
  test(`${mission.id}: shared lifecycle stops at its first actual outcome`, () => {
    const policy = localLifecycle(solo, mission.id);
    let op = policy.initial();
    for (const [hour, c] of solutions[mission.id]) {
      op = policy.advance(op, hour, 'manual');
      op = policy.submit(op, c);
    }
    op = policy.advance(op, mission.deadline + 10, 'manual');
    assert.equal(policy.assess(op)?.status, 'passed');
    assert.ok(op.game.hour <= mission.deadline);
    assert.equal(policy.advance(op, mission.deadline + 10, 'manual'), op);
  });
}
