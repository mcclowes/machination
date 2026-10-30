/**
 * ---
 * purpose: Persistent faction identities, their fixed starting elites, and faction standings contracts.
 * ---
 */
export const ALLEGIANCES = {
  mnemosyne: { name: 'Mnemosyne', elite: 'security', description: 'Defend the network. Start with a Bulwark.', color: '#b8e986' },
  vesper: { name: 'Vesper', elite: 'general', description: 'Control the battlefield. Start with a Warmind.', color: '#ffbb91' },
  null: { name: 'Null collective', elite: 'tycoon', description: 'Build the machine. Start with an Overseer.', color: '#8fd8ef' },
} as const;
export type Allegiance = keyof typeof ALLEGIANCES;
export const ALLEGIANCE_IDS = Object.keys(ALLEGIANCES) as Allegiance[];
export type FactionStandings = { completedGames: number; faction?: Allegiance; leaderboard: { faction: Allegiance; wins: number }[] };
export function isAllegiance(value: unknown): value is Allegiance {
  return typeof value === 'string' && Object.hasOwn(ALLEGIANCES, value);
}
