/**
 * ---
 * purpose: Persistent faction progression and standings derived from authoritative completed operations.
 * ---
 */
import { createHash } from 'node:crypto';
import { ALLEGIANCE_IDS, isAllegiance, type Allegiance, type FactionStandings } from '../src/game/factions';
import type { Database, Room } from './database';

export type FactionProfile = { id: string; faction: Allegiance };
export const finished = (room: Room) => room.startedAt !== null && !!(room.game.winner || room.game.draw);
export const accountProfileId = (accountId: string) => createHash('sha256').update(`clerk:${accountId}`).digest('hex');
export const profileId = (seat: Room['seats'][number]) => seat.profileId ?? (seat.accountId ? accountProfileId(seat.accountId) : seat.identityHash ?? seat.hash);
export function factionStandings(db: Database, identity: string): FactionStandings {
  const faction = db.factions?.find(p => p.id === identity)?.faction;
  const leaderboard = ALLEGIANCE_IDS.map(faction => ({ faction, wins: db.rooms.filter(room => finished(room) && room.variant === 'faction'
    && room.seats.some(seat => seat.faction === room.game.winner && seat.allegiance === faction)).length }));
  leaderboard.sort((a, b) => b.wins - a.wins || ALLEGIANCE_IDS.indexOf(a.faction) - ALLEGIANCE_IDS.indexOf(b.faction));
  return { completedGames: db.rooms.filter(room => finished(room) && room.seats.some(seat => profileId(seat) === identity)).length,
    ...(faction ? { faction } : {}), leaderboard };
}
export function validateFactions(db: Database): void {
  const identity = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (db.factions !== undefined && (!Array.isArray(db.factions) || !db.factions.every(p => p && identity(p.id) && isAllegiance(p.faction))
    || new Set(db.factions.map(p => p.id)).size !== db.factions.length)) throw new Error('Damaged faction profiles.');
  for (const room of db.rooms) {
    if (room.variant !== undefined && room.variant !== 'faction'
      || room.seats.some(seat => seat.profileId !== undefined && !identity(seat.profileId)
        || seat.allegiance !== undefined && !isAllegiance(seat.allegiance)
        || seat.allegiance !== undefined && !db.factions?.some(p => p.id === profileId(seat) && p.faction === seat.allegiance)
        || (room.variant === 'faction') !== (seat.allegiance !== undefined))) throw new Error('Damaged faction membership.');
  }
}
