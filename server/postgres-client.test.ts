import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameService } from './service';
import { connectPostgres } from './postgres-client';
import { postgresPersistence } from './postgres-store';

const url = process.env.MACHINATION_TEST_DATABASE_URL;

test('database URLs cannot silently weaken certificate verification', () => {
  for (const query of ['sslmode=require', 'sslmode=disable', 'sslmode=prefer', 'sslmode=verify-ca', 'sslmode=verify-full&sslmode=disable', 'ssl=false', 'sslrootcert=/private/ca.pem', 'sslcert=/private/client.pem']) {
    assert.throws(() => connectPostgres(`postgres://user:private-password@db.example.test/game?${query}`), /DATABASE_URL/);
  }
});

test('local plaintext is explicit and cannot target a hosted database', () => {
  for (const host of ['db.example.test', '127.0.0.1.example.test', '192.0.2.1']) {
    assert.throws(() => connectPostgres(`postgres://private:password@${host}/game`, { tls: 'local' }), /loopback/);
  }
  for (const tls of ['', 'false', 'require']) assert.throws(() => connectPostgres('postgres://localhost/game', { tls }), /MACHINATION_DATABASE_TLS/);
  assert.throws(() => connectPostgres('postgres://localhost/game', { tls: 'local', ca: 'ignored CA' }), /MACHINATION_DATABASE_CA/);
});

test('invalid database configuration fails without disclosing connection credentials', () => {
  for (const url of ['http://private:password@localhost/game', 'postgres:///game', 'postgres://private:password@one,two/game', 'postgres://private:password@%2ftmp/game', 'postgres://private:password@localhost:99999/game']) {
    assert.throws(() => connectPostgres(url), error => error instanceof Error && /DATABASE_URL/.test(error.message) && !/private|password/.test(error.message));
  }
  assert.throws(() => connectPostgres('postgres://private:password@db.example.test/game', { ca: '/private/password.pem' }), error => error instanceof Error && /MACHINATION_DATABASE_CA/.test(error.message) && !/password/.test(error.message));
});

test('operations survive a restart against a real Postgres server', { skip: !url && 'Set MACHINATION_TEST_DATABASE_URL to run.' }, async t => {
  const sql = connectPostgres(url!, { tls: 'local' });
  t.after(() => sql.close());
  await sql.query('drop table if exists machination_rooms, machination_state');
  const host = 'a'.repeat(64);
  const service = await GameService.open(postgresPersistence(sql), () => 1000);
  const room = await service.create(host);
  await service.join(room.invite!, 'b'.repeat(64));
  await service.message(room.id, host, { requestId: 'real-postgres-message', to: 'vesper', text: 'Echo' });
  const before = await service.snapshot(room.id, host);
  const restarted = await GameService.open(postgresPersistence(sql), () => 1000);
  assert.deepEqual(await restarted.snapshot(room.id, host), before);
});
