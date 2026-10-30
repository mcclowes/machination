/**
 * ---
 * purpose: Store each multiplayer room as its own Postgres row, fenced to one writing service instance.
 * related:
 *   - ./database.ts - validation and serialized transactions above this storage
 *   - ../docs/hosting.md - Supabase setup
 * ---
 */
import { randomBytes } from 'node:crypto';
import { DatabaseStore, filePersistence, type Database, type Persistence } from './database';

type Queryable = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> };
/** The minimal driver surface, so tests can run against in-process Postgres. */
export type SqlClient = Queryable & { transaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T> };
export type PostgresPersistence = Persistence & { hasData(): Promise<boolean> };

// Row-level security without policies keeps Supabase's public API away from game state.
const SCHEMA = [
  `create table if not exists machination_rooms (
    id text primary key,
    ordinal bigint generated always as identity,
    data json not null,
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists machination_state (key text primary key, data json not null)`,
  `alter table machination_rooms enable row level security`,
  `alter table machination_state enable row level security`,
];
const STATE_KEYS = ['version', 'factions', 'notifications'] as const;

export class WriterReplacedError extends Error {
  constructor() { super('Another service instance has taken over the game database.'); }
}

export function postgresPersistence(sql: SqlClient): PostgresPersistence {
  const writer = randomBytes(16).toString('hex');
  let prepared: Promise<void> | undefined;
  let claimed = false;
  // What the database holds, so each save writes only the rooms and state that changed.
  let rooms = new Map<string, string>();
  let state = new Map<string, string>();
  const prepare = () => (prepared ??= sql.transaction(async tx => { for (const statement of SCHEMA) await tx.query(statement); }));
  const claim = (tx: Queryable) => tx.query(
    `insert into machination_state (key, data) values ('writer', $1::text::json)
     on conflict (key) do update set data = excluded.data`, [JSON.stringify(writer)]);

  return {
    async hasData() {
      await prepare();
      return (await sql.query(`select 1 from machination_state where key = 'version'`)).length > 0;
    },
    async load() {
      await prepare();
      return sql.transaction(async tx => {
        await claim(tx);
        claimed = true;
        const stored = await tx.query<{ key: string; data: string }>(`select key, data::text as data from machination_state where key <> 'writer'`);
        if (!stored.some(row => row.key === 'version')) return undefined;
        // JSON travels as text, and columns are json rather than jsonb, so key order survives exactly.
        const roomRows = await tx.query<{ id: string; data: string }>(`select id, data::text as data from machination_rooms order by ordinal`);
        const database: Record<string, unknown> = { rooms: roomRows.map(row => JSON.parse(row.data)) };
        for (const row of stored) database[row.key] = JSON.parse(row.data);
        rooms = new Map(roomRows.map((row, i) => [row.id, JSON.stringify((database.rooms as unknown[])[i])]));
        state = new Map(stored.map(row => [row.key, JSON.stringify(database[row.key])]));
        return database;
      });
    },
    async save(next) {
      await prepare();
      const nextRooms = new Map(next.rooms.map(room => [room.id, JSON.stringify(room)]));
      const nextState = new Map(STATE_KEYS.flatMap(key => next[key] === undefined ? [] : [[key, JSON.stringify(next[key])] as const]));
      const changedRooms = [...nextRooms].filter(([id, json]) => rooms.get(id) !== json);
      const changedState = [...nextState].filter(([key, json]) => state.get(key) !== json);
      const removed = [...rooms.keys()].filter(id => !nextRooms.has(id));
      const cleared = STATE_KEYS.filter(key => state.has(key) && !nextState.has(key));
      if (claimed && !changedRooms.length && !changedState.length && !removed.length && !cleared.length) return;
      await sql.transaction(async tx => {
        if (claimed) {
          const [owner] = await tx.query<{ data: string }>(`select data::text as data from machination_state where key = 'writer' for update`);
          if (owner?.data !== JSON.stringify(writer)) throw new WriterReplacedError();
        } else {
          await claim(tx);
        }
        for (const [id, json] of changedRooms) {
          await tx.query(
            `insert into machination_rooms (id, data) values ($1, $2::text::json)
             on conflict (id) do update set data = excluded.data, updated_at = now()`, [id, json]);
        }
        if (removed.length) await tx.query(`delete from machination_rooms where id = any($1::text[])`, [removed]);
        for (const [key, json] of changedState) {
          await tx.query(
            `insert into machination_state (key, data) values ($1, $2::text::json)
             on conflict (key) do update set data = excluded.data`, [key, json]);
        }
        if (cleared.length) await tx.query(`delete from machination_state where key = any($1::text[])`, [cleared]);
      });
      claimed = true;
      rooms = nextRooms;
      state = new Map(nextState);
    },
  };
}

/** Copies a validated JSON snapshot into an empty database; returns false when there was nothing to import. */
export async function importDatabaseFile(file: string, target: PostgresPersistence): Promise<boolean> {
  if (await target.hasData() || await filePersistence(file).load() === undefined) return false;
  const source = await DatabaseStore.open(file);
  await target.save(await source.read(db => db));
  return true;
}
