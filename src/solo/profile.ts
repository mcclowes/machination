/** Device-local profile preferences, stored separately from operation saves. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isPlayerColor, type PlayerColor } from '../game/player-colors';

export type PlayerProfile = { preferredColor?: PlayerColor };
const KEY = 'machination.profile.v1';
export async function loadProfile(): Promise<PlayerProfile> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return {};
  const value = JSON.parse(raw) as PlayerProfile;
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value.preferredColor !== undefined && !isPlayerColor(value.preferredColor))) throw new Error('Saved profile is invalid.');
  return value;
}
export async function saveProfile(profile: PlayerProfile): Promise<void> {
  if (profile.preferredColor !== undefined && !isPlayerColor(profile.preferredColor)) throw new Error('Choose a known player color.');
  await AsyncStorage.setItem(KEY, JSON.stringify(profile));
}
