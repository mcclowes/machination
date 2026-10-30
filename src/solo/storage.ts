/** @format */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { decodeOperation, encodeOperation, type LocalOperation } from '../game/operation-save';
const KEY = 'machination.game.v1';
export async function loadGame(): Promise<LocalOperation | null> {
  await pending.catch(() => undefined);
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? decodeOperation(raw, Date.now()) : null;
}
let pending = Promise.resolve();
export function saveGame(operation: LocalOperation): Promise<void> {
  const encoded = encodeOperation(operation, Date.now());
  pending = pending.catch(() => undefined).then(() => AsyncStorage.setItem(KEY, encoded));
  return pending;
}
