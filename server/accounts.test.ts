import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameService } from './service';

test('an account restores its seat across sessions and server restarts without exposing seat credentials', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-account-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'games.json');
  let service = await GameService.open(file);
  const account = { accountId: 'user_alice' };
  assert.equal(await service.accountSession(account), null);
  const created = await service.create(account);
  assert.equal((await service.accountSession(account))?.id, created.id);
  assert.equal((await service.create(account)).id, created.id, 'creation retries reuse the account seat');
  service = await GameService.open(file);
  assert.equal((await service.accountSession(account))?.faction, created.faction);
  assert.equal(await service.accountSession({ accountId: 'user_bob' }), null);
  await assert.rejects(service.snapshot(created.id, { accountId: 'user_bob' }), { status: 401 });
});

test('linking requires the device token, is retryable, and revokes device and recovery access', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-link-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const service = await GameService.open(join(directory, 'games.json'));
  const token = 'a'.repeat(64); const secret = 'b'.repeat(64);
  const account = { accountId: 'user_alice' };
  const created = await service.create(token);
  await service.setRecovery(created.id, token, { requestId: 'setup-recovery-0001', secret });
  await assert.rejects(service.linkAccount(created.id, 'c'.repeat(64), account), { status: 401 });
  const linked = await service.linkAccount(created.id, token, account);
  assert.equal(linked.faction, created.faction);
  assert.equal((await service.linkAccount(created.id, token, account)).id, created.id);
  assert.equal((await service.accountSession(account))?.id, created.id);
  await assert.rejects(service.snapshot(created.id, token), { status: 401 });
  await assert.rejects(service.linkAccount(created.id, token, { accountId: 'user_bob' }), { status: 409 });
  await assert.rejects(service.recover(created.id, 'd'.repeat(64), { secret }), { status: 401 });
  const another = await service.create('e'.repeat(64));
  assert.equal((await service.linkAccount(another.id, 'e'.repeat(64), account)).id, another.id, 'an account may link seats in several operations');
  assert.deepEqual((await service.accountOperations(account)).map(o => o.id), [another.id, created.id]);
});

test('an account runs several operations at once, with retry-safe creation and a bounded count', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-account-many-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'games.json');
  let service = await GameService.open(file);
  const account = { accountId: 'user_alice' };
  const first = await service.create(account, { playerCount: 3, mode: 'mining' }, undefined, undefined, 'create-request-0001');
  assert.equal((await service.create(account, { playerCount: 3, mode: 'mining' }, undefined, undefined, 'create-request-0001')).id, first.id, 'a retried request returns its operation');
  const second = await service.create(account, undefined, undefined, undefined, 'create-request-0002');
  assert.notEqual(second.id, first.id);
  const hosted = await service.create({ accountId: 'user_host' });
  const joined = await service.join(hosted.invite!, account);
  service = await GameService.open(file);
  const listed = await service.accountOperations(account);
  assert.deepEqual(listed.map(o => o.id), [hosted.id, second.id, first.id]);
  assert.deepEqual(listed.at(-1), { id: first.id, faction: first.faction, mode: 'mining', players: 3, seated: 1, started: false, hour: 0, status: 'active' });
  assert.equal(listed[0]!.faction, joined.faction);
  assert.equal((await service.accountSession(account))?.id, hosted.id, 'the legacy restore keeps returning the newest operation');
  for (let i = 4; i <= 10; i++) await service.create(account, undefined, undefined, undefined, `create-request-${String(i).padStart(4, '0')}`);
  await assert.rejects(service.create(account, undefined, undefined, undefined, 'create-request-0011'), { status: 409, code: 'account.capacity.operations' });
  await assert.rejects(service.join((await service.create({ accountId: 'user_other' })).invite!, account), { status: 409, code: 'account.capacity.operations' });
  await assert.rejects(service.create(account, undefined, undefined, undefined, 'bad'), { status: 400 });
});

test('account seats join invitations idempotently and retain ordinary seat permissions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-account-join-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const service = await GameService.open(join(directory, 'games.json'));
  const host = { accountId: 'user_host' }; const guest = { accountId: 'user_guest' };
  const created = await service.create(host);
  const joined = await service.join(created.invite!, guest);
  assert.equal(joined.faction, 'vesper');
  assert.equal((await service.join(created.invite!, guest)).faction, 'vesper');
  await assert.rejects(service.start(created.id, guest), { status: 403 });
  await assert.rejects(service.setRecovery(created.id, guest, { requestId: 'recovery-account-01', secret: 'a'.repeat(64) }), { status: 409 });
  assert.equal((await service.accountSession(guest))?.id, created.id);
});
