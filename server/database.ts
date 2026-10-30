/**
 * ---
 * purpose: Validate stored multiplayer rooms and serialize atomic, rollback-safe database transactions.
 * related:
 *   - ./service.ts - game command orchestration
 *   - ./room-validation.ts - stored room validation and compatibility defaults
 * ---
 */
import { randomBytes } from 'node:crypto';
import { mkdir, open as openFile, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Faction, Game } from '../src/game/simulation';
import type { ReplayData } from '../src/game/replay';
import type { Group, ChannelMessage, Message } from '../src/contracts/protocol';
import { validateNotifications, type NotificationState } from './notification-state';
import { finished, validateFactions, type FactionProfile } from './factions';
import type { Allegiance } from '../src/game/factions';
import { validateStoredRoom } from './room-validation';

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

/** Durable storage beneath the in-memory database; `load` resolves undefined when nothing is stored yet. */
export type Persistence = {
  load(): Promise<unknown>;
  save(next: Database): Promise<void>;
};

export function filePersistence(file: string): Persistence {
  return {
    async load() {
      try { return JSON.parse(await readFile(file, 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    },
    async save(next) {
      await mkdir(dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flush: true });
      await rename(temporary, file);
      // Without a directory fsync, a power loss can forget the rename.
      const directory = await openFile(dirname(file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    },
  };
}

export class DatabaseStore {
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(private persistence: Persistence, private database: Database) {}

  static async open(source: string | Persistence): Promise<DatabaseStore> {
    const persistence = typeof source === 'string' ? filePersistence(source) : source;
    const stored = await persistence.load();
    const database = (stored ?? { version: 1, rooms: [] }) as Database;
    if (stored !== undefined) {
      if (database.version !== 1 || !Array.isArray(database.rooms)) throw new Error('Unsupported server database.');
      const ids = new Set<string>();
      for (const r of database.rooms) {
        validateStoredRoom(r, ids);
        ids.add(r.id);
      }
    }
    validateNotifications(database);
    validateFactions(database);
    const accounts = database.rooms.filter(r => !finished(r)).flatMap(r => r.seats.flatMap(s => s.accountId ? [s.accountId] : []));
    if (new Set(accounts).size !== accounts.length) throw new Error('Duplicate account seats.');
    const store = new DatabaseStore(persistence, database);
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
      await this.persistence.save(next);
      this.database = next;
      return structuredClone(value);
    });
    this.queue = result.catch(() => undefined);
    return result;
  }
}
