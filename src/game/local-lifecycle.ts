/** Resolve local storage, clock, and command behavior once for solo or isolated practice. */
import { advance } from './simulation';
import { applyCommand, exportArchive, type GameCommand } from './replay';
import { MAX_REPLAY_CHARACTERS, MAX_REPLAY_COMMANDS } from './replay-save';
import type { LocalOperation } from './operation-save';
import { assessTrainingAttempt, createTrainingAttempt, TRAINING_SCENARIOS, type TrainingId } from './training';

type SoloServices = { initial: () => LocalOperation; create: () => LocalOperation; load: () => Promise<LocalOperation | null>; save: (operation: LocalOperation) => Promise<void> };
type LocalLifecycle = {
  rivals: boolean;
  automaticClock: boolean;
  assess: (operation: LocalOperation) => ReturnType<typeof assessTrainingAttempt> | undefined;
  initial: () => LocalOperation;
  load: () => Promise<LocalOperation>;
  save: (operation: LocalOperation) => Promise<void>;
  advance: (operation: LocalOperation, targetHour: number, source: 'clock' | 'manual') => LocalOperation;
  submit: (operation: LocalOperation, command: GameCommand) => LocalOperation;
};

function submit(operation: LocalOperation, command: GameCommand, rivals: boolean): LocalOperation {
  const next = applyCommand(operation.archive, command, { rivals, knownThrough: operation.game.hour });
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
    load: async () => await solo.load() ?? solo.create(),
    save: async operation => { await solo.save(operation); },
    advance: (operation, targetHour) => ({ ...operation, game: advance(operation.game, targetHour, { rivals: true }) }),
    submit: (operation, command) => submit(operation, command, true),
  };

  const scenario = TRAINING_SCENARIOS.find(item => item.id === training);
  const assess = (operation: LocalOperation) => assessTrainingAttempt(training, operation);
  return {
    rivals: false, automaticClock: false, assess,
    initial: () => createTrainingAttempt(training),
    load: async () => createTrainingAttempt(training),
    save: async () => {},
    advance(operation, targetHour, source) {
      if (source === 'clock' || assess(operation).status !== 'active') return operation;
      const target = scenario ? Math.min(scenario.deadline, targetHour) : targetHour;
      return { ...operation, game: advance(operation.game, target, { rivals: false, stopWhen: game => assess({ ...operation, game }).status !== 'active' }) };
    },
    submit(operation, command) {
      if (assess(operation).status !== 'active') throw new Error('This exercise has ended. Retry or choose another exercise.');
      return submit(operation, command, false);
    },
  };
}
