import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { GameService } from './service';
import type { GameOptions } from '../src/game/rules';

test('multiplayer portrait choices are shared, immutable on retries, and durable through restart and history', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-portraits-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'game.json');
  const host = randomBytes(32).toString('hex'), guest = randomBytes(32).toString('hex');
  let service = await GameService.open(file, () => 0);
  const options: GameOptions = { playerCount: 2, mode: 'mining', portraits: ['wraith', 'envoy'] };
  const created = await service.create(host, options);
  assert.deepEqual(created.game.rules!.portraits, options.portraits);
  const joined = await service.join(created.invite, guest);
  assert.deepEqual(joined.game.rules!.portraits, ['wraith', 'envoy']);
  assert.deepEqual((await service.create(host, options)).game.rules!.portraits, ['wraith', 'envoy']);
  await assert.rejects(() => service.create(host, { ...options, portraits: ['ace', 'envoy'] }), /different settings/);
  options.portraits![0] = 'ace';
  joined.game.rules!.portraits![0] = 'ace';
  await service.start(created.id, host);
  service = await GameService.open(file, () => 0);
  assert.deepEqual((await service.snapshot(created.id, guest)).game.rules!.portraits, ['wraith', 'envoy']);
  assert.deepEqual((await service.history(created.id, guest, 0)).game.rules!.portraits, ['wraith', 'envoy']);
});
