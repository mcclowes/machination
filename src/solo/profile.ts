/** Device-local profile preferences, stored separately from operation saves. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isPlayerColor, type PlayerColor } from '../game/player-colors';
import { CHARACTERS, type CharacterId } from '../game/characters';

export type PlayerProfile = { name?: string; preferredColor?: PlayerColor; portrait?: CharacterId };
export const PROFILE_NAME_MAX = 24;
export function normalizeProfileName(raw: string): string {
  return Array.from(raw.replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, ' ').trim()).slice(0, PROFILE_NAME_MAX).join('').trim();
}
const validName = (value: unknown) => typeof value === 'string' && value.length > 0 && normalizeProfileName(value) === value;
const validPortrait = (value: unknown) => typeof value === 'string' && Object.hasOwn(CHARACTERS, value);
const KEY = 'machination.profile.v1';
export async function loadProfile(): Promise<PlayerProfile> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return {};
  const value = JSON.parse(raw) as PlayerProfile;
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value.name !== undefined && !validName(value.name)) || (value.portrait !== undefined && !validPortrait(value.portrait)) || (value.preferredColor !== undefined && !isPlayerColor(value.preferredColor))) throw new Error('Saved profile is invalid.');
  return value;
}
export async function saveProfile(profile: PlayerProfile): Promise<void> {
  if (profile.name !== undefined && !validName(profile.name)) throw new Error('Choose a valid name.');
  if (profile.preferredColor !== undefined && !isPlayerColor(profile.preferredColor)) throw new Error('Choose a known player color.');
  if (profile.portrait !== undefined && !validPortrait(profile.portrait)) throw new Error('Choose a known profile picture.');
  await AsyncStorage.setItem(KEY, JSON.stringify(profile));
}
