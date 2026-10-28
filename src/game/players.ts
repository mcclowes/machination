/**
 * ---
 * purpose: Bounded intelligence identities and the participants belonging to an operation.
 * ---
 */
import { CHARACTERS, DEFAULT_PORTRAITS, type CharacterId } from './characters';
export const FACTIONS = {
  you: { name: 'Mnemosyne', code: 'MN', ...CHARACTERS.admiral },
  vesper: { name: 'Vesper', code: 'VS', ...CHARACTERS.pilot },
  null: { name: 'Null collective', code: 'NC', ...CHARACTERS.engineer },
  aether: { name: 'Aether', code: 'AE', ...CHARACTERS.ranger },
  umbra: { name: 'Umbra', code: 'UM', ...CHARACTERS.diplomat },
  orbit: { name: 'Orbit', code: 'OR', ...CHARACTERS.navigator },
  prism: { name: 'Prism', code: 'PR', ...CHARACTERS.hotshot },
  echo: { name: 'Echo', code: 'EC', ...CHARACTERS.envoy },
  nadir: { name: 'Nadir', code: 'ND', ...CHARACTERS.veteran },
  zenith: { name: 'Zenith', code: 'ZN', ...CHARACTERS.enforcer },
} as const;
export type Faction = keyof typeof FACTIONS;
// Only participating identities are populated; save validation requires their complete values.
export type PlayerValues<T> = Partial<Record<Faction, T>>;
export const LEGACY_PLAYERS: readonly Faction[] = ['you', 'vesper', 'null'];
export const ALL_PLAYERS = Object.keys(FACTIONS) as Faction[];
export function playerAppearance(faction: Faction, portraits?: readonly CharacterId[]) {
  const index = ALL_PLAYERS.indexOf(faction);
  const character = portraits?.[index] ?? DEFAULT_PORTRAITS[index]!;
  return { ...FACTIONS[faction], ...CHARACTERS[character] };
}
export function playersIn(game: { rules?: { players: readonly Faction[] } }): readonly Faction[] { return game.rules?.players ?? LEGACY_PLAYERS; }
export function isFaction(value: unknown): value is Faction { return typeof value === 'string' && Object.hasOwn(FACTIONS, value); }
