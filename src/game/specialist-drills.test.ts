import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessTrainingAttempt, createTrainingAttempt } from './training';
import { applyCommand, exportArchive, replayTo, type GameCommand } from './replay';
import { advance } from './simulation';
import { decodeSave } from './save-format';
import { encodeOperation, type LocalOperation } from './operation-save';
import { decodeReplay } from './replay-save';
import { SPECIALIST_DRILLS, type SpecialistDrillId } from './specialist-drills';
import { localLifecycle } from './local-lifecycle';
import type { SpecialistKind } from './specialist-catalog';

type Step = [number, GameCommand | ((op: LocalOperation) => GameCommand)];
const launch = (from: string, to: string, drones: number, specialists?: string[]): GameCommand => ({ type: 'dispatch', owner: 'you', from, to, drones, ...(specialists ? { specialists } : {}) });
const hire = (kind: SpecialistKind): GameCommand => ({ type: 'hire', owner: 'you', kind });
const promote = (id: string): GameCommand => ({ type: 'promote', owner: 'you', id });
const hiredId = (op: LocalOperation, kind: SpecialistKind) => op.game.rocks.flatMap(r => r.specialists ?? []).find(u => u.owner === 'you' && u.kind === kind && u.id.startsWith('unit-'))!.id;

const solutions: Record<SpecialistDrillId, Step[]> = {
  'custodian-recharge': [[0, launch('home', 'works', 0, ['training-inspector'])]],
  'bulwark-capacity': [[3, promote('training-inspector')]],
  'hijacker-raid': [[3, hire('thief')], [3, op => launch('home', 'relay', 18, [hiredId(op, 'thief')])]],
  'navigator-course': [[0, op => ({ type: 'hauler', owner: 'you', change: { fleet: op.game.fleets.find(f => f.owner === 'you')!.id, action: 'course', to: 'relay' } })]],
  'admiral-swarm': [[3, promote('training-navigator')], [3, launch('remote-0', 'works', 30)]],
  'envoy-release': [[3, hire('diplomat')]],
  'fallback-core': [[3, hire('princess')], [3, op => launch('home', 'works', 0, [hiredId(op, 'princess')])]],
  'assimilator-convert': [[3, hire('hypnotist')], [3, launch('home', 'relay', 10, ['enemy-warHero'])]],
  'overclock-siege': [[3, promote('training-hypnotist')], [3, launch('home', 'relay', 18)]],
  'watchdog-fire': [[3, promote('training-warHero')]],
  'governor-capacity': [[3, promote('training-tinkerer')]],
  'overseer-output': [[3, promote('training-smuggler')]],
};

const wrongPlans: Partial<Record<SpecialistDrillId, Step[]>> = {
  'custodian-recharge': [[0, launch('home', 'relay', 0, ['training-inspector'])]],
  'hijacker-raid': [[0, launch('home', 'relay', 18)]],
  'admiral-swarm': [[0, launch('remote-0', 'works', 30)]],
  'envoy-release': [[3, hire('inspector')]],
  'fallback-core': [[0, launch('home', 'works', 0, ['core-you'])]],
  'assimilator-convert': [[0, launch('home', 'relay', 10)]],
  'overclock-siege': [[0, launch('home', 'relay', 18)]],
  'watchdog-fire': [[0, launch('works', 'home', 0, ['training-warHero'])]],
};

const submit = (op: LocalOperation, step: Step[1]): LocalOperation => applyCommand(op.archive, typeof step === 'function' ? step(op) : step, { rivals: false, knownThrough: op.game.hour });
const clock = (op: LocalOperation, hour: number): LocalOperation => ({ ...op, game: advance(op.game, hour, { rivals: false }) });
const play = (id: SpecialistDrillId, steps: Step[]) => steps.reduce((op, [hour, c]) => submit(clock(op, hour), c), createTrainingAttempt(id));
const solo = { initial: () => { throw new Error('solo touched'); }, create: () => { throw new Error('solo touched'); }, load: async () => { throw new Error('solo touched'); }, save: async () => { throw new Error('solo touched'); } };

for (const drill of SPECIALIST_DRILLS) {
  test(`${drill.id}: public commands solve a deterministic, valid, replayable drill`, () => {
    const initial = createTrainingAttempt(drill.id);
    assert.deepEqual(decodeSave(encodeOperation(initial, 0)).game, initial.game);
    assert.doesNotThrow(() => decodeReplay(exportArchive(initial.archive), initial.game, false));
    assert.deepEqual(createTrainingAttempt(drill.id).game, initial.game);
    assert.equal(assessTrainingAttempt(drill.id, initial).status, 'active');
    const op = clock(play(drill.id, solutions[drill.id]), drill.deadline);
    assert.equal(assessTrainingAttempt(drill.id, op).status, 'passed');
    assert.deepEqual(replayTo(op.archive, op.game.hour, { rivals: false, knownThrough: op.game.hour }), op.game);
    assert.deepEqual(decodeSave(encodeOperation(op, 0)).game, op.game);
  });
  test(`${drill.id}: idle and resignation do not pass`, () => {
    const op = createTrainingAttempt(drill.id);
    assert.equal(assessTrainingAttempt(drill.id, clock(op, drill.deadline)).status, 'failed');
    assert.equal(assessTrainingAttempt(drill.id, submit(op, { type: 'resign', owner: 'you' })).status, 'failed');
  });
  test(`${drill.id}: shared lifecycle stops at its first actual outcome`, () => {
    const policy = localLifecycle(solo, drill.id);
    let op = policy.initial();
    for (const [hour, c] of solutions[drill.id]) {
      op = policy.advance(op, hour, 'manual');
      op = policy.submit(op, typeof c === 'function' ? c(op) : c);
    }
    op = policy.advance(op, drill.deadline + 10, 'manual');
    assert.equal(policy.assess(op)?.status, 'passed');
    assert.ok(op.game.hour <= drill.deadline);
  });
}

for (const [id, steps] of Object.entries(wrongPlans) as [SpecialistDrillId, Step[]][]) {
  test(`${id}: a plausible plan without the specialist's ability fails`, () => {
    const deadline = SPECIALIST_DRILLS.find(d => d.id === id)!.deadline;
    assert.equal(assessTrainingAttempt(id, clock(play(id, steps), deadline)).status, 'failed');
  });
}
