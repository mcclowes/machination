import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrainingAttempt, assessTrainingAttempt } from './training';
import { applyCommand } from './replay';
import { advance } from './simulation';

test('first launch requires an actual surviving capture', () => {
  const initial = createTrainingAttempt('first-launch');
  assert.equal(assessTrainingAttempt('first-launch', initial).status, 'active');
  const sent = applyCommand(initial.archive, { type: 'dispatch', owner: 'you', from: 'works', to: 'relay', drones: 6 }, { rivals: false, knownThrough: 0 });
  assert.equal(assessTrainingAttempt('first-launch', sent).status, 'active');
  const solved = { ...sent, game: advance(sent.game, 2, { rivals: false }) };
  assert.equal(assessTrainingAttempt('first-launch', solved).status, 'passed');
});

import { TRAINING_SCENARIOS, type TrainingId } from './training';
import { encodeOperation, type LocalOperation } from './operation-save';
import { exportArchive, replayTo, type GameCommand } from './replay';
import { decodeSave } from './save-format';
import { decodeReplay } from './replay-save';
import { observe } from './visibility';
const command = (op: LocalOperation, c: GameCommand) => applyCommand(op.archive, c, { rivals: false, knownThrough: op.game.hour });
const clock = (op: LocalOperation, hour: number) => ({ ...op, game: advance(op.game, hour, { rivals: false }) });
const launch = (drones: number): GameCommand => ({ type: 'dispatch', owner: 'you', from: 'works', to: 'relay', drones });
const solutions = {
  'first-launch': launch(6), 'shield-combat': launch(20),
  'unit-transport': { type: 'dispatch', owner: 'you', from: 'home', to: 'works', drones: 0, specialists: ['training-helmsman'] },
  'future-production': { type: 'schedule', owner: 'you', plan: { id: 'training-future-001', from: 'works', to: 'relay', drones: 6, executeAt: 8 } },
  interception: { type: 'intercept', owner: 'you', from: 'works', target: 1, drones: 50, specialists: ['training-pirate'] },
} satisfies Partial<Record<TrainingId, GameCommand>>;
for (const scenario of TRAINING_SCENARIOS) {
  const solution = solutions[scenario.id as keyof typeof solutions];
  if (!solution) continue;
  test(`${scenario.id}: real solution, detached retries, save/replay and split advancement`, () => {
    const initial = createTrainingAttempt(scenario.id);
    const original = JSON.stringify(initial.game);
    assert.deepEqual(decodeSave(encodeOperation(initial, 0)).game, initial.game);
    assert.doesNotThrow(() => decodeReplay(exportArchive(initial.archive), initial.game, false));
    assert.equal(exportArchive(initial.archive).rivals, false);
    assert.equal(initial.game.rocks.length, 20);
    assert.equal(initial.game.hour, 0);
    assert.equal(observe(initial.game, 'you').rocks.length, 20);
    const ordered = command(initial, solution);
    assert.equal(assessTrainingAttempt(scenario.id, ordered).status, 'active');
    const solved = clock(ordered, scenario.deadline);
    assert.equal(assessTrainingAttempt(scenario.id, solved).status, 'passed');
    let split = ordered;
    for (let h = 0.25; h <= scenario.deadline; h += 0.25) split = clock(split, h);
    assert.deepEqual(split.game, solved.game);
    assert.deepEqual(replayTo(solved.archive, solved.game.hour, { rivals: false, knownThrough: solved.game.hour }), solved.game);
    assert.deepEqual(decodeSave(encodeOperation(solved, 0)).game, solved.game);
    assert.doesNotThrow(() => decodeReplay(exportArchive(solved.archive), solved.game, false));
    assert.equal(JSON.stringify(initial.game), original);
    assert.deepEqual(createTrainingAttempt(scenario.id).game, initial.game);
    const retry = createTrainingAttempt(scenario.id); retry.game.rocks[0]!.specialists!.length = 0;
    assert.equal(JSON.stringify(initial.game), original);
    const before = encodeOperation(solved, 0); assessTrainingAttempt(scenario.id, solved);
    assert.equal(encodeOperation(solved, 0), before);
  });
  test(`${scenario.id}: idle timeout and core loss fail`, () => {
    const initial = createTrainingAttempt(scenario.id);
    assert.equal(assessTrainingAttempt(scenario.id, clock(initial, scenario.deadline)).status, 'failed');
    const lost = command(initial, { type: 'resign', owner: 'you' });
    assert.equal(assessTrainingAttempt(scenario.id, lost).status, 'failed');
  });
}
test('shield combat rejects insufficient drones and tied combat', () => {
  for (const drones of [8, 18]) {
    const op = clock(command(createTrainingAttempt('shield-combat'), launch(drones)), 6);
    assert.equal(op.game.rocks.find(r => r.id === 'relay')!.owner, 'vesper');
    assert.equal(assessTrainingAttempt('shield-combat', op).status, 'failed');
  }
});
test('transport rejects drones in the designated passenger manifest', () => {
  const c = solutions['unit-transport']; assert.equal(c.type, 'dispatch');
  assert.throws(() => command(createTrainingAttempt('unit-transport'), { ...c, drones: 1 }));
  const op = clock(command(createTrainingAttempt('unit-transport'), { ...c, specialists: ['core-you', 'training-helmsman'] }), 6);
  assert.equal(assessTrainingAttempt('unit-transport', op).status, 'failed');
});
test('future production requires early scheduling, six available drones, preparation, and actual capture', () => {
  const initial = createTrainingAttempt('future-production');
  assert.throws(() => command(initial, launch(6)));
  const queued = command(initial, solutions['future-production']);
  assert.equal(clock(queued, 7.99).game.fleets.length, 0);
  const produced = clock(queued, 8);
  assert.equal(produced.game.fleets[0]!.drones, 6);
  assert.equal(produced.game.fleets[0]!.preparing, true);
  assert.equal(assessTrainingAttempt('future-production', produced).status, 'active');
  const late = clock(command(clock(initial, 8), launch(6)), 10);
  assert.equal(late.game.rocks.find(r => r.id === 'relay')!.owner, 'you');
  assert.equal(assessTrainingAttempt('future-production', late).status, 'failed');
  const c = solutions['future-production']; assert.equal(c.type, 'schedule');
  const canceled = command(queued, { type: 'cancel-schedule', owner: 'you', id: c.plan.id });
  assert.equal(assessTrainingAttempt('future-production', clock(canceled, 10)).status, 'failed');
});
test('weak interception leaves a raid alive and cannot pass', () => {
  const c = solutions.interception; assert.equal(c.type, 'intercept');
  const op = clock(command(createTrainingAttempt('interception'), { ...c, drones: 5 }), 6);
  assert.equal(assessTrainingAttempt('interception', op).status, 'failed');
});
test('a canceled early transfer cannot lend proof to an ordinary later launch', () => {
  let op = command(createTrainingAttempt('future-production'), solutions['future-production']);
  op = command(op, { type: 'cancel-schedule', owner: 'you', id: 'training-future-001' });
  op = command(clock(op, 8), launch(6));
  assert.equal(assessTrainingAttempt('future-production', clock(op, 10)).status, 'failed');
});
test('a raid that merely arrives and disappears is not an interception success', () => {
  const initial = createTrainingAttempt('interception');
  const defense = command(initial, { type: 'dispatch', owner: 'you', from: 'works', to: 'home', drones: 60 });
  const defended = clock(defense, 6);
  assert.equal(defended.game.rocks.find(r => r.id === 'home')!.owner, 'you');
  assert.equal(defended.game.fleets.some(f => f.id === 1), false);
  assert.equal(assessTrainingAttempt('interception', defended).status, 'failed');
});

test('capture objectives accept safe core relocation while the transport lesson keeps its stated home constraint', () => {
  let capture = command(createTrainingAttempt('first-launch'), { type: 'dispatch', owner: 'you', from: 'home', to: 'works', drones: 0, specialists: ['core-you'] });
  capture = command(capture, launch(6));
  assert.equal(assessTrainingAttempt('first-launch', clock(capture, 6)).status, 'passed');
  let transport = command(createTrainingAttempt('unit-transport'), { type: 'dispatch', owner: 'you', from: 'home', to: 'works', drones: 0, specialists: ['core-you'] });
  transport = command(transport, solutions['unit-transport']);
  assert.equal(assessTrainingAttempt('unit-transport', clock(transport, 6)).status, 'failed');
});
