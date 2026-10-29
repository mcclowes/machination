import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Failure, GameService } from './service';

test('preference validation distinguishes an omitted token from an explicitly invalid token before authorizing', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-preferences-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'games.json');
  const service = await GameService.open(file, () => 1000, undefined, { notifications: true });
  const credential = randomBytes(32).toString('hex');
  const room = await service.create(credential);
  const deviceId = randomBytes(32).toString('hex');
  const request = { requestId: randomUUID(), deviceId, revision: 0, enabled: true, expoPushToken: 'ExpoPushToken[preferences]' };
  const initial = await service.setNotifications(room.id, credential, request);
  const before = await readFile(file, 'utf8');
  const invalid = (error: unknown) => error instanceof Failure && error.status === 400 && error.code === 'notification.validation.payload';
  for (const version of [1, 2] as const) {
    const base = { requestId: randomUUID(), deviceId, revision: initial.revision, ...(version === 2 ? { incoming: false } : {}) };
    for (const enabled of [false, true]) {
      for (const expoPushToken of [undefined, null, '', 'invalid', 42]) {
        const input = { ...base, enabled, expoPushToken };
        await assert.rejects(service.setNotifications(room.id, credential, input, version), invalid);
        await assert.rejects(service.setNotifications('missing', 'invalid', input, version), invalid);
      }
    }
  }
  assert.equal(await readFile(file, 'utf8'), before, 'invalid input writes no metadata or receipts');
  const flagOnly = { requestId: randomUUID(), deviceId, revision: initial.revision, enabled: true, incoming: true };
  const enabled = await service.setNotifications(room.id, credential, flagOnly, 2);
  assert.equal(enabled.bindingId, initial.bindingId);
  assert.equal(enabled.incoming, true);
  assert.equal(enabled.revision, initial.revision + 1);
});

test('a failed preference write rolls back binding and request state, allowing the identical retry', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-preferences-'));
  t.after(async () => { await chmod(dir, 0o700); await rm(dir, { recursive: true, force: true }); });
  const file = join(dir, 'games.json');
  const service = await GameService.open(file, () => 1000, undefined, { notifications: true });
  const credential = randomBytes(32).toString('hex');
  const room = await service.create(credential);
  const request = { requestId: randomUUID(), deviceId: randomBytes(32).toString('hex'), revision: 0, enabled: true, incoming: true, expoPushToken: 'ExpoPushToken[rollback]' };
  const before = await readFile(file, 'utf8');
  await chmod(dir, 0o500);
  await assert.rejects(service.setNotifications(room.id, credential, request, 2));
  assert.equal(await readFile(file, 'utf8'), before);
  await chmod(dir, 0o700);
  assert.deepEqual(await service.notificationSettings(room.id, credential, request.deviceId, 2), {
    gameId: room.id, deviceId: request.deviceId, revision: 0, available: true, enabled: false, incoming: false,
  });
  const accepted = await service.setNotifications(room.id, credential, request, 2);
  assert.equal(accepted.revision, 1);
  assert.equal(accepted.incoming, true);
  assert.deepEqual(await service.setNotifications(room.id, credential, request, 2), accepted);
  const reopened = await GameService.open(file, () => 1000, undefined, { notifications: true });
  assert.deepEqual(await reopened.notificationSettings(room.id, credential, request.deviceId, 2), accepted);
});
