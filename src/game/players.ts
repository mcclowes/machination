/**
 * ---
 * purpose: Bounded intelligence identities and the participants belonging to an operation.
 * ---
 */
export const FACTIONS = {
  you: { name: 'Mnemosyne', color: '#b8e986', code: 'MN' },
  vesper: { name: 'Vesper', color: '#e9a775', code: 'VS' },
  null: { name: 'Null collective', color: '#a3a1ef', code: 'NC' },
  aether: { name: 'Aether', color: '#6ed4e7', code: 'AE' },
  umbra: { name: 'Umbra', color: '#ec87b9', code: 'UM' },
  orbit: { name: 'Orbit', color: '#f0db76', code: 'OR' },
  prism: { name: 'Prism', color: '#77d6b0', code: 'PR' },
  echo: { name: 'Echo', color: '#e98585', code: 'EC' },
  nadir: { name: 'Nadir', color: '#82aeed', code: 'ND' },
  zenith: { name: 'Zenith', color: '#ceb69a', code: 'ZN' },
} as const;
export type Faction = keyof typeof FACTIONS;
// Only participating identities are populated; save validation requires their complete values.
export type PlayerValues<T> = Partial<Record<Faction, T>>;
export const LEGACY_PLAYERS: readonly Faction[] = ['you', 'vesper', 'null'];
export const ALL_PLAYERS = Object.keys(FACTIONS) as Faction[];
export function playersIn(game: { rules?: { players: readonly Faction[] } }): readonly Faction[] { return game.rules?.players ?? LEGACY_PLAYERS; }
export function isFaction(value: unknown): value is Faction { return typeof value === 'string' && Object.hasOwn(FACTIONS, value); }
