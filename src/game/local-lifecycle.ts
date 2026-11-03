/** Resolve local storage, clock, and command behavior once for solo or isolated practice. */
import { advanceSteps } from './simulation';
import { finishSteps } from './execution';
import { applyCommandSteps, exportArchive, type GameCommand } from './replay';
import { MAX_REPLAY_CHARACTERS, MAX_REPLAY_COMMANDS } from './replay-save';
import type { LocalOperation } from './operation-save';
import { assessTrainingAttempt, createTrainingAttempt, TRAINING_SCENARIOS, type TrainingId } from './training';

type SoloServices = { initial: () => LocalOperation; create: () => LocalOperation; load: (signal?: { readonly aborted: boolean }, now?: number) => Promise<LocalOperation | null>; save: (operation: LocalOperation, savedAt?: number) => Promise<void> };
type LocalLifecycle = {
  rivals: boolean;
  automaticClock: boolean;
  assess: (operation: LocalOperation) => ReturnType<typeof assessTrainingAttempt> | undefined;
  initial: () => LocalOperation;
  load: (signal?: { readonly aborted: boolean }, now?: number) => Promise<LocalOperation>;
  save: (operation: LocalOperation, savedAt?: number) => Promise<void>;
  advance: (operation: LocalOperation, targetHour: number, source: 'clock' | 'manual') => LocalOperation;
  advanceSteps: (operation: LocalOperation, targetHour: number, source: 'clock' | 'manual') => Generator<void, LocalOperation, unknown>;
  submitSteps: (operation: LocalOperation, command: GameCommand) => Generator<void, LocalOperation, unknown>;
  submit: (operation: LocalOperation, command: GameCommand) => LocalOperation;
};

function* submitSteps(operation: LocalOperation, command: GameCommand, rivals: boolean): Generator<void, LocalOperation, unknown> {
  const next = yield* applyCommandSteps(operation.archive, command, { rivals, knownThrough: operation.game.hour });
  const data = exportArchive(next.archive);
  if (data.entries.length > MAX_REPLAY_COMMANDS || JSON.stringify(data).length > MAX_REPLAY_CHARACTERS) throw new Error('This operation has reached its command history limit.');
  return next;
}

export function localLifecycle(solo: SoloServices, training?: TrainingId): LocalLifecycle {
  if (training === undefined) return {
    rivals: true,
    automaticClock: true,
    assess: () => undefined,
    initial: () => solo.initial(),
    load: async (signal, now) => await solo.load(signal, now) ?? solo.create(),
    save: async (operation, savedAt) => { await solo.save(operation, savedAt); },
    advance: (operation, targetHour) => finishSteps(advanceSolo(operation, targetHour)),
    advanceSteps: advanceSolo,
    submit: (operation, command) => finishSteps(submitSteps(operation, command, true)),
    submitSteps: (operation, command) => submitSteps(operation, command, true),
  };

  const scenario = TRAINING_SCENARIOS.find(item => item.id === training);
  const assess = (operation: LocalOperation) => assessTrainingAttempt(training, operation);
  function* advancePractice(operation: LocalOperation, targetHour: number, source: 'clock' | 'manual'): Generator<void, LocalOperation, unknown> {
    if (source === 'clock' || assess(operation).status !== 'active') return operation;
    const target = scenario ? Math.min(scenario.deadline, targetHour) : targetHour;
    return { ...operation, game: yield* advanceSteps(operation.game, target, { rivals: false, stopWhen: game => assess({ ...operation, game }).status !== 'active' }) };
  }
  function* submitPractice(operation: LocalOperation, command: GameCommand): Generator<void, LocalOperation, unknown> {
    if (assess(operation).status !== 'active') throw new Error('This exercise has ended. Retry or choose another exercise.');
    return yield* submitSteps(operation, command, false);
  }
  return {
    rivals: false, automaticClock: false, assess,
    initial: () => createTrainingAttempt(training),
    load: async () => createTrainingAttempt(training),
    save: async () => {},
    advance: (operation, targetHour, source) => finishSteps(advancePractice(operation, targetHour, source)),
    advanceSteps: advancePractice,
    submit: (operation, command) => finishSteps(submitPractice(operation, command)),
    submitSteps: submitPractice,
  };
}

function* advanceSolo(operation: LocalOperation, targetHour: number): Generator<void, LocalOperation, unknown> {
  return { ...operation, game: yield* advanceSteps(operation.game, targetHour, { rivals: true }) };
}
