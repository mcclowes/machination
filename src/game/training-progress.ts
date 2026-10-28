/** Store completion metadata separately from operations and online credentials. */
import { TRAINING_SCENARIOS, type TrainingId } from './training';

export const TRAINING_PROGRESS_KEY = 'machination.training-progress.v1';
type Storage = { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void> };
function decode(raw: string | null): TrainingId[] {
  if (raw === null) return [];
  try {
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || value.contentVersion !== 1 || Object.keys(value).sort().join(',') !== 'completed,contentVersion,version' || !Array.isArray(value.completed)
      || value.completed.length > TRAINING_SCENARIOS.length || new Set(value.completed).size !== value.completed.length || value.completed.some((id: unknown) => !TRAINING_SCENARIOS.some(item => item.id === id))) throw new Error();
    return [...value.completed];
  } catch { throw new Error('Practice progress could not be read. Your exercises and live operations are still available.'); }
}

export function trainingProgressStore(storage: Storage) {
  let pending = Promise.resolve<TrainingId[]>([]);
  return {
    async load(): Promise<TrainingId[]> { await pending.catch(() => undefined); return decode(await storage.getItem(TRAINING_PROGRESS_KEY)); },
    complete(id: TrainingId): Promise<TrainingId[]> {
      const work = pending.catch(() => undefined).then(async () => {
        if (!TRAINING_SCENARIOS.some(item => item.id === id)) throw new Error('Choose a known practice exercise.');
        const completed = decode(await storage.getItem(TRAINING_PROGRESS_KEY));
        if (!completed.includes(id)) {
          completed.push(id);
          await storage.setItem(TRAINING_PROGRESS_KEY, JSON.stringify({ version: 1, contentVersion: 1, completed }));
        }
        return completed;
      });
      pending = work;
      return work;
    },
  };
}
