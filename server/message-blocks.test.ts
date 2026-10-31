/** @format */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { GameService } from './service';
import { createApi } from './http';
import { createLegacyGame } from '../src/game/legacy';
import { CURRENT_CLIENT_ACCEPT } from '../src/contracts/representation';
import { snapshotResponse } from '../src/contracts/snapshot';
import { createConfiguredGame } from '../src/game/world';

async function fixture(t: TestContext, notifications = false, initialGame = createLegacyGame) {
  const directory = await mkdtemp(join(tmpdir(), 'machination-message-blocks-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'rooms.json');
  const service = await GameService.open(file, () => 1000, initialGame, { notifications });
  const tokens = Array.from({ length: 3 }, () => randomBytes(32).toString('hex'));
  const room = await service.create(tokens[0]!);
  await service.join(room.invite, tokens[1]!);
  await service.join(room.invite, tokens[2]!);
  const server = createApi(service);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function request(
    token: string,
    action = '',
    payload?: unknown,
    accept = CURRENT_CLIENT_ACCEPT,
  ) {
    const response = await fetch(`${url}/v1/games/${room.id}${action ? `/${action}` : ''}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: accept,
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  }
  return { file, service, room, tokens, request };
}

test('blocking hides incoming bilateral, group, and public messages only for that seat', async (t) => {
  const {
    room,
    tokens: [host, guest, third],
    request,
  } = await fixture(t);
  const initial = await request(host!, 'message-blocks');
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body, { gameId: room.id, faction: 'you', revision: 0, blocked: [] });
  assert.equal(
    (
      await request(guest!, 'messages', {
        requestId: randomUUID(),
        to: 'you',
        text: 'Earlier private message',
      })
    ).status,
    200,
  );
  const made = await request(host!, 'groups', {
    requestId: randomUUID(),
    name: 'Shared agreement',
    members: ['you', 'vesper', 'null'],
  });
  const channelId = made.body.groups[0].id;
  for (const id of ['public', channelId])
    assert.equal(
      (
        await request(guest!, 'channel-messages', {
          requestId: randomUUID(),
          channelId: id,
          text: 'Earlier channel message',
        })
      ).status,
      200,
    );

  const blocked = await request(host!, 'message-blocks', {
    requestId: randomUUID(),
    revision: 0,
    player: 'vesper',
    blocked: true,
  });
  assert.equal(blocked.status, 200);
  assert.deepEqual(blocked.body, { ...initial.body, revision: 1, blocked: ['vesper'] });
  const own = snapshotResponse(room.id, (await request(host!)).body);
  assert.deepEqual(own.messages, []);
  assert.ok(own.channels!.every((channel) => channel.messages.length === 0));
  assert.equal(snapshotResponse(room.id, (await request(guest!)).body).messages.length, 1);
  const unaffected = snapshotResponse(room.id, (await request(third!)).body);
  assert.ok(unaffected.channels!.every((channel) => channel.messages.length === 1));
  assert.deepEqual((await request(guest!, 'message-blocks')).body.blocked, []);
  assert.equal(
    (
      await request(guest!, 'messages', {
        requestId: randomUUID(),
        to: 'you',
        text: 'Blocked direct message',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(host!, 'message-blocks', {
        requestId: randomUUID(),
        revision: 1,
        player: 'vesper',
        blocked: false,
      })
    ).status,
    200,
  );
  const restored = snapshotResponse(room.id, (await request(host!)).body);
  assert.equal(restored.messages[0]!.text, 'Earlier private message');
  assert.ok(restored.channels!.every((channel) => channel.messages.length === 1));
});

test('a new block clears only that seat’s generic message jobs and stops new blocked-sender alerts', async (t) => {
  const {
    service,
    room,
    tokens: [host, guest, third],
    request,
  } = await fixture(t, true);
  const pushTokens = ['ExponentPushToken[host]', 'ExponentPushToken[third]'];
  for (const [index, token] of [host, third].entries())
    await service.setNotifications(room.id, token!, {
      requestId: randomUUID(),
      deviceId: randomBytes(32).toString('hex'),
      revision: 0,
      enabled: true,
      expoPushToken: pushTokens[index]!,
    });
  const post = () =>
    request(guest!, 'channel-messages', {
      requestId: randomUUID(),
      channelId: 'public',
      text: 'Public transmission',
    });
  await post();
  assert.equal(
    (
      await request(host!, 'message-blocks', {
        requestId: randomUUID(),
        revision: 0,
        player: 'vesper',
        blocked: true,
      })
    ).status,
    200,
  );
  const pending = await service.notificationQueue().claimSends('after-block');
  assert.deepEqual(
    pending.items.map((item) => item.message.to),
    [pushTokens[1]],
  );
  await service
    .notificationQueue()
    .finishSends(
      pending.lease,
      new Map(pending.items.map((item) => [item.jobId, { kind: 'drop' as const }])),
    );
  await post();
  const later = await service.notificationQueue().claimSends('new-message');
  assert.deepEqual(
    later.items.map((item) => item.message.to),
    [pushTokens[1]],
  );
});

test('startup refuses damaged block preferences rather than silently restoring contact', async (t) => {
  const {
    file,
    service,
    room,
    tokens: [host],
  } = await fixture(t);
  const original = JSON.parse(await readFile(file, 'utf8'));
  const valid = {
    revision: 1,
    blocked: ['vesper'],
    requests: [
      {
        requestId: randomUUID(),
        revision: 0,
        player: 'vesper',
        blocked: true,
      },
    ],
  };
  for (const damaged of [
    null,
    { ...valid, revision: -1 },
    { ...valid, blocked: ['you'] },
    { ...valid, blocked: ['vesper', 'vesper'] },
    { ...valid, blocked: ['morrow'] },
    { ...valid, blocked: [] },
    { revision: 0, blocked: ['vesper'], requests: [] },
    { ...valid, requests: [{ ...valid.requests[0], revision: 1 }] },
    { ...valid, extra: true },
  ]) {
    const database = structuredClone(original);
    database.rooms[0].seats[0].messageBlocks = damaged;
    await writeFile(file, JSON.stringify(database));
    const bytes = await readFile(file, 'utf8');
    await assert.rejects(
      GameService.open(file, () => 1000, createLegacyGame),
      /Damaged message blocking/,
    );
    assert.equal(await readFile(file, 'utf8'), bytes);
  }
  await writeFile(file, JSON.stringify(original));
  const restored = await GameService.open(file, () => 1000, createLegacyGame);
  assert.deepEqual(
    await restored.messageBlockSettings(room.id, host!),
    await service.messageBlockSettings(room.id, host!),
  );
});

test('a block prevents new private groups and both directions of direct contact, but accepted retries remain safe', async (t) => {
  const {
    room,
    tokens: [host, guest, third],
    request,
  } = await fixture(t);
  const earlier = { requestId: randomUUID(), name: 'Existing group', members: ['you', 'vesper'] };
  const made = await request(guest!, 'groups', earlier);
  assert.equal(made.status, 200);
  await request(host!, 'message-blocks', {
    requestId: randomUUID(),
    revision: 0,
    player: 'vesper',
    blocked: true,
  });
  assert.equal((await request(guest!, 'groups', earlier)).status, 200);
  for (const token of [host!, guest!]) {
    const refused = await request(token, 'groups', { ...earlier, requestId: randomUUID() });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.issues[0].issue, 'group.conflict.blocked');
  }
  assert.equal(
    (
      await request(host!, 'messages', {
        requestId: randomUUID(),
        to: 'vesper',
        text: 'Outgoing contact',
      })
    ).status,
    409,
  );
  const shared = await request(third!, 'groups', {
    requestId: randomUUID(),
    name: 'Third-party group',
    members: ['you', 'vesper', 'null'],
  });
  assert.equal(
    shared.status,
    200,
    'another member may create a shared group; blocked text remains filtered',
  );
  const channelId = made.body.groups[0].id;
  const sent = await request(guest!, 'channel-messages', {
    requestId: randomUUID(),
    channelId,
    text: 'Existing group message',
  });
  assert.equal(sent.status, 200);
  assert.equal(
    snapshotResponse(room.id, (await request(host!)).body).channels!.find(
      (c) => c.id === channelId,
    )!.messages.length,
    0,
  );
});

test('block retries, stale writes, restart, credential recovery, and failed persistence preserve the seat’s choice', async (t) => {
  const {
    file,
    service,
    room,
    tokens: [host],
    request,
  } = await fixture(t);
  const before = JSON.parse(await readFile(file, 'utf8'));
  const block = { requestId: randomUUID(), revision: 0, player: 'vesper', blocked: true };
  const first = await request(host!, 'message-blocks', block);
  assert.equal(first.status, 200);
  const stored = JSON.parse(await readFile(file, 'utf8'));
  delete stored.rooms[0].seats[0].messageBlocks;
  assert.deepEqual(
    stored,
    before,
    'preferences do not settle time, renew presence, revise orders, or enter replay',
  );
  assert.deepEqual((await request(host!, 'message-blocks', block)).body, first.body);
  const off = await request(host!, 'message-blocks', {
    ...block,
    requestId: randomUUID(),
    revision: 1,
    blocked: false,
  });
  assert.equal(off.status, 200);
  assert.deepEqual(
    (await request(host!, 'message-blocks', block)).body,
    off.body,
    'a lost old response cannot reapply a newer choice',
  );
  for (const [body, issue] of [
    [{ ...block, blocked: false }, 'command.conflict.reused_id'],
    [{ ...block, requestId: randomUUID() }, 'message_block.conflict.stale'],
  ] as const) {
    const result = await request(host!, 'message-blocks', body);
    assert.equal(result.status, 409);
    assert.equal(result.body.issues[0].issue, issue);
  }
  const next = { ...block, requestId: randomUUID(), revision: 2 };
  const bytes = await readFile(file, 'utf8');
  await mkdir(`${file}.tmp`);
  const failed = await request(host!, 'message-blocks', next);
  assert.equal(failed.status, 500);
  assert.equal(await readFile(file, 'utf8'), bytes);
  assert.deepEqual(await service.messageBlockSettings(room.id, host!), off.body);
  await rm(`${file}.tmp`, { recursive: true });
  assert.equal((await request(host!, 'message-blocks', next)).status, 200);
  const reopened = await GameService.open(file, () => 1000, createLegacyGame);
  assert.deepEqual(await reopened.messageBlockSettings(room.id, host!), {
    ...first.body,
    revision: 3,
  });
  const recovery = randomBytes(32).toString('hex'),
    replacement = randomBytes(32).toString('hex');
  await reopened.setRecovery(room.id, host!, { requestId: randomUUID(), secret: recovery });
  await reopened.recover(room.id, replacement, { secret: recovery });
  assert.deepEqual(await reopened.messageBlockSettings(room.id, replacement), {
    ...first.body,
    revision: 3,
  });
  await assert.rejects(reopened.messageBlockSettings(room.id, host!), { status: 401 });
  const account = { accountId: 'user_blocker' };
  await reopened.linkAccount(room.id, replacement, account);
  assert.deepEqual(await reopened.messageBlockSettings(room.id, account), {
    ...first.body,
    revision: 3,
  });
  await assert.rejects(reopened.messageBlockSettings(room.id, replacement), { status: 401 });
});

test('HTTP block preferences are authenticated, strict, and private to the selected operation', async (t) => {
  const {
    service,
    room,
    tokens: [host, guest],
    request,
  } = await fixture(t);
  const valid = { requestId: randomUUID(), revision: 0, player: 'vesper', blocked: true };
  const stranger = randomBytes(32).toString('hex');
  assert.equal((await request(stranger, 'message-blocks')).status, 401);
  assert.equal((await request(stranger, 'message-blocks', {})).status, 401);
  for (const payload of [
    {},
    { ...valid, extra: true },
    { ...valid, requestId: 'short' },
    { ...valid, revision: -1 },
    { ...valid, revision: 0.5 },
    { ...valid, blocked: 'true' },
    { ...valid, player: 'you' },
    { ...valid, player: 'morrow' },
    { ...valid, player: '__proto__' },
  ])
    assert.equal((await request(host!, 'message-blocks', payload)).status, 400);
  assert.equal((await request(host!, 'message-blocks?player=vesper')).status, 400);
  assert.equal((await request(host!, 'message-blocks?player=vesper', valid)).status, 400);
  assert.equal((await request(host!, 'message-blocks', valid)).status, 200);
  assert.deepEqual((await request(guest!, 'message-blocks')).body, {
    gameId: room.id,
    faction: 'vesper',
    revision: 0,
    blocked: [],
  });
  const other = await service.create(host!, undefined, undefined, undefined, randomUUID());
  assert.notEqual(other.id, room.id);
  assert.deepEqual(await service.messageBlockSettings(other.id, host!), {
    gameId: other.id,
    faction: 'you',
    revision: 0,
    blocked: [],
  });
});

test('message safety remains accessible when an old decoder cannot open the operation’s rules', async (t) => {
  const {
    room,
    tokens: [host],
    request,
  } = await fixture(t, false, (epoch = 1000) =>
    createConfiguredGame({ playerCount: 3, mode: 'pulse', gravity: true }, epoch, 73),
  );
  assert.equal((await request(host!, '', undefined, '*/*')).status, 503);
  const initial = await request(host!, 'message-blocks', undefined, '*/*');
  assert.equal(initial.status, 200);
  const saved = await request(
    host!,
    'message-blocks',
    { requestId: randomUUID(), revision: 0, player: 'vesper', blocked: true },
    '*/*',
  );
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.blocked, ['vesper']);
  assert.equal(
    snapshotResponse(room.id, (await request(host!)).body).game.rules!.mechanicsVersion,
    19,
  );
});

test('bounded receipt eviction cannot reapply an old block after another client changes it', async (t) => {
  const {
    file,
    service,
    room,
    tokens: [host],
  } = await fixture(t);
  const first = { requestId: randomUUID(), revision: 0, player: 'vesper' as const, blocked: true };
  await service.setMessageBlock(room.id, host!, first);
  for (let revision = 1; revision <= 35; revision++)
    await service.setMessageBlock(room.id, host!, {
      ...first,
      requestId: randomUUID(),
      revision,
      blocked: revision % 2 === 0,
    });
  const restarted = await GameService.open(file, () => 1000, createLegacyGame);
  const current = await restarted.messageBlockSettings(room.id, host!);
  assert.deepEqual(current.blocked, []);
  await assert.rejects(restarted.setMessageBlock(room.id, host!, first), {
    status: 409,
    code: 'message_block.conflict.stale',
  });
  assert.deepEqual(await restarted.messageBlockSettings(room.id, host!), current);
  const results = await Promise.allSettled(
    ['vesper', 'null'].map((player) =>
      restarted.setMessageBlock(room.id, host!, {
        requestId: randomUUID(),
        revision: current.revision,
        player,
        blocked: true,
      }),
    ),
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(
    results.filter(
      (result) =>
        result.status === 'rejected' && result.reason.code === 'message_block.conflict.stale',
    ).length,
    1,
  );
});
