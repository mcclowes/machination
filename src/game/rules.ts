/**
 * ---
 * purpose: Configured game creation and public victory rules, separate from private map seeds.
 * ---
 */
import type { MapGeometry } from './geometry';
import { ALL_PLAYERS, type Faction } from './players';
import { validPortraits, type CharacterId } from './characters';
export type GameOptions = { playerCount: number; mode: 'mining' | 'domination'; portraits?: CharacterId[]; driftingBases?: boolean };
export type GameRules = { mechanicsVersion?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14; driftingBases?: boolean; players: Faction[]; portraits?: CharacterId[]; mode: GameOptions['mode']; victoryTarget: number; map: MapGeometry & { generator: 'balanced.v1' | 'balanced.v2'; seed: number } };
export type PublicRules = Omit<GameRules, 'map'> & { map: Omit<GameRules['map'], 'seed'> };
export const DEFAULT_GAME_OPTIONS: GameOptions = { playerCount: 3, mode: 'mining', driftingBases: false };
export const OUTPOSTS_PER_PLAYER = 10;
export function validateOptions(value: unknown): GameOptions {
  const v = value as Partial<GameOptions> | null;
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(key => !['playerCount', 'mode', 'portraits', 'driftingBases'].includes(key)) || !Number.isSafeInteger(v.playerCount) || v.playerCount! < 2 || v.playerCount! > ALL_PLAYERS.length || !['mining', 'domination'].includes(v.mode!)) throw new Error('Choose 2–10 players and mining or domination.');
  if (v.driftingBases !== undefined && typeof v.driftingBases !== 'boolean') throw new Error('Choose whether asteroid bases drift.');
  if (v.portraits !== undefined && !validPortraits(v.portraits, v.playerCount!)) throw new Error('Choose a different known portrait for each player.');
  return { playerCount: v.playerCount!, mode: v.mode!, ...(v.driftingBases === undefined ? {} : { driftingBases: v.driftingBases }), ...(v.portraits === undefined ? {} : { portraits: [...v.portraits] }) };
}
export function publicRules(rules: GameRules): PublicRules { const { seed: _seed, ...map } = rules.map; return { ...rules, players: [...rules.players], ...(rules.portraits ? { portraits: [...rules.portraits] } : {}), map }; }
export function validateRules(value: unknown): GameRules {
  const r = value as GameRules;
  const keys = (v: object, allowed: string[]) => Object.keys(v).length === allowed.length && Object.keys(v).every(key => allowed.includes(key));
  if (!r || typeof r !== 'object' || Array.isArray(r) || !keys(r, ['players', 'mode', 'victoryTarget', 'map', ...(r.portraits === undefined ? [] : ['portraits']), ...(r.mechanicsVersion === undefined ? [] : ['mechanicsVersion']), ...(r.driftingBases === undefined ? [] : ['driftingBases'])]) || !(r.mechanicsVersion === undefined || [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].includes(r.mechanicsVersion)) || ((r.mechanicsVersion ?? 1) >= 7 ? typeof r.driftingBases !== 'boolean' : r.driftingBases !== undefined) || !Array.isArray(r.players) || r.players.length < 2 || r.players.length > ALL_PLAYERS.length || r.players[0] !== 'you' || new Set(r.players).size !== r.players.length || !r.players.every(f => ALL_PLAYERS.includes(f)) || r.portraits !== undefined && !validPortraits(r.portraits, r.players.length) || !['mining', 'domination'].includes(r.mode) || r.victoryTarget !== (r.mode === 'mining' ? 200 : r.players.length * OUTPOSTS_PER_PLAYER / 2)
    || !r.map || typeof r.map !== 'object' || !keys(r.map, r.map.generator === 'balanced.v2' ? ['generator', 'seed', 'width', 'height', 'topology'] : ['generator', 'seed', 'width', 'height']) || !['balanced.v1', 'balanced.v2'].includes(r.map.generator) || r.map.generator === 'balanced.v2' && r.map.topology !== 'torus' || !Number.isSafeInteger(r.map.seed) || r.map.seed < 0 || r.map.seed >= 2 ** 32 || ![r.map.width, r.map.height].every(n => Number.isFinite(n) && n > 0 && n <= 10_000)) throw new Error('Unsupported operation rules.');
  return { ...r, players: [...r.players], ...(r.portraits ? { portraits: [...r.portraits] } : {}), map: { ...r.map } };
}
export function victoryTarget(game: { version?: number; rules?: Pick<GameRules, 'victoryTarget'> }): number { return game.rules?.victoryTarget ?? (game.version === 1 ? 300 : 200); }
export function victoryProgress(game: { rules?: Pick<GameRules, 'mode'>; cargo: Partial<Record<Faction, number>>; rocks: readonly { owner?: Faction | null }[] }, owner: Faction): number {
  return game.rules?.mode === 'domination' ? game.rocks.filter(r => r.owner === owner).length : game.cargo[owner] ?? 0;
}

export function mechanicsVersion(game: { rules?: Pick<GameRules, 'mechanicsVersion'> }): 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 { return game.rules?.mechanicsVersion ?? 1; }
export function driftingBasesEnabled(game: { rules?: Pick<GameRules, 'mechanicsVersion' | 'driftingBases'> }): boolean { return game.rules?.driftingBases ?? game.rules?.mechanicsVersion === 6; }
