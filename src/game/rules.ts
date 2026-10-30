/**
 * ---
 * purpose: Configured game creation and public victory rules, separate from private map seeds.
 * ---
 */
import { createTeams, teamMembers, validateTeams, type TeamFormat, type TeamProfile } from './teams';
import { validateTacticalPulseConfig, type TacticalPulseConfig } from './tactical-pulse';
import { validatePulseConfig, type PulseConfig } from './pulse';
import type { MapGeometry } from './geometry';
import { ALL_PLAYERS, type Faction } from './players';
import { validPlayerColors, type PlayerColor } from './player-colors';
import { validPortraits, type CharacterId } from './characters';
export type GameOptions = { teamFormat?: TeamFormat; playerCount: number; mode: 'pulse' | 'mining' | 'domination'; portraits?: CharacterId[]; driftingBases?: boolean; beltCompact?: boolean };
export type GameRules = { teams?: TeamProfile; beltCompact?: 1; mechanicsVersion?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18; driftingBases?: boolean; pulse?: PulseConfig; tacticalPulse?: TacticalPulseConfig; players: Faction[]; colors?: PlayerColor[]; portraits?: CharacterId[]; mode: GameOptions['mode']; victoryTarget: number; map: MapGeometry & { generator: 'balanced.v1' | 'balanced.v2'; seed: number } };
export type PublicRules = Omit<GameRules, 'map'> & { map: Omit<GameRules['map'], 'seed'> };
export const DEFAULT_GAME_OPTIONS: GameOptions = { playerCount: 3, mode: 'pulse', driftingBases: false };
export const OUTPOSTS_PER_PLAYER = 10;
export function validateOptions(value: unknown): GameOptions {
  const v = value as Partial<GameOptions> | null;
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(key => !['playerCount', 'mode', 'portraits', 'driftingBases', 'beltCompact', 'teamFormat'].includes(key)) || !Number.isSafeInteger(v.playerCount) || v.playerCount! < 2 || v.playerCount! > ALL_PLAYERS.length || !['pulse', 'mining', 'domination'].includes(v.mode!)) throw new Error('Choose 2–10 players and King’s Pulse, mining, or domination.');
  if (v.beltCompact !== undefined && typeof v.beltCompact !== 'boolean') throw new Error('Choose whether the Belt compact applies.');
  if (v.driftingBases !== undefined && typeof v.driftingBases !== 'boolean') throw new Error('Choose whether asteroid bases drift.');
  if (v.portraits !== undefined && !validPortraits(v.portraits, v.playerCount!)) throw new Error('Choose a different known portrait for each player.');
  if (v.teamFormat !== undefined) {
    if (!['2v2', '3v3v3', '4v4'].includes(v.teamFormat) || v.mode === 'pulse') throw new Error('Choose doubles, 3v3v3, or 4v4 with mining or domination.');
    createTeams(v.teamFormat, ALL_PLAYERS.slice(0, v.playerCount));
  }
  return { ...(v.teamFormat ? { teamFormat: v.teamFormat } : {}), playerCount: v.playerCount!, mode: v.mode!, ...(v.beltCompact === undefined ? {} : { beltCompact: v.beltCompact }), ...(v.driftingBases === undefined ? {} : { driftingBases: v.driftingBases }), ...(v.portraits === undefined ? {} : { portraits: [...v.portraits] }) };
}
export function publicRules(rules: GameRules): PublicRules { const { seed: _seed, ...map } = rules.map; return { ...rules, ...(rules.teams ? { teams: validateTeams(rules.teams, rules.players) } : {}), ...(rules.tacticalPulse ? { tacticalPulse: { ...rules.tacticalPulse } } : {}), ...(rules.pulse ? { pulse: { ...rules.pulse } } : {}), players: [...rules.players], ...(rules.colors ? { colors: [...rules.colors] } : {}), ...(rules.portraits ? { portraits: [...rules.portraits] } : {}), map }; }
export function validateRules(value: unknown): GameRules {
  const r = value as GameRules;
  const keys = (v: object, allowed: string[]) => Object.keys(v).length === allowed.length && Object.keys(v).every(key => allowed.includes(key));
  if (!r || typeof r !== 'object' || Array.isArray(r) || !keys(r, ['players', 'mode', 'victoryTarget', 'map', ...(r.colors === undefined ? [] : ['colors']), ...(r.teams === undefined ? [] : ['teams']), ...(r.beltCompact === undefined ? [] : ['beltCompact']), ...(r.pulse === undefined ? [] : ['pulse']), ...(r.tacticalPulse === undefined ? [] : ['tacticalPulse']), ...(r.portraits === undefined ? [] : ['portraits']), ...(r.mechanicsVersion === undefined ? [] : ['mechanicsVersion']), ...(r.driftingBases === undefined ? [] : ['driftingBases'])]) || !(r.beltCompact === undefined || r.beltCompact === 1) || !(r.mechanicsVersion === undefined || [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].includes(r.mechanicsVersion)) || ((r.mechanicsVersion ?? 1) >= 7 ? typeof r.driftingBases !== 'boolean' : r.driftingBases !== undefined) || !Array.isArray(r.players) || r.players.length < 2 || r.players.length > ALL_PLAYERS.length || r.players[0] !== 'you' || new Set(r.players).size !== r.players.length || !r.players.every(f => ALL_PLAYERS.includes(f)) || r.portraits !== undefined && !validPortraits(r.portraits, r.players.length) || !['pulse', 'mining', 'domination'].includes(r.mode) || r.victoryTarget !== (r.mode === 'pulse' ? 1 : r.mode === 'mining' ? (r.teams || (r.mechanicsVersion ?? 1) >= 17 ? 300 : 200) : r.players.length * OUTPOSTS_PER_PLAYER / 2)
    || !r.map || typeof r.map !== 'object' || !keys(r.map, r.map.generator === 'balanced.v2' ? ['generator', 'seed', 'width', 'height', 'topology'] : ['generator', 'seed', 'width', 'height']) || !['balanced.v1', 'balanced.v2'].includes(r.map.generator) || r.map.generator === 'balanced.v2' && r.map.topology !== 'torus' || !Number.isSafeInteger(r.map.seed) || r.map.seed < 0 || r.map.seed >= 2 ** 32 || ![r.map.width, r.map.height].every(n => Number.isFinite(n) && n > 0 && n <= 10_000)) throw new Error('Unsupported operation rules.');
  if (r.mode === 'pulse' ? ![15, 16, 17, 18].includes(r.mechanicsVersion!) || !r.pulse : r.pulse !== undefined) throw new Error('Unsupported pulse rules.');
  if (r.colors !== undefined && !validPlayerColors(r.colors, r.players.length)) throw new Error('Unsupported player colors.');
  if (r.pulse) validatePulseConfig(r.pulse);
  if (r.mode === 'pulse' && (r.mechanicsVersion ?? 1) >= 16 ? !r.tacticalPulse : r.tacticalPulse !== undefined) throw new Error('Unsupported tactical pulse rules.');
  if (r.tacticalPulse) validateTacticalPulseConfig(r.tacticalPulse);
  if (r.teams !== undefined) {
    if ((r.mechanicsVersion ?? 1) < 17 || r.mode === 'pulse') throw new Error('Unsupported team rules.');
    validateTeams(r.teams, r.players);
  }
  return { ...r, ...(r.teams ? { teams: validateTeams(r.teams, r.players) } : {}), ...(r.tacticalPulse ? { tacticalPulse: { ...r.tacticalPulse } } : {}), ...(r.pulse ? { pulse: { ...r.pulse } } : {}), players: [...r.players], ...(r.colors ? { colors: [...r.colors] } : {}), ...(r.portraits ? { portraits: [...r.portraits] } : {}), map: { ...r.map } };
}
export function victoryTarget(game: { version?: number; rules?: Pick<GameRules, 'victoryTarget'> }): number { return game.rules?.victoryTarget ?? (game.version === 1 ? 300 : 200); }
export function victoryProgress(game: { rules?: Pick<GameRules, 'mode' | 'teams'>; cargo: Partial<Record<Faction, number>>; rocks: readonly { owner?: Faction | null }[] }, owner: Faction): number {
  const members = teamMembers(game, owner);
  return game.rules?.mode === 'domination' ? game.rocks.filter(r => r.owner && members.includes(r.owner)).length : members.reduce((total, f) => total + (game.cargo[f] ?? 0), 0);
}

export function mechanicsVersion(game: { rules?: Pick<GameRules, 'mechanicsVersion'> }): 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 { return game.rules?.mechanicsVersion ?? 1; }
export function driftingBasesEnabled(game: { rules?: Pick<GameRules, 'mechanicsVersion' | 'driftingBases'> }): boolean { return game.rules?.driftingBases ?? game.rules?.mechanicsVersion === 6; }
