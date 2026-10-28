/** Resolve local storage, clock, and command behavior once for solo or isolated practice. */
import { advance } from './simulation';
import { applyCommand, exportArchive, type GameCommand } from './replay';
import { MAX_REPLAY_CHARACTERS, MAX_REPLAY_COMMANDS } from './replay-save';
import type { LocalOperation } from './operation-save';
import { assessTrainingAttempt, createTrainingAttempt, TRAINING_SCENARIOS, type TrainingId } from './training';

type SoloServices = { initial: () => LocalOperation; create: () => LocalOperation; load: () => Promise<LocalOperation | null>; save: (operation: LocalOperation) => Promise<void> };
export function localLifecycle(solo: SoloServices, training?: TrainingId) {
  const rivals = training === undefined;
  const scenario = TRAINING_SCENARIOS.find(item => item.id === training);
  const assess = (operation: LocalOperation) => training === undefined ? undefined : assessTrainingAttempt(training, operation);
  return {
    rivals, automaticClock: rivals, assess,
    initial: () => training === undefined ? solo.initial() : createTrainingAttempt(training),
    load: async () => training === undefined ? await solo.load() ?? solo.create() : createTrainingAttempt(training),
    save: async (operation: LocalOperation) => { if (training === undefined) await solo.save(operation); },
    advance(operation: LocalOperation, targetHour: number, source: 'clock' | 'manual'): LocalOperation {
      if (training !== undefined && (source === 'clock' || assess(operation)?.status !== 'active')) return operation;
      const target = scenario ? Math.min(scenario.deadline, targetHour) : targetHour;
      return { ...operation, game: advance(operation.game, target, { rivals, ...(training === undefined ? {} : { stopWhen: game => assess({ ...operation, game })?.status !== 'active' }) }) };
    },
    submit(operation: LocalOperation, command: GameCommand): LocalOperation {
      if (training !== undefined && assess(operation)?.status !== 'active') throw new Error('This exercise has ended. Retry or choose another exercise.');
      const next = applyCommand(operation.archive, command, { rivals, knownThrough: operation.game.hour });
      const data = exportArchive(next.archive);
      if (data.entries.length > MAX_REPLAY_COMMANDS || JSON.stringify(data).length > MAX_REPLAY_CHARACTERS) throw new Error('This operation has reached its command history limit.');
      return next;
    },
  };
}
