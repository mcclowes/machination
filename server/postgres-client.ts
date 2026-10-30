/**
 * ---
 * purpose: Connect the Postgres store to a real server and move an existing JSON snapshot into it on first boot.
 * related:
 *   - ./postgres-store.ts - room storage and writer fencing
 * ---
 */
import postgres from 'postgres';
import { importDatabaseFile, postgresPersistence, type PostgresPersistence, type SqlClient } from './postgres-store';

/** `prepare: false` keeps the client compatible with Supabase's session and transaction poolers. */
export function connectPostgres(url: string): SqlClient & { close(): Promise<void> } {
  const sql = postgres(url, { max: 4, prepare: false, onnotice: () => {} });
  const unsafe = (run: postgres.Sql | postgres.TransactionSql) => (text: string, params: unknown[] = []) =>
    run.unsafe(text, params as postgres.ParameterOrJSON<never>[]) as Promise<never>;
  return {
    query: unsafe(sql),
    transaction: run => sql.begin(tx => run({ query: unsafe(tx) })) as Promise<never>,
    close: () => sql.end({ timeout: 5 }),
  };
}

export async function openPostgres(url: string, legacyFile: string): Promise<PostgresPersistence> {
  const persistence = postgresPersistence(connectPostgres(url));
  if (await importDatabaseFile(legacyFile, persistence)) console.log('Imported the JSON game snapshot into Postgres.');
  return persistence;
}
