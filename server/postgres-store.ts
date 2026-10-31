/**
 * ---
 * purpose: Store each multiplayer room as its own Postgres row, fenced to one writing service instance.
 * related:
 *   - ./database.ts - validation and serialized transactions above this storage
 *   - ./database-recovery.ts - startup validation and recovery plans
 *   - ../docs/postgres.md - Supabase setup
 * ---
 *
 * @format
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { serializedReportState } from './report-source';
import type { Database, DatabaseRecoveryMode, Persistence } from './database';
import {
  decodeDatabaseSource,
  parseStoredDatabase,
  recoverStoredDatabase,
} from './database-recovery';

type Queryable = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};
/** The minimal driver surface, so tests can run against in-process Postgres. */
export type SqlClient = Queryable & {
  transaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T>;
};
export type PostgresPersistence = Persistence & {
  hasData(): Promise<boolean>;
  importSnapshot(next: Database, source: string, rejected: readonly number[]): Promise<boolean>;
};

// Row-level security without policies keeps Supabase's public API away from game state.
const SCHEMA = [
  `create table if not exists machination_rooms (
    id text primary key,
    ordinal bigint generated always as identity,
    data json not null,
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists machination_state (key text primary key, data json not null)`,
  `create table if not exists machination_quarantine (id text primary key, data json not null, created_at timestamptz not null default now())`,
  `alter table machination_rooms enable row level security`,
  `alter table machination_state enable row level security`,
  `alter table machination_quarantine enable row level security`,
];
const STATE_KEYS = [
  'version',
  'factions',
  'notifications',
  'quarantined',
  'messageReports',
] as const;

export class WriterReplacedError extends Error {
  constructor() {
    super('Another service instance has taken over the game database.');
  }
}

async function hasStoredDatabase(sql: Queryable): Promise<boolean> {
  const keys = await sql.query<{ key: string }>(
    "select key from machination_state where key <> 'writer'",
  );
  if (keys.some((row) => row.key === 'version')) return true;
  if (
    keys.length ||
    (await sql.query('select 1 from machination_rooms limit 1')).length ||
    (await sql.query('select 1 from machination_quarantine limit 1')).length
  )
    throw new Error('Damaged Postgres database metadata.');
  return false;
}

