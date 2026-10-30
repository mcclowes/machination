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
  'factory-specialist': [[0, launch('works', 'relay', 13, ['training-infiltrator'])]],
  'hiring-specialists': [[4, { type: 'hire', owner: 'you', kind: 'saboteur' }], [4, launch('works', 'rival-home', 0, ['unit-2'])]],
  'combat-priority': [[4, { type: 'hire', owner: 'you', kind: 'martyr' }], [4, launch('works', 'home', 0, ['core-you'])]],
  promotion: [[4, { type: 'promote', owner: 'you', id: 'training-lieutenant' }], [4, launch('works', 'relay', 12, ['training-lieutenant'])]],
  'drilling-mines': [[0, { type: 'drill-mine', owner: 'you', rock: 'works' }]],
  'the-gift': [[0, { type: 'gift', owner: 'you', from: 'works', to: 'relay', drones: 6, recipient: 'null' }]],
  funding: [[0, { type: 'funding', owner: 'you', to: 'null', enabled: true }]],
  'combat-specialist': [[0, launch('home', 'works', 12)], [1, launch('works', 'relay', 24)]],
  'route-combat': [[0, launch('home', 'works', 15)], [1, launch('works', 'relay', 30)]],
  'global-abilities': [[4, { type: 'hire', owner: 'you', kind: 'foreman' }], [4, { type: 'schedule-action', owner: 'you', plan: { id: 'tutorial-promote-01', executeAt: 17, action: { type: 'promote', id: 'unit-3' } } }]],
  'electrical-output': [[4, { type: 'hire', owner: 'you', kind: 'tinkerer' }]],
  'mining-rate': [[0, launch('works', 'relay', 6)]],
  'losing-mine': [[4, { type: 'hire', owner: 'you', kind: 'doubleAgent' }], [16, { type: 'hire', owner: 'you', kind: 'pirate' }], [16, { type: 'intercept', owner: 'you', from: 'home', target: 1, drones: 0, specialists: ['unit-2', 'unit-3'] }], [16, launch('works', 'home', 33)]],
  'losing-core': [[0, launch('works', 'relay', 30, ['training-smuggler'])], [1, launch('relay', 'rival-home', 16, ['training-smuggler', 'training-assassin'])]],
  'disabling-shields': [[0, { type: 'shields', owner: 'you', rock: 'home', disabled: true }], [0, { type: 'gift', owner: 'you', from: 'home', to: 'relay', drones: 2, recipient: 'null' }]],
  'captive-specialists': [[0, launch('works', 'remote-1', 9)], [1.2, { type: 'release', owner: 'you', id: 'training-captive' }]],
  'order-matters': [[0, launch('home', 'rival-home', 14)]],
  'fastest-route': [[0, launch('home', 'works', 13, ['core-you', 'training-smuggler'])], [3, { type: 'hire', owner: 'you', kind: 'infiltrator' }], [3, launch('works', 'relay', 28, ['training-smuggler', 'training-lieutenant', 'unit-2'])]],
  'against-the-odds': [[0, launch('works', 'home', 31, ['training-helmsman'])]],
  'test-of-character': [[0, launch('works', 'relay', 0, ['training-saboteur'])], [1.5, { type: 'intercept', owner: 'you', from: 'home', target: 3, drones: 0, specialists: ['training-pirate', 'training-martyr'] }]],
};

function submit(op: LocalOperation, c: GameCommand): LocalOperation {
  return applyCommand(op.archive, c, { rivals: false, knownThrough: op.game.hour });
}
const clock = (op: LocalOperation, hour: number): LocalOperation => ({ ...op, game: advance(op.game, hour, { rivals: false }) });
const solo = { initial: () => { throw new Error('solo touched'); }, create: () => { throw new Error('solo touched'); }, load: async () => { throw new Error('solo touched'); }, save: async () => { throw new Error('solo touched'); } };

test('losing an ally outpost fails immediately even while the player core remains safe', () => {
  const policy = localLifecycle(solo, 'the-gift');
  const op = policy.advance(policy.initial(), 4, 'manual');
  assert.equal(policy.assess(op)?.status, 'failed');
  assert.ok(op.game.hour < 4);
  assert.ok(op.game.rocks.some(r => r.specialists?.some(u => u.id === 'core-you' && !u.captive)));
  assert.equal(policy.advance(op, 10, 'manual'), op);
});

