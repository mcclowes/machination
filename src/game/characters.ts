/** Supplied commander artwork, palettes, and insignia. Coordinates exclude the sheet gutters. */
const palettes = {
  slate: { color: '#9bafb3', background: '#56666a' }, rust: { color: '#e28b68', background: '#b95636' },
  gold: { color: '#e3ba5e', background: '#bf912e' }, olive: { color: '#aeb67d', background: '#727b4e' },
  plum: { color: '#bba6b7', background: '#756670' }, blue: { color: '#89b8cb', background: '#456c7c' },
};
export type Emblem = 'compass' | 'spear' | 'gear' | 'bars' | 'meridian' | 'cluster' | 'star' | 'triangles' | 'crescent' | 'chevron';
function character(label: string, sheet: 'original' | 'retro' | 'cyborg' | 'cybernetic' | 'nomad', column: number, row: number, palette: keyof typeof palettes, emblem: Emblem) {
  return { label, ...palettes[palette], emblem, portrait: { sheet, x: [15, 525, 1035][column]!, y: row === 0 ? 12 : 521 } };
}
export const CHARACTERS = {
  admiral: character('Admiral', 'original', 0, 0, 'slate', 'compass'),
  pilot: character('Pilot', 'original', 1, 0, 'rust', 'spear'),
  engineer: character('Engineer', 'original', 2, 0, 'gold', 'gear'),
  ranger: character('Ranger', 'original', 0, 1, 'olive', 'bars'),
  diplomat: character('Diplomat', 'original', 1, 1, 'plum', 'meridian'),
  navigator: character('Navigator', 'original', 2, 1, 'blue', 'cluster'),
  hotshot: character('Hotshot', 'retro', 0, 0, 'rust', 'star'),
  tactician: character('Tactician', 'retro', 1, 0, 'plum', 'meridian'),
  scout: character('Scout', 'retro', 2, 0, 'olive', 'triangles'),
  mechanic: character('Mechanic', 'retro', 0, 1, 'gold', 'gear'),
  envoy: character('Envoy', 'retro', 1, 1, 'blue', 'crescent'),
  enforcer: character('Enforcer', 'retro', 2, 1, 'rust', 'chevron'),
  augur: character('Augur', 'cyborg', 0, 0, 'rust', 'meridian'),
  veteran: character('Veteran', 'cyborg', 1, 0, 'slate', 'triangles'),
  signal: character('Signal', 'cyborg', 2, 0, 'gold', 'gear'),
  wraith: character('Wraith', 'cyborg', 0, 1, 'olive', 'meridian'),
  courier: character('Courier', 'cyborg', 1, 1, 'plum', 'cluster'),
  ace: character('Ace', 'cyborg', 2, 1, 'rust', 'star'),
  oracle: character('Oracle', 'cybernetic', 0, 0, 'plum', 'meridian'),
  bulwark: character('Bulwark', 'cybernetic', 1, 0, 'rust', 'triangles'),
  relay: character('Relay', 'cybernetic', 2, 0, 'gold', 'gear'),
  sentinel: character('Sentinel', 'cybernetic', 0, 1, 'blue', 'star'),
  marshal: character('Marshal', 'cybernetic', 1, 1, 'olive', 'cluster'),
  revenant: character('Revenant', 'cybernetic', 2, 1, 'plum', 'chevron'),
  pilgrim: character('Pilgrim', 'nomad', 0, 0, 'gold', 'meridian'),
  seer: character('Seer', 'nomad', 1, 0, 'blue', 'crescent'),
  wanderer: character('Wanderer', 'nomad', 2, 0, 'rust', 'star'),
  disciple: character('Disciple', 'nomad', 0, 1, 'olive', 'crescent'),
  elder: character('Elder', 'nomad', 1, 1, 'plum', 'triangles'),
  veil: character('Veil', 'nomad', 2, 1, 'slate', 'meridian'),
} as const;
export type CharacterId = keyof typeof CHARACTERS;
export const CHARACTER_IDS = Object.keys(CHARACTERS) as CharacterId[];
export const DEFAULT_PORTRAITS: readonly CharacterId[] = ['admiral', 'pilot', 'engineer', 'ranger', 'diplomat', 'navigator', 'hotshot', 'envoy', 'veteran', 'enforcer'];
export function validPortraits(value: unknown, count: number): value is CharacterId[] {
  return Array.isArray(value) && value.length === count && new Set(value).size === count && value.every(id => typeof id === 'string' && Object.hasOwn(CHARACTERS, id));
}
