/** @format */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { GameService } from './service';
import { createApi } from './http';
import { Failure } from './failure';
import { createLegacyGame } from '../src/game/legacy';
import { CURRENT_CLIENT_ACCEPT } from '../src/contracts/representation';

async function fixture(t: TestContext, reportingEnabled = true) {
  const directory = await mkdtemp(join(tmpdir(), 'machination-message-reports-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'rooms.json');
  const service = await GameService.open(file, () => 1000, createLegacyGame, { reportingEnabled });
  const tokens = Array.from({ length: 3 }, () => randomBytes(32).toString('hex'));
  const room = await service.create(tokens[0]!);
  await service.join(room.invite, tokens[1]!);
  await service.join(room.invite, tokens[2]!);
  const server = createApi(service, undefined, undefined, {
    operatorAuthenticate: async (token) => {
      if (token !== 'operator-session')
        throw new Failure(401, 'operator.unauthorized.session', 'Operator sign-in required.');
      return { accountId: 'user_operator' };
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function request(token: string, path: string, payload?: unknown) {
    const response = await fetch(url + path, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: CURRENT_CLIENT_ACCEPT,
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  }
  const game = (token: string, action = '', payload?: unknown) =>
    request(token, `/v1/games/${room.id}${action ? `/${action}` : ''}`, payload);
  return { file, service, tokens, room, request, game };
}

test('a report captures only an entitled canonical message and operator review preserves player state', async (t) => {
  const {
    file,
    room,
    tokens: [host, guest, outsider],
    request,
    game,
  } = await fixture(t);
  await game(guest!, 'messages', {
    requestId: randomUUID(),
    to: 'you',
    text: 'Canonical report evidence',
  });
  const before = (await game(host!)).body;
  const command = {
    requestId: randomUUID(),
    target: { kind: 'private', id: before.messages[0].id },
    reason: 'harassment',
    detail: 'Please review this message.',
  };
  const accepted = await game(host!, 'message-reports', command);
  assert.equal(accepted.status, 200);
  assert.match(accepted.body.caseId, /^[a-f0-9]{32}$/);
  assert.equal(accepted.body.gameId, room.id);
  assert.deepEqual((await game(host!)).body, before);
  assert.deepEqual(await game(host!, 'message-reports', command), accepted);
  assert.equal(
    (await game(host!, 'message-reports', { ...command, detail: 'Changed intent' })).status,
    409,
  );
  assert.equal((await request(outsider!, '/v1/operator/message-reports')).status, 401);
  const listed = await request('operator-session', '/v1/operator/message-reports');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.reports.length, 1);
  assert.equal('evidence' in listed.body.reports[0], false);
  const detail = await request(
    'operator-session',
    `/v1/operator/message-reports/${accepted.body.caseId}`,
  );
  assert.equal(detail.body.evidence.text, 'Canonical report evidence');
  assert.equal(detail.body.author, 'vesper');
  const review = {
    requestId: randomUUID(),
    revision: 0,
    status: 'reviewed',
    note: 'Reviewed by the operator; no enforcement implied.',
  };
  const reviewed = await request(
    'operator-session',
    `/v1/operator/message-reports/${accepted.body.caseId}`,
    review,
  );
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.revision, 1);
  assert.equal(reviewed.body.reviews[0].actor, 'user_operator');
  assert.deepEqual(
    await request(
      'operator-session',
      `/v1/operator/message-reports/${accepted.body.caseId}`,
      review,
    ),
    reviewed,
  );
  assert.deepEqual((await game(host!)).body, before);
  const stored = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(JSON.parse(stored.messageReports.source).cases.length, 1);
  assert.equal('messageReports' in before, false);
  assert.equal('reporterKey' in detail.body, false);
  assert.equal('request' in detail.body, false);
});

test('only the controlling seat can report visible aliases and fixed-member channels', async (t) => {
  const {
    tokens: [host, guest, outsider],
    game,
  } = await fixture(t);
  await game(guest!, 'messages', { requestId: randomUUID(), to: 'you', text: 'Visible to host' });
  await game(guest!, 'messages', {
    requestId: randomUUID(),
    to: 'null',
    text: 'Not visible to host',
  });
  const hostSnapshot = (await game(host!)).body;
  const otherSnapshot = (await game(outsider!)).body;
  const validAlias = hostSnapshot.messages[0].id;
  const hiddenAlias = otherSnapshot.messages[0].id;
  assert.notEqual(validAlias, hiddenAlias);
  const report = (target: unknown, extra = {}) => ({
    requestId: randomUUID(),
    target,
    reason: 'spam',
    detail: '',
    ...extra,
  });
  const hidden = await game(host!, 'message-reports', report({ kind: 'private', id: hiddenAlias }));
  const missing = await game(
    host!,
    'message-reports',
    report({ kind: 'private', id: validAlias + 1 }),
  );
  assert.equal(hidden.status, 404);
  assert.equal(missing.status, 404);
  assert.equal(hidden.body.issues[0].issue, missing.body.issues[0].issue);
  assert.equal(
    (await game('f'.repeat(64), 'message-reports', report({ kind: 'private', id: validAlias })))
      .status,
    401,
  );
  assert.equal(
    (
      await game(
        host!,
        'message-reports',
        report({ kind: 'private', id: validAlias }, { evidence: 'Fabricated content' }),
      )
    ).status,
    400,
  );
  const made = await game(host!, 'groups', {
    requestId: randomUUID(),
    name: 'Fixed audience',
    members: ['you', 'vesper'],
  });
  const channelId = made.body.groups[0].id;
  await game(guest!, 'channel-messages', {
    requestId: randomUUID(),
    channelId,
    text: 'Group evidence',
  });
  const channel = (await game(host!)).body.channels.find(
    (item: { id: string }) => item.id === channelId,
  );
  const target = { kind: 'channel', channelId, id: channel.messages[0].id };
  assert.equal((await game(outsider!, 'message-reports', report(target))).status, 404);
  assert.equal((await game(host!, 'message-reports', report(target))).status, 200);
  assert.equal(
    (await game(guest!, 'message-reports', report(target))).status,
    404,
    'authors cannot report their own content',
  );
  assert.equal((await game(host!, 'reporting?extra=1')).status, 400);
});

test('accepted reports survive blocking, source pruning, restart, and disabled new collection', async (t) => {
  const {
    file,
    service,
    room,
    tokens: [host, guest],
    game,
  } = await fixture(t);
  await game(guest!, 'messages', {
    requestId: randomUUID(),
    to: 'you',
    text: 'Retained evidence after block',
  });
  const alias = (await game(host!)).body.messages[0].id;
  await game(host!, 'message-blocks', {
    requestId: randomUUID(),
    revision: 0,
    player: 'vesper',
    blocked: true,
  });
  assert.deepEqual((await game(host!)).body.messages, []);
  const blocked = {
    requestId: randomUUID(),
    target: { kind: 'private' as const, id: alias },
    reason: 'harassment' as const,
    detail: '',
  };
  const accepted = await game(host!, 'message-reports', blocked);
  assert.equal(accepted.status, 200);
  await service.channelMessage(room.id, guest!, {
    requestId: randomUUID(),
    channelId: 'public',
    text: 'Soon pruned source',
  });
  const visible = (await service.snapshot(room.id, guest!)).channels!.find(
    (channel) => channel.id === 'public',
  )!.messages[0]!;
  const command = {
    requestId: randomUUID(),
    target: { kind: 'channel' as const, channelId: 'public', id: visible.id },
    reason: 'spam' as const,
    detail: '',
  };
  const receipt = await service.submitMessageReport(room.id, host!, command);
  for (let index = 0; index < 101; index++)
    await service.channelMessage(room.id, guest!, {
      requestId: randomUUID(),
      channelId: 'public',
      text: `Retained ${index}`,
    });
  assert.equal(
    (await service.snapshot(room.id, guest!))
      .channels!.find((channel) => channel.id === 'public')!
      .messages.some((message) => message.id === visible.id),
    false,
  );
  const reopened = await GameService.open(file, () => 1000, createLegacyGame);
  assert.equal((await reopened.reportingAvailability(room.id, host!)).available, false);
  assert.deepEqual(await reopened.submitMessageReport(room.id, host!, command), receipt);
  assert.deepEqual(await reopened.submitMessageReport(room.id, host!, blocked), accepted.body);
  assert.equal((await reopened.messageReport(receipt.caseId)).evidence.text, 'Soon pruned source');
  await assert.rejects(
    reopened.submitMessageReport(room.id, host!, { ...command, requestId: randomUUID() }),
    { code: 'report.unavailable.configuration' },
  );
  const enabled = await GameService.open(file, () => 1000, createLegacyGame, {
    reportingEnabled: true,
  });
  await assert.rejects(
    enabled.submitMessageReport(room.id, host!, { ...command, requestId: randomUUID() }),
    { code: 'report.not_found.message' },
  );
});

test('malformed and future report ledgers remain preserved while healthy operations continue', async (t) => {
  const {
    file,
    room,
    tokens: [host],
  } = await fixture(t);
  const initial = JSON.parse(await readFile(file, 'utf8'));
  for (const damaged of [
    { version: 2, cases: [{ future: 'Retain this evidence' }] },
    { version: 1, cases: [{ broken: true }] },
    'opaque future state',
  ]) {
    await writeFile(file, JSON.stringify({ ...initial, messageReports: damaged }));
    const reopened = await GameService.open(file, () => 1000, createLegacyGame, {
      reportingEnabled: true,
    });
    assert.equal((await reopened.reportingAvailability(room.id, host!)).available, false);
    await assert.rejects(reopened.listMessageReports(), { code: 'report.unavailable.storage' });
    assert.equal((await reopened.snapshot(room.id, host!)).id, room.id);
    await reopened.setMessageBlock(room.id, host!, {
      requestId: randomUUID(),
      revision: 0,
      player: 'vesper',
      blocked: true,
    });
    const stored = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(JSON.parse(stored.messageReports.source), damaged);
    assert.equal(stored.rooms.length, initial.rooms.length);
  }
});

test('operator admission stays separate from player auth and concurrent review keeps one accepted revision', async (t) => {
  const {
    tokens: [host, guest],
    request,
    game,
  } = await fixture(t);
  assert.equal(
    (await request(randomBytes(32).toString('hex'), '/v1/games', {})).status,
    200,
    'operator auth must not gate guest creation',
  );
  await game(guest!, 'messages', {
    requestId: randomUUID(),
    to: 'you',
    text: 'One review sequence',
  });
  const alias = (await game(host!)).body.messages[0].id;
  const accepted = await game(host!, 'message-reports', {
    requestId: randomUUID(),
    target: { kind: 'private', id: alias },
    reason: 'threat',
    detail: '',
  });
  const path = `/v1/operator/message-reports/${accepted.body.caseId}`;
  const commands = ['reviewed', 'escalated'].map((status) => ({
    requestId: randomUUID(),
    revision: 0,
    status,
    note: 'Recorded review',
  }));
  const outcomes = await Promise.all(
    commands.map((command) => request('operator-session', path, command)),
  );
  assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), [200, 409]);
  const winner = outcomes.findIndex((outcome) => outcome.status === 200);
  assert.deepEqual(await request('operator-session', path, commands[winner]), outcomes[winner]);
  const current = (await request('operator-session', path)).body;
  assert.equal(current.revision, 1);
  assert.equal(current.reviews.length, 1);
  assert.equal(
    (await request('operator-session', path, { ...commands[winner], note: 'Different retry' }))
      .status,
    409,
  );
  for (const suffix of [
    '?status=open&status=reviewed',
    '?limit=1000',
    '?after=bad',
    '?status=unknown',
  ])
    assert.equal(
      (await request('operator-session', '/v1/operator/message-reports' + suffix)).status,
      400,
    );
  assert.equal((await request(host!, path)).status, 401);
});

test('report and review limits retain accepted retries and paginate private operator summaries', async (t) => {
  const {
    service,
    room,
    tokens: [host, guest],
  } = await fixture(t);
  await service.message(room.id, guest!, {
    requestId: randomUUID(),
    to: 'you',
    text: 'Private evidence must stay out of summaries',
  });
  const id = (await service.snapshot(room.id, host!)).messages[0]!.id;
  const requests = Array.from({ length: 32 }, (_, index) => ({
    requestId: randomUUID(),
    target: { kind: 'private' as const, id },
    reason: 'other' as const,
    detail: `Report ${index}`,
  }));
  const receipts = [];
  for (const request of requests)
    receipts.push(await service.submitMessageReport(room.id, host!, request));
  assert.equal((await service.reportingAvailability(room.id, host!)).available, false);
  await assert.rejects(
    service.submitMessageReport(room.id, host!, { ...requests[0]!, requestId: randomUUID() }),
    { code: 'report.capacity.reached' },
  );
  assert.deepEqual(await service.submitMessageReport(room.id, host!, requests[0]), receipts[0]);
  const first = await service.listMessageReports();
  const second = await service.listMessageReports({ after: first.next });
  assert.equal(first.reports.length, 25);
  assert.equal(second.reports.length, 7);
  assert.equal(second.next, undefined);
  assert.equal(new Set([...first.reports, ...second.reports].map((report) => report.id)).size, 32);
  assert.equal(JSON.stringify(first).includes('Private evidence'), false);
  const caseId = receipts[0]!.caseId;
  const reviews = Array.from({ length: 16 }, (_, revision) => ({
    requestId: randomUUID(),
    revision,
    status: revision % 2 ? ('reviewed' as const) : ('escalated' as const),
    note: `Review ${revision}`,
  }));
  for (const review of reviews) await service.reviewMessageReport(caseId, 'user_operator', review);
  await assert.rejects(
    service.reviewMessageReport(caseId, 'user_operator', {
      ...reviews[0],
      requestId: randomUUID(),
      revision: 16,
    }),
    { code: 'report.capacity.reviews' },
  );
  const retried = await service.reviewMessageReport(caseId, 'user_operator', reviews[0]);
  assert.equal(retried.revision, 16);
  assert.equal(retried.reviews.length, 16);
  assert.equal(retried.reviews[0]!.requestId, reviews[0]!.requestId);
  await assert.rejects(
    service.reviewMessageReport(receipts[1]!.caseId, 'user_operator', reviews[0]),
    { code: 'report.conflict.request' },
  );
});

test('report acknowledgement follows the controlling seat through recovery and account linking', async (t) => {
  const {
    service,
    room,
    tokens: [host, guest],
  } = await fixture(t);
  await service.message(room.id, guest!, {
    requestId: randomUUID(),
    to: 'you',
    text: 'Receipt belongs to the seat',
  });
  const input = {
    requestId: randomUUID(),
    target: {
      kind: 'private' as const,
      id: (await service.snapshot(room.id, host!)).messages[0]!.id,
    },
    reason: 'other' as const,
    detail: '',
  };
  const receipt = await service.submitMessageReport(room.id, host!, input);
  const secret = randomBytes(32).toString('hex'),
    replacement = randomBytes(32).toString('hex');
  await service.setRecovery(room.id, host!, { requestId: randomUUID(), secret });
  await service.recover(room.id, replacement, { secret });
  await assert.rejects(service.submitMessageReport(room.id, host!, input), {
    code: 'seat.unauthorized.token',
  });
  assert.deepEqual(await service.submitMessageReport(room.id, replacement, input), receipt);
  const account = { accountId: 'user_reporter' };
  await service.linkAccount(room.id, replacement, account);
  await assert.rejects(service.submitMessageReport(room.id, replacement, input), {
    code: 'seat.unauthorized.token',
  });
  await assert.rejects(service.submitMessageReport(room.id, { accountId: 'user_other' }, input), {
    code: 'seat.unauthorized.token',
  });
  assert.deepEqual(await service.submitMessageReport(room.id, account, input), receipt);
  assert.equal((await service.listMessageReports()).reports.length, 1);
});