const wrongPlans: Partial<Record<TutorialMissionId, Step[]>> = {
  'joint-attack': [[0, launch('works', 'relay', 15)]],
  reinforcements: [[0, launch('works', 'relay', 25)]],
  'scheduled-arrival': [[1, launch('works', 'relay', 25)]],
  'factory-specialist': [[0, launch('works', 'relay', 13)]],
  'hiring-specialists': [[4, { type: 'hire', owner: 'you', kind: 'lieutenant' }]],
  'combat-priority': [[4, { type: 'hire', owner: 'you', kind: 'martyr' }]],
  promotion: [[4, launch('works', 'relay', 12, ['training-lieutenant'])]],
  'the-gift': [[0, launch('works', 'relay', 6)]],
  funding: [[0, { type: 'funding', owner: 'you', to: 'null', enabled: true }], [7, { type: 'funding', owner: 'you', to: 'null', enabled: false }]],
  'combat-specialist': [[0, launch('works', 'relay', 6)]],
  'route-combat': [[0, launch('works', 'relay', 10)]],
  'global-abilities': [[4, { type: 'hire', owner: 'you', kind: 'foreman' }]],
  'electrical-output': [[4, { type: 'hire', owner: 'you', kind: 'inspector' }]],
  'mining-rate': [[0, launch('works', 'relay', 4)]],
  'losing-mine': [[0, launch('works', 'home', 33)]],
  'losing-core': [[0, launch('works', 'rival-home', 20)]],
  'disabling-shields': [[0, { type: 'shields', owner: 'you', rock: 'home', disabled: true }]],
  'captive-specialists': [[0, launch('works', 'home', 1)]],
  'order-matters': [[0, launch('works', 'relay', 8)]],
  'fastest-route': [[0, launch('home', 'relay', 13, ['core-you', 'training-smuggler'])]],
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
  op = clock(submit(op, launch('works', 'relay', 15)), 4);
  assert.equal(assessTrainingAttempt('route-combat', op).status, 'failed');
});

test('mine construction alone does not pass before actual extraction', () => {
  const op = submit(createTrainingAttempt('drilling-mines'), { type: 'drill-mine', owner: 'you', rock: 'works' });
  assert.equal(op.game.rocks.find(r => r.id === 'works')!.kind, 'mine');
  assert.equal(assessTrainingAttempt('drilling-mines', op).status, 'active');
  assert.equal(assessTrainingAttempt('drilling-mines', clock(op, 11.99)).status, 'active');
  assert.equal(assessTrainingAttempt('drilling-mines', clock(op, 12)).status, 'active');
  assert.equal(assessTrainingAttempt('drilling-mines', clock(op, 48)).status, 'active');
  assert.equal(assessTrainingAttempt('drilling-mines', clock(op, 60)).status, 'passed');
});

test('the final mission rejects a detonation that prevents the courier arrival even when the core survives', () => {
  let op = submit(createTrainingAttempt('test-of-character'), solutions['test-of-character'][0]![1]);
  const intercept = solutions['test-of-character'][1]![1];
  op = clock(submit(clock(op, 4), intercept), 6);
  assert.ok(op.game.rocks.some(r => r.specialists?.some(u => u.id === 'core-you' && !u.captive)));
  assert.equal(assessTrainingAttempt('test-of-character', op).status, 'failed');
});

test('commands issued after the deadline cannot satisfy recruitment or crash assessment', () => {
  let op = clock(createTrainingAttempt('electrical-output'), 13);
  op = submit(op, { type: 'hire', owner: 'you', kind: 'tinkerer' });
  assert.equal(assessTrainingAttempt('electrical-output', op).status, 'failed');
});

test('practice accounts for all 24 source missions without dropping the five existing IDs', () => {
  const references = TRAINING_SCENARIOS.flatMap(s => s.reference ? [s.reference] : []);
  const expected = ['Combat 1', 'Combat 2', 'Combat 3', 'Combat 4', 'Specialists 1', 'Specialists 2', 'Specialists 3', 'Specialists 4', 'Winning 1', 'Diplomacy 1', 'Diplomacy 2', 'Combat 5', 'Combat 6', 'Specialists 5', 'Specialists 6', 'Winning 2', 'Winning 3', 'Winning 4', 'Diplomacy 3', 'Diplomacy 4', 'Advanced 1', 'Advanced 2', 'Advanced 3', 'Kobayashi Maru'];
  assert.deepEqual(references, expected);
  assert.equal(TRAINING_SCENARIOS.length, 28);
  assert.equal(new Set(TRAINING_SCENARIOS.map(s => s.id)).size, 28);
  for (const id of ['first-launch', 'shield-combat', 'unit-transport', 'future-production', 'interception']) assert.ok(TRAINING_SCENARIOS.some(s => s.id === id));
});

test('diplomacy missions protect an ally from a distinct hostile faction', () => {
  for (const id of ['the-gift', 'funding', 'disabling-shields', 'captive-specialists'] as const) {
    const { game } = createTrainingAttempt(id);
    assert.deepEqual(game.rules!.players, ['you', 'vesper', 'null']);
    assert.equal(game.rocks.find(r => r.id === 'relay')!.owner, 'null');
    assert.ok(game.fleets.some(f => f.owner === 'vesper' && f.to === 'relay') || game.scheduled?.some(p => p.owner === 'vesper' && !('action' in p) && p.to === 'relay'));
  }
});

test('a launched hauler converted into a gift is valid allied support', () => {
  let op = submit(createTrainingAttempt('the-gift'), launch('works', 'relay', 6));
  const fleet = op.game.fleets.find(f => f.owner === 'you')!;
  op = submit(op, { type: 'hauler', owner: 'you', change: { fleet: fleet.id, action: 'gift' } });
  assert.equal(assessTrainingAttempt('the-gift', clock(op, 4)).status, 'passed');
});

test('a generator handover also works when its garrison moves to a friendly site', () => {
  let op = submit(createTrainingAttempt('disabling-shields'), { type: 'shields', owner: 'you', rock: 'home', disabled: true });
  op = submit(op, launch('home', 'works', 2));
  assert.equal(assessTrainingAttempt('disabling-shields', clock(op, 12)).status, 'passed');
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
