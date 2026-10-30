/** @format */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { connectPostgres } from './postgres-client';
import { postgresPersistence, WriterReplacedError } from './postgres-store';
import { GameService } from './service';

const url = process.env.MACHINATION_TEST_DATABASE_TLS_URL;
const ca = process.env.MACHINATION_TEST_DATABASE_CA;
const plaintext = process.env.MACHINATION_TEST_DATABASE_URL;
const skip =
  !url &&
  'Set MACHINATION_TEST_DATABASE_TLS_URL and MACHINATION_TEST_DATABASE_CA to use a disposable TLS server.';

test(
  'verified Postgres accepts the provider CA and authenticates the endpoint',
  { skip },
  async (t) => {
    const endpoint = new URL(url!);
    endpoint.searchParams.set('sslmode', 'verify-full');
    const client = connectPostgres(endpoint.toString(), { ca });
    t.after(() => client.close());
    const rows = await client.query('select ssl from pg_stat_ssl where pid = pg_backend_pid()');
    assert.equal(rows[0]!.ssl, true);
  },
);

test('the TLS fixture rejects unencrypted sessions', { skip }, async (t) => {
  const client = connectPostgres(url!, { tls: 'local' });
  t.after(() => client.close());
  await assert.rejects(client.query('select 1'), { code: '28000' });
});

test('verified Postgres refuses a server outside the selected trust roots', { skip }, async (t) => {
  const client = connectPostgres(url!);
  t.after(() => client.close());
  await assert.rejects(client.query('select 1'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' });
});

test('verified Postgres refuses a certificate for a different hostname', { skip }, async (t) => {
  const mismatch = new URL(url!);
  mismatch.hostname = '127.0.0.1';
  const client = connectPostgres(mismatch.toString(), { ca });
  t.after(() => client.close());
  await assert.rejects(client.query('select 1'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
});

test(
  'verified Postgres refuses a plaintext database server',
  { skip: !plaintext && 'Set MACHINATION_TEST_DATABASE_URL to use a disposable plaintext server.' },
  async (t) => {
    const client = connectPostgres(plaintext!);
    t.after(() => client.close());
    await assert.rejects(client.query('select 1'), { code: 'ECONNRESET' });
  },
);

test(
  'verified Postgres preserves rollback, single-writer fencing, state, and retry history',
  { skip },
  async () => {
    const admin = connectPostgres(url!, { ca });
    const schema = `tls_${randomBytes(8).toString('hex')}`;
    let first: ReturnType<typeof connectPostgres> | undefined;
    let second: ReturnType<typeof connectPostgres> | undefined;
    try {
      await admin.query(`create schema "${schema}"`);
      const rollback = new Error('Rollback this transaction.');
      await assert.rejects(
        admin.transaction(async (tx) => {
          await tx.query(`create table "${schema}".rolled_back (value int)`);
          throw rollback;
        }),
        (error) => error === rollback,
      );
      assert.equal(
        (await admin.query('select to_regclass($1) as name', [`${schema}.rolled_back`]))[0]!.name,
        null,
      );
      const endpoint = new URL(url!);
      endpoint.searchParams.set('options', `-c search_path=${schema}`);
      first = connectPostgres(endpoint.toString(), { ca });
      second = connectPostgres(endpoint.toString(), { ca });
      const host = 'a'.repeat(64);
      const service = await GameService.open(postgresPersistence(first), () => 1000);
      const room = await service.create(host);
      await service.join(room.invite!, 'b'.repeat(64));
      const message = {
        requestId: 'tls-preserved-message',
        to: 'vesper' as const,
        text: 'Private over TLS.',
      };
      await service.message(room.id, host, message);
      const before = await service.snapshot(room.id, host);
      const restarted = await GameService.open(postgresPersistence(second), () => 1000);
      assert.deepEqual(await restarted.snapshot(room.id, host), before);
      await assert.rejects(service.create('c'.repeat(64)), WriterReplacedError);
      await restarted.message(room.id, host, message);
      assert.deepEqual(await restarted.snapshot(room.id, host), before);
    } finally {
      await Promise.all([first?.close(), second?.close()]);
      try {
        await admin.query(`drop schema if exists "${schema}" cascade`);
      } finally {
        await admin.close();
      }
    }
  },
);
