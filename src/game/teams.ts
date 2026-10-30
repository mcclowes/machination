/**
 * ---
 * purpose: Validate fixed team membership and resolve allies without delegating seat command authority.
 * ---
 */
import type { Faction } from './players';
export type TeamFormat = '2v2' | '3v3v3' | '4v4';
export type TeamProfile = { profile: 'teams.preview.v1'; casual: true; format: TeamFormat; members: Faction[][] };
export type TeamWorld = { rules?: { teams?: TeamProfile } };
export function createTeams(format: TeamFormat, players: readonly Faction[]): TeamProfile {
  const size = format === '2v2' ? 2 : format === '3v3v3' ? 3 : 4;
  if (players.length !== (format === '2v2' ? 4 : format === '3v3v3' ? 9 : 8)) throw new Error('Choose the matching number of seats for this team format.');
  return { profile: 'teams.preview.v1', casual: true, format, members: Array.from({ length: players.length / size }, (_, i) => players.slice(i * size, (i + 1) * size)) };
}
export function validateTeams(value: unknown, players: readonly Faction[]): TeamProfile {
  const t = value as TeamProfile;
  if (!t || typeof t !== 'object' || Array.isArray(t) || Object.keys(t).sort().join() !== 'casual,format,members,profile' || t.profile !== 'teams.preview.v1' || t.casual !== true || !['2v2', '3v3v3', '4v4'].includes(t.format)) throw new Error('Unsupported team profile.');
  const expected = createTeams(t.format, players);
  if (JSON.stringify(t.members) !== JSON.stringify(expected.members)) throw new Error('Team membership must match immutable seat groups.');
  return expected;
}
export function teamMembers(game: TeamWorld, owner: Faction): readonly Faction[] {
  return game.rules?.teams?.members.find(members => members.includes(owner)) ?? [owner];
}
export function allied(game: TeamWorld, a: Faction, b: Faction): boolean { return teamMembers(game, a).includes(b); }
export function teamNumber(game: TeamWorld, owner: Faction): number | undefined {
  const index = game.rules?.teams?.members.findIndex(members => members.includes(owner));
  return index === undefined || index < 0 ? undefined : index + 1;
}
