import AsyncStorage from '@react-native-async-storage/async-storage';
import { type Game, advance } from './simulation';
import { decodeSave, type Save } from './save-format';
const KEY = 'machination.game.v1';
export async function loadGame(): Promise<Game | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  const saved = decodeSave(raw);
  return advance(saved.game, saved.game.hour + Math.max(0, Date.now() - saved.savedAt) / 3_600_000);
}
let pending = Promise.resolve();
export function saveGame(game: Game): Promise<void> {
  const encoded = JSON.stringify({ savedAt: Date.now(), game } satisfies Save);
  pending = pending.catch(() => undefined).then(() => AsyncStorage.setItem(KEY, encoded));
  return pending;
}
