/** @format */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportingAvailabilityApi, submitMessageReportApi } from './message-reports-network';
import { CURRENT_CLIENT_ACCEPT } from '../contracts/representation';
import type { SubmitMessageReport } from '../contracts/message-reports';

test('report transport refreshes account authorization and binds strict receipts to the exact request and seat', async (t) => {
  let refreshes = 0;
  const seat = {
    url: 'https://belt.example',
    id: 'a'.repeat(24),
    faction: 'you' as const,
    token: 'never-fallback',
    accountId: 'user_alice',
    getToken: async () => `fresh-session-${++refreshes}`,
  };
  const body: SubmitMessageReport = {
    requestId: 'message-report-request-1',
    target: { kind: 'private', id: 123 },
    reason: 'spam',
    detail: '',
  };
  const availability = { gameId: seat.id, faction: seat.faction, available: true };
  const receipt = {
    gameId: seat.id,
    faction: seat.faction,
    requestId: body.requestId,
    caseId: 'b'.repeat(32),
    receivedAt: 1000,
  };
  const calls: { url: string; options: RequestInit }[] = [];
  let response: unknown = availability;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(response));
  });
  assert.deepEqual(await reportingAvailabilityApi(seat), availability);
  response = receipt;
  assert.deepEqual(await submitMessageReportApi(seat, body), receipt);
  assert.equal(calls[0]!.url, `${seat.url}/v1/games/${seat.id}/reporting`);
  assert.equal(calls[0]!.options.method, 'GET');
  assert.equal(calls[1]!.url, `${seat.url}/v1/games/${seat.id}/message-reports`);
  assert.equal(calls[1]!.options.method, 'POST');
  assert.deepEqual(calls[1]!.options.headers, {
    Authorization: 'Bearer fresh-session-2',
    'Content-Type': 'application/json',
    Accept: CURRENT_CLIENT_ACCEPT,
  });
  assert.deepEqual(JSON.parse(calls[1]!.options.body as string), body);
  for (const malformed of [
    { ...receipt, gameId: 'c'.repeat(24) },
    { ...receipt, faction: 'vesper' },
    { ...receipt, requestId: 'different-request-1' },
    { ...receipt, extra: true },
    { ...receipt, caseId: 'invalid' },
  ]) {
    response = malformed;
    await assert.rejects(submitMessageReportApi(seat, body), /Unsupported message report receipt/);
  }
  for (const malformed of [
    { ...availability, faction: 'vesper' },
    { ...availability, gameId: 'c'.repeat(24) },
    { ...availability, available: 'yes' },
    { ...availability, extra: true },
  ]) {
    response = malformed;
    await assert.rejects(
      reportingAvailabilityApi(seat),
      /Unsupported reporting availability response/,
    );
  }
  const count = calls.length;
  for (const target of [
    { kind: 'private', id: 2 ** 48 },
    { kind: 'private', id: -1 },
    { kind: 'channel', id: 'b'.repeat(32), channelId: '../other' },
  ])
    await assert.rejects(
      submitMessageReportApi(seat, { ...body, target: target as SubmitMessageReport['target'] }),
      /Invalid message report/,
    );
  await assert.rejects(
    reportingAvailabilityApi({ ...seat, id: '../other' }),
    /Invalid reporting seat/,
  );
  await assert.rejects(
    submitMessageReportApi({ ...seat, getToken: async () => null }, body),
    /Sign in/,
  );
  assert.equal(calls.length, count, 'invalid input and expired account sessions never reach fetch');
});
