/**
 * ---
 * purpose: Verify Postgres transport and move an existing JSON snapshot into it on first boot.
 * related:
 *   - ./postgres-store.ts - room storage and writer fencing
 * ---
 *
 * @format
 */
import postgres from 'postgres';
import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import {
  importDatabaseFile,
  postgresPersistence,
  type PostgresPersistence,
  type SqlClient,
} from './postgres-store';
import type { DatabaseRecoveryMode } from './database';

export type PostgresConnectionConfig = { tls?: string; ca?: string };

function postgresTransport(url: string, config: PostgresConnectionConfig) {
  let endpoint: URL;
  try {
    endpoint = new URL(url);
    decodeURIComponent(endpoint.username);
    decodeURIComponent(endpoint.password);
  } catch {
    throw new Error('DATABASE_URL must be a Postgres connection URL.');
  }
  const hostname = endpoint.hostname.replace(/^\[|\]$/g, '');
  if (
    !['postgres:', 'postgresql:'].includes(endpoint.protocol) ||
    !hostname ||
    hostname.length > 253 ||
    (!isIP(hostname) &&
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.?$/i.test(
        hostname,
      )) ||
    (endpoint.port && (Number(endpoint.port) < 1 || Number(endpoint.port) > 65535))
  ) {
    throw new Error('DATABASE_URL must identify one Postgres TCP endpoint and a valid port.');
  }
  const local = config.tls === 'local';
  if (config.tls !== undefined && config.tls !== 'verify-full' && !local)
    throw new Error('MACHINATION_DATABASE_TLS must be verify-full or local.');
  if (local && !['localhost', '127.0.0.1', '::1'].includes(hostname))
    throw new Error('MACHINATION_DATABASE_TLS=local requires a loopback DATABASE_URL.');
  if (local && config.ca?.trim())
    throw new Error('MACHINATION_DATABASE_CA cannot be combined with local plaintext mode.');
  const ca = config.ca?.trim();
  if (ca) {
    const pem = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
    const certificates = ca.match(pem);
    try {
      if (!certificates?.length || ca.replace(pem, '').trim()) throw new Error();
      for (const certificate of certificates) new X509Certificate(certificate);
    } catch {
      throw new Error('MACHINATION_DATABASE_CA must contain PEM certificates, not a file path.');
    }
  }
  for (const key of [...endpoint.searchParams.keys()]) {
    if (!key.toLowerCase().startsWith('ssl')) continue;
    const values = endpoint.searchParams.getAll(key);
    const allowed =
      values.length === 1 &&
      ((key === 'sslmode' && values[0] === (local ? 'disable' : 'verify-full')) ||
        (!local && !ca && key === 'sslrootcert' && values[0] === 'system'));
    if (!allowed)
      throw new Error(
        'DATABASE_URL TLS settings must use verify-full; use MACHINATION_DATABASE_CA for a custom CA. Only explicit local mode accepts sslmode=disable.',
      );
    endpoint.searchParams.delete(key);
  }
  // The driver supports paired address arrays, but its public Options narrows them to scalars.
  const address = {
    host: [local && hostname === 'localhost' ? '127.0.0.1' : hostname],
    port: [Number(endpoint.port || 5432)],
  } as unknown as Pick<postgres.Options<{}>, 'host' | 'port'>;
  return {
    url: endpoint.toString(),
    ...address,
    ssl: local
      ? false
      : {
          rejectUnauthorized: true,
          ...(ca ? { ca } : {}),
          checkServerIdentity: (
            _: string,
            certificate: Parameters<typeof checkServerIdentity>[1],
          ) => checkServerIdentity(hostname, certificate),
        },
  };
}

/** `prepare: false` keeps the client compatible with Supabase's session and transaction poolers. */
export function connectPostgres(
  url: string,
  config: PostgresConnectionConfig = {},
): SqlClient & { close(graceMs?: number): Promise<void> } {
  const { url: connectionUrl, ...transport } = postgresTransport(url, config);
  const sql = postgres(connectionUrl, { ...transport, max: 4, prepare: false, onnotice: () => {} });
  const unsafe =
    (run: postgres.Sql | postgres.TransactionSql) =>
    (text: string, params: unknown[] = []) =>
      run.unsafe(text, params as postgres.ParameterOrJSON<never>[]) as Promise<never>;
  return {
    query: unsafe(sql),
    transaction: (run) => sql.begin((tx) => run({ query: unsafe(tx) })) as Promise<never>,
    close: (graceMs = 5_000) => sql.end({ timeout: Math.max(0, graceMs / 1000) }),
  };
}

export type ManagedPostgresPersistence = PostgresPersistence & {
  close(graceMs?: number): Promise<void>;
};

export async function openPostgres(
  url: string,
  legacyFile: string,
  config: PostgresConnectionConfig = {},
  recovery: DatabaseRecoveryMode = 'strict',
): Promise<ManagedPostgresPersistence> {
  const client = connectPostgres(url, config);
  const persistence = postgresPersistence(client);
  try {
    if (await importDatabaseFile(legacyFile, persistence, recovery))
      console.log('Imported the JSON game snapshot into Postgres.');
    return { ...persistence, close: (graceMs) => client.close(graceMs) };
  } catch (error) {
    await client.close();
    throw error;
  }
}
