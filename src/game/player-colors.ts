/** Player livery, independent of portraits, with stable assignments for occupied seats. */
import type { Faction } from './players';
import { CHARACTERS, DEFAULT_PORTRAITS, type CharacterId } from './characters';

export const PLAYER_COLORS = {
  teal: { color: '#58d6c7', background: '#236b65' },
  rust: { color: '#e28b68', background: '#b95636' },
  gold: { color: '#e3ba5e', background: '#bf912e' },
  olive: { color: '#aeb67d', background: '#727b4e' },
  plum: { color: '#bba6b7', background: '#756670' },
  blue: { color: '#89b8cb', background: '#456c7c' },
  coral: { color: '#ff7892', background: '#853d53' },
  violet: { color: '#b08aff', background: '#57417d' },
  lime: { color: '#c7e875', background: '#617a30' },
  orange: { color: '#ffae57', background: '#88571e' },
} as const;
export type PlayerColor = keyof typeof PLAYER_COLORS;
export const PLAYER_COLOR_IDS = Object.keys(PLAYER_COLORS) as PlayerColor[];
export function isPlayerColor(value: unknown): value is PlayerColor {
  return typeof value === 'string' && Object.hasOwn(PLAYER_COLORS, value);
}
export function validPlayerColors(value: unknown, count: number): value is PlayerColor[] {
  return Array.isArray(value) && value.length === count && value.every(isPlayerColor) && new Set(value).size === count;
}
type Roster = { players: readonly Faction[]; portraits?: readonly CharacterId[]; colors?: readonly PlayerColor[] };
export function assignPlayerColor(rules: Roster, occupied: readonly Faction[], player: Faction, preferred?: PlayerColor): PlayerColor[] {
  const colors: PlayerColor[] = [];
  const used = new Set<PlayerColor>();
  const index = rules.players.indexOf(player);
  const defaultColor = (i: number) => rules.colors?.[i] ?? PLAYER_COLOR_IDS.find(id => PLAYER_COLORS[id].color === CHARACTERS[rules.portraits?.[i] ?? DEFAULT_PORTRAITS[i]!].color);
  const choose = (i: number, requested?: PlayerColor) => {
    const color = requested && !used.has(requested) ? requested : PLAYER_COLOR_IDS.find(id => !used.has(id))!;
    colors[i] = color;
    used.add(color);
  };
  rules.players.forEach((f, i) => { if (occupied.includes(f)) choose(i, defaultColor(i)); });
  if (!occupied.includes(player)) choose(index, preferred ?? defaultColor(index));
  rules.players.forEach((_, i) => { if (!colors[i]) choose(i, defaultColor(i)); });
  return colors;
}
