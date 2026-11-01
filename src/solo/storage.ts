/** @format */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  decodeOperationSlices,
  encodeOperation,
  summarizeOperation,
  type LocalOperation,
  type OperationSummary,
} from '../game/operation-save';
const KEY = 'machination.game.v1';
export async function peekGame(): Promise<OperationSummary | null> {
  await pending.catch(() => undefined);
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? summarizeOperation(raw, Date.now()) : null;
}
export async function loadGame(): Promise<LocalOperation | null> {
  await pending.catch(() => undefined);
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? await runSlices(decodeOperationSlices(raw, () => Date.now())) : null;
}
/** Long histories replay in slices; yield to the interface whenever a batch exceeds the frame budget. */
export async function runSlices<T>(slices: Generator<unknown, T>, budgetMs = 12): Promise<T> {
  let started = Date.now();
  for (;;) {
    const step = slices.next();
    if (step.done) return step.value;
    if (Date.now() - started >= budgetMs) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      started = Date.now();
    }
  }
}
let pending = Promise.resolve();
export function saveGame(operation: LocalOperation): Promise<void> {
  const encoded = encodeOperation(operation, Date.now());
  pending = pending.catch(() => undefined).then(() => AsyncStorage.setItem(KEY, encoded));
  return pending;
}
