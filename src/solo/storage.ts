/** @format */
import { abortIfNeeded, runSteps } from './execution';

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  decodeOperationSteps,
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
export async function loadGame(
  signal?: { readonly aborted: boolean },
  now = Date.now(),
): Promise<LocalOperation | null> {
  await pending.catch(() => undefined);
  const raw = await AsyncStorage.getItem(KEY);
  abortIfNeeded(signal);
  return raw ? runSteps(decodeOperationSteps(raw, now), signal) : null;
}
let pending = Promise.resolve();
export function saveGame(operation: LocalOperation, savedAt = Date.now()): Promise<void> {
  const encoded = encodeOperation(operation, savedAt);
  pending = pending.catch(() => undefined).then(() => AsyncStorage.setItem(KEY, encoded));
  return pending;
}
