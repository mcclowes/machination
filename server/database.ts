/**
 * ---
 * purpose: Validate stored multiplayer rooms and serialize atomic, rollback-safe database transactions.
 * related:
 *   - ./service.ts - game command orchestration
 *   - ./database-recovery.ts - startup validation and recovery planning
 * ---
 *
 * @format
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open as openFile, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Faction, Game } from '../src/game/simulation';
import type { ReplayData } from '../src/game/replay';
import type { Group, ChannelMessage, Message } from '../src/contracts/protocol';
import type { NotificationState } from './notification-state';
import type { FactionProfile } from './factions';
import type { Allegiance } from '../src/game/factions';
import {
  decodeDatabaseSource,
  parseStoredDatabase,
  recoverStoredDatabase,
} from './database-recovery';
import type { QuarantinedOperation } from './operation-quarantine';

type Diplomacy = {
  groups: (Group & { messages: ChannelMessage[] })[];
  publicMessages: ChannelMessage[];
};
export type Room = {
  variant?: 'faction';
  referenceKey?: string;
  id: string;
  invite: string;
  startedAt: number | null;
  revision: number;
  /** Hash of the creator's credential and client request id, so creation retries return this room. */
  creationKey?: string;
  game: Game;
  seats: {
    profileId?: string;
    allegiance?: Allegiance;
    accountId?: string;
    faction: Faction;
    hash: string;
    revision?: number;
    lastActiveHour?: number;
    identityHash?: string;
    recoveryHash?: string;
    recoveryReceipt?: { secretHash: string; credentialHash: string };
  }[];
  messages: Message[];
  receipts: Record<string, string>;
  diplomacy?: Diplomacy;
  replay?: ReplayData;
};
// Notification state is optional and created on first registration, so older files load unchanged.
export type Database = {
  version: 1;
  rooms: Room[];
  factions?: FactionProfile[];
  notifications?: NotificationState;
  quarantined?: QuarantinedOperation[];
};
export type DatabaseRecoveryMode = 'strict' | 'quarantine';

/** Durable storage beneath the in-memory database; `load` resolves undefined when nothing is stored yet. */
export type Persistence = {
  load(): Promise<unknown>;
  save(next: Database): Promise<void>;
  quarantine?(next: Database, rejected: readonly number[]): Promise<void>;
};

async function syncDirectory(path: string): Promise<void> {
  const directory = await openFile(path, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export function filePersistence(file: string): Persistence {
  let loadedDigest: string | undefined;
  const digest = (source: string | Buffer) => createHash('sha256').update(source).digest('hex');
  const save = async (next: Database) => {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    const source = JSON.stringify(next);
    await writeFile(temporary, source, { mode: 0o600, flush: true });
    await rename(temporary, file);
    await syncDirectory(dirname(file));
    loadedDigest = digest(source);
  };
  return {
    async load() {
      try {
        const source = await readFile(file);
        loadedDigest = digest(source);
        return parseStoredDatabase(decodeDatabaseSource(source));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    save,
    async quarantine(next, rejected) {
      const source = await readFile(file);
      if (!loadedDigest || digest(source) !== loadedDigest)
        throw new Error('Database changed during recovery.');
      const root = `${file}.quarantine`;
      await mkdir(root, { recursive: true, mode: 0o700 });
      const archive = join(root, `${Date.now()}-${randomBytes(12).toString('hex')}`);
      await mkdir(archive, { mode: 0o700 });
      await writeFile(join(archive, 'database.json'), source, {
        mode: 0o600,
        flag: 'wx',
        flush: true,
      });
      await writeFile(
        join(archive, 'manifest.json'),
        JSON.stringify({ format: 'file.v1', sha256: loadedDigest, rejected }),
        { mode: 0o600, flag: 'wx', flush: true },
      );
      await syncDirectory(archive);
      await syncDirectory(root);
      await syncDirectory(dirname(file));
      await save(next);
    },
  };
}

export class DatabaseStore {
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(
    private persistence: Persistence,
    private database: Database,
  ) {}

  static async open(
    source: string | Persistence,
    options: { recovery?: DatabaseRecoveryMode } = {},
  ): Promise<DatabaseStore> {
    const persistence = typeof source === 'string' ? filePersistence(source) : source;
    const stored = await persistence.load();
    const { database, rejected } = recoverStoredDatabase(stored, options.recovery);
    const store = new DatabaseStore(persistence, database);
    if (rejected.length) {
      if (!persistence.quarantine)
        throw new Error('Storage cannot preserve quarantined operations.');
      for (const room of database.rooms) room.referenceKey ??= randomBytes(32).toString('hex');
      await persistence.quarantine(database, rejected);
    }
    if (database.rooms.some((r) => r.referenceKey === undefined)) {
      await store.transaction((db) => {
        for (const room of db.rooms) room.referenceKey ??= randomBytes(32).toString('hex');
      });
    }
    if (database.quarantined?.length)
      console.warn(`Quarantined operations require recovery: ${database.quarantined.length}.`);
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