export function postgresPersistence(sql: SqlClient): PostgresPersistence {
  const writer = randomBytes(16).toString('hex');
  let prepared: Promise<void> | undefined;
  let claimed = false;
  // What the database holds, so each save writes only the rooms and state that changed.
  let rooms = new Map<string, string>();
  let state = new Map<string, string>();
  const prepare = () =>
    (prepared ??= sql.transaction(async (tx) => {
      for (const statement of SCHEMA) await tx.query(statement);
    }));
  const claim = (tx: Queryable) =>
    tx.query(
      `insert into machination_state (key, data) values ('writer', $1::text::json)
     on conflict (key) do update set data = excluded.data`,
      [JSON.stringify(writer)],
    );

  const commit = async (
    next: Database,
    rejected: readonly number[] = [],
    importing?: { source: string; rejected: readonly number[] },
  ): Promise<boolean> => {
    await prepare();
    const originalIds = [...rooms.keys()];
    if (
      rejected.length &&
      (!claimed ||
        rejected.some(
          (index) => !Number.isSafeInteger(index) || index < 0 || index >= originalIds.length,
        ))
    )
      throw new Error('Recovery requires a loaded database snapshot.');
    const quarantinedIds = new Set(rejected.map((index) => originalIds[index]!));
    const nextRooms = new Map(next.rooms.map((room) => [room.id, JSON.stringify(room)]));
    if ([...quarantinedIds].some((id) => nextRooms.has(id)))
      throw new Error('Quarantined operations cannot remain active.');
    const nextState = new Map(
      STATE_KEYS.flatMap((key) =>
        next[key] === undefined ? [] : [[key, JSON.stringify(next[key])] as const],
      ),
    );
    const changedRooms = [...nextRooms].filter(([id, json]) => rooms.get(id) !== json);
    const changedState = [...nextState].filter(([key, json]) => state.get(key) !== json);
    const removed = [...rooms.keys()].filter((id) => !nextRooms.has(id));
    const cleared = STATE_KEYS.filter((key) => state.has(key) && !nextState.has(key));
    if (
      claimed &&
      !changedRooms.length &&
      !changedState.length &&
      !removed.length &&
      !cleared.length &&
      !rejected.length &&
      !importing
    )
      return false;
    const alreadyStored = importing ? new Error('Database is already initialized.') : undefined;
    try {
      await sql.transaction(async (tx) => {
        if (claimed) {
          const [owner] = await tx.query<{ data: string }>(
            `select data::text as data from machination_state where key = 'writer' for update`,
          );
          if (owner?.data !== JSON.stringify(writer)) throw new WriterReplacedError();
        } else {
          await claim(tx);
          if (!importing && (await hasStoredDatabase(tx)))
            throw new Error('Load the existing database before saving.');
        }
        if (importing && (await hasStoredDatabase(tx))) throw alreadyStored;
        if (importing) {
          await tx.query(
            'insert into machination_quarantine (id, data) values ($1, $2::text::json)',
            [
              randomBytes(12).toString('hex'),
              JSON.stringify({ format: 'json-import.v1', ...importing }),
            ],
          );
        } else if (rejected.length) {
          const originalRooms = await tx.query<{ id: string; data: string }>(
            'select id, data::text as data from machination_rooms order by ordinal',
          );
          const originalState = await tx.query<{ key: string; data: string }>(
            "select key, data::text as data from machination_state where key <> 'writer' order by key",
          );
          if (
            originalRooms.length !== rooms.size ||
            originalRooms.some(
              (row) => JSON.stringify(JSON.parse(row.data)) !== rooms.get(row.id),
            ) ||
            originalState.length !== state.size ||
            originalState.some((row) => JSON.stringify(JSON.parse(row.data)) !== state.get(row.key))
          )
            throw new Error('Database changed during recovery.');
          const archive = {
            format: 'postgres.v1',
            rooms: originalRooms.filter((row) => quarantinedIds.has(row.id)),
            state: originalState,
            rejected,
          };
          await tx.query(
            'insert into machination_quarantine (id, data) values ($1, $2::text::json)',
            [randomBytes(12).toString('hex'), JSON.stringify(archive)],
          );
        }
        for (const [id, json] of changedRooms) {
          await tx.query(
            `insert into machination_rooms (id, data) values ($1, $2::text::json)
           on conflict (id) do update set data = excluded.data, updated_at = now()`,
            [id, json],
          );
        }
        if (removed.length)
          await tx.query(`delete from machination_rooms where id = any($1::text[])`, [removed]);
        for (const [key, json] of changedState) {
          await tx.query(
            `insert into machination_state (key, data) values ($1, $2::text::json)
           on conflict (key) do update set data = excluded.data`,
            [key, json],
          );
        }
        if (cleared.length)
          await tx.query(`delete from machination_state where key = any($1::text[])`, [cleared]);
      });
    } catch (error) {
      if (importing && error === alreadyStored) return false;
      throw error;
    }
    claimed = true;
    rooms = nextRooms;
    state = new Map(nextState);
    return true;
  };

  return {
    async hasData() {
      await prepare();
      return hasStoredDatabase(sql);
    },
    async load() {
      await prepare();
      return sql.transaction(async (tx) => {
        await claim(tx);
        claimed = true;
        if (!(await hasStoredDatabase(tx))) return undefined;
        const stored = await tx.query<{ key: string; data: string }>(
          `select key, data::text as data from machination_state where key <> 'writer'`,
        );
        // JSON travels as text, and columns are json rather than jsonb, so key order survives exactly.
        const roomRows = await tx.query<{ id: string; data: string }>(
          `select id, data::text as data from machination_rooms order by ordinal`,
        );
        const database: Record<string, unknown> = {
          rooms: roomRows.map((row) => JSON.parse(row.data)),
        };
        for (const row of stored)
          database[row.key] =
            row.key === 'messageReports' ? serializedReportState(row.data) : JSON.parse(row.data);
        rooms = new Map(
          roomRows.map((row, i) => [row.id, JSON.stringify((database.rooms as unknown[])[i])]),
        );
        state = new Map(stored.map((row) => [row.key, JSON.stringify(database[row.key])]));
        return database;
      });
    },
    save: async (next) => {
      await commit(next);
    },
    quarantine: async (next, rejected) => {
      await commit(next, rejected);
    },
    importSnapshot: (next, source, rejected) => commit(next, [], { source, rejected }),
  };
}

/** Copies a validated JSON snapshot into an empty database; returns false when there was nothing to import. */
export async function importDatabaseFile(
  file: string,
  target: PostgresPersistence,
  recovery: DatabaseRecoveryMode = 'strict',
): Promise<boolean> {
  if (await target.hasData()) return false;
  let source: string;
  try {
    source = decodeDatabaseSource(await readFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  const { database, rejected } = recoverStoredDatabase(parseStoredDatabase(source), recovery);
  for (const room of database.rooms) room.referenceKey ??= randomBytes(32).toString('hex');
  return target.importSnapshot(database, source, rejected);
}
