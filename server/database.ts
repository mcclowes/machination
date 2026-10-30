/**
 * ---
 * purpose: Validate stored multiplayer rooms and serialize atomic, rollback-safe database transactions.
 * related:
 *   - ./service.ts - game command orchestration
 * ---
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ALL_PLAYERS, playersIn } from '../src/game/players';
import type { Faction, Game } from '../src/game/simulation';
import { exportArchive, type ReplayData } from '../src/game/replay';
import { decodeReplay } from '../src/game/replay-save';
import { decodeSave } from '../src/game/save-format';
import { DIPLOMACY_LIMITS, type Group, type ChannelMessage, type Message } from '../src/contracts/protocol';
import { validateNotifications, type NotificationState } from './notification-state';
import { finished, validateFactions, type FactionProfile } from './factions';
import type { Allegiance } from '../src/game/factions';

type Diplomacy = { groups: (Group & { messages: ChannelMessage[] })[]; publicMessages: ChannelMessage[] };
export type Room = {
  variant?: 'faction';
  referenceKey?: string;
  id: string; invite: string; startedAt: number | null; revision: number; game: Game;
  seats: { profileId?: string; allegiance?: Allegiance; accountId?: string; faction: Faction; hash: string; revision?: number; lastActiveHour?: number; identityHash?: string; recoveryHash?: string; recoveryReceipt?: { secretHash: string; credentialHash: string } }[]; messages: Message[];
  receipts: Record<string, string>; diplomacy?: Diplomacy; replay?: ReplayData;
};
// Notification state is optional and created on first registration, so older files load unchanged.
export type Database = { version: 1; rooms: Room[]; factions?: FactionProfile[]; notifications?: NotificationState };
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export class DatabaseStore {
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(private file: string, private database: Database) {}

  static async open(file: string): Promise<DatabaseStore> {
    let database: Database = { version: 1, rooms: [] };
    try {
      database = JSON.parse(await readFile(file, 'utf8'));
      if (database.version !== 1 || !Array.isArray(database.rooms)) throw new Error('Unsupported server database.');
      const ids = new Set<string>();
      for (const r of database.rooms) {
        r.game = decodeSave(JSON.stringify({ savedAt: 0, game: r.game })).game;
        if (!/^[a-f0-9]{24}$/.test(r.id) || ids.has(r.id) || !/^[a-f0-9]{24}$/.test(r.invite)
          || !(r.startedAt === null || Number.isFinite(r.startedAt) && r.startedAt >= 0)
          || !Number.isSafeInteger(r.revision) || r.revision < 0 || !Array.isArray(r.seats) || r.seats.length < 1 || r.seats.length > playersIn(r.game).length || r.startedAt !== null && r.seats.length !== playersIn(r.game).length
          || !r.seats.every(s => playersIn(r.game).includes(s.faction) && /^[a-f0-9]{64}$/.test(s.hash))
          || new Set(r.seats.map(s => s.faction)).size !== r.seats.length || r.seats[0]?.faction !== 'you'
          || !Array.isArray(r.messages) || !r.receipts || typeof r.receipts !== 'object' || Array.isArray(r.receipts)
          || !r.messages.every(m => Number.isSafeInteger(m.id) && playersIn(r.game).includes(m.from) && playersIn(r.game).includes(m.to) && typeof m.text === 'string' && Number.isFinite(m.sentAt))) throw new Error('Damaged server database.');
        if (r.referenceKey !== undefined && !isHash(r.referenceKey)) throw new Error('Damaged object reference key.');
        for (const seat of r.seats) {
          if (seat.accountId !== undefined && (typeof seat.accountId !== 'string' || !/^user_[a-zA-Z0-9]+$/.test(seat.accountId))) throw new Error('Damaged account identity.');
          if (seat.lastActiveHour !== undefined && (r.startedAt === null || r.game.version !== 2 || !Number.isFinite(seat.lastActiveHour) || seat.lastActiveHour < 0 || seat.lastActiveHour > r.game.hour)
            || seat.identityHash !== undefined && !isHash(seat.identityHash)
            || seat.recoveryHash !== undefined && !isHash(seat.recoveryHash)
            || seat.recoveryReceipt !== undefined && (!seat.recoveryReceipt || !isHash(seat.recoveryReceipt.secretHash) || seat.recoveryReceipt.credentialHash !== seat.hash)) throw new Error('Damaged recovery metadata.');
          seat.revision ??= 0;
          if (!Number.isSafeInteger(seat.revision) || seat.revision < 0) throw new Error('Damaged seat revision.');
        }
        r.diplomacy ??= { groups: [], publicMessages: [] };
        const d = r.diplomacy;
        const validMessages = (messages: ChannelMessage[]) => Array.isArray(messages) && messages.length <= DIPLOMACY_LIMITS.messagesPerChannel
          && messages.every(m => m && typeof m.id === 'string' && /^[a-f0-9]{32}$/.test(m.id) && r.seats.some(s => s.faction === m.from)
            && typeof m.text === 'string' && m.text.trim().length > 0 && m.text.length <= DIPLOMACY_LIMITS.text && Number.isFinite(m.sentAt))
          && new Set(messages.map(m => m.id)).size === messages.length;
        if (!d || !Array.isArray(d.groups) || d.groups.length > ALL_PLAYERS.length * DIPLOMACY_LIMITS.groupsPerParticipant
          || !validMessages(d.publicMessages)
          || !d.groups.every(g => g && typeof g.id === 'string' && /^[a-f0-9]{32}$/.test(g.id)
            && typeof g.name === 'string' && g.name.trim().length > 0 && g.name.length <= DIPLOMACY_LIMITS.name
            && Array.isArray(g.members) && g.members.length >= 2 && g.members.length <= r.seats.length
            && new Set(g.members).size === g.members.length && g.members.every(f => r.seats.some(s => s.faction === f))
            && g.members.includes(g.createdBy) && Number.isFinite(g.createdAt) && validMessages(g.messages)
            && g.messages.every(m => g.members.includes(m.from)))
          || new Set(d.groups.map(g => g.id)).size !== d.groups.length
          || r.seats.some(s => d.groups.filter(g => g.members.includes(s.faction)).length > DIPLOMACY_LIMITS.groupsPerParticipant)) throw new Error('Damaged diplomacy metadata.');
        if (r.replay !== undefined) {
          if (r.startedAt === null) throw new Error('A lobby cannot contain operation history.');
          r.replay = exportArchive(decodeReplay(r.replay, r.game, false));
        }
        ids.add(r.id);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    validateNotifications(database);
    validateFactions(database);
    const accounts = database.rooms.filter(r => !finished(r)).flatMap(r => r.seats.flatMap(s => s.accountId ? [s.accountId] : []));
    if (new Set(accounts).size !== accounts.length) throw new Error('Duplicate account seats.');
    const store = new DatabaseStore(file, database);
    if (database.rooms.some(r => r.referenceKey === undefined)) {
      await store.transaction(db => {
        for (const room of db.rooms) room.referenceKey ??= randomBytes(32).toString('hex');
      });
    }
    return store;
  }
  /** Serialized with transactions, but never writes; the callback must not mutate the database. */
  read<T>(run: (db: Readonly<Database>) => T): Promise<T> {
    const result = this.queue.then(() => structuredClone(run(this.database)));
    this.queue = result.catch(() => undefined);
    return result;
  }
  transaction<T>(run: (db: Database) => T): Promise<T> {
    const result = this.queue.then(async () => {
      const next = structuredClone(this.database);
      const value = run(next);
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flush: true });
      await rename(temporary, this.file);
      this.database = next;
      return structuredClone(value);
    });
    this.queue = result.catch(() => undefined);
    return result;
  }
}
