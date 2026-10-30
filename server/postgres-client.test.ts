import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameService } from './service';
import { connectPostgres } from './postgres-client';
import { postgresPersistence } from './postgres-store';

const url = process.env.MACHINATION_TEST_DATABASE_URL;

test('operations survive a restart against a real Postgres server', { skip: !url && 'Set MACHINATION_TEST_DATABASE_URL to run.' }, async t => {
  const sql = connectPostgres(url!);
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
