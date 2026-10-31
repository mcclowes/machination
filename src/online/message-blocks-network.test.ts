/** @format */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageBlocksApi, setMessageBlockApi } from './network';
import { CURRENT_CLIENT_ACCEPT } from '../contracts/representation';

test('message-block transport binds strict settings to the requested operation and seat', async (t) => {
  const seat = {
    url: 'https://belt.example',
    id: 'a'.repeat(24),
    token: 'b'.repeat(64),
    faction: 'you' as const,
  };
  const settings = { gameId: seat.id, faction: seat.faction, revision: 0, blocked: [] };
  const calls: { url: string; options: RequestInit }[] = [];
  let response: unknown = settings;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(response));
  });
  assert.deepEqual(await messageBlocksApi(seat), settings);
  const body = {
    requestId: 'message-block-request-1',
    revision: 0,
    player: 'vesper' as const,
    blocked: true,
  };
  response = { ...settings, revision: 1, blocked: ['vesper'] };
  assert.deepEqual(await setMessageBlockApi(seat, body), response);
  assert.equal(calls[0]!.url, `${seat.url}/v1/games/${seat.id}/message-blocks`);
  assert.equal(calls[0]!.options.method, 'GET');
  assert.equal(calls[1]!.options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1]!.options.body as string), body);
  assert.deepEqual(calls[1]!.options.headers, {
    Authorization: `Bearer ${seat.token}`,
    'Content-Type': 'application/json',
    Accept: CURRENT_CLIENT_ACCEPT,
  });
  for (const malformed of [
    { ...settings, gameId: 'c'.repeat(24) },
    { ...settings, faction: 'vesper' },
    { ...settings, revision: -1 },
    { ...settings, blocked: ['you'] },
    { ...settings, revision: 1, blocked: ['vesper', 'vesper'] },
    { ...settings, revision: 1, blocked: ['unknown'] },
    { ...settings, extra: true },
  ]) {
    response = malformed;
    await assert.rejects(messageBlocksApi(seat), /Unsupported message blocking response/);
  }
  const count = calls.length;
  await assert.rejects(
    setMessageBlockApi(seat, { ...body, player: 'you' }),
    /Invalid message block/,
  );
  assert.equal(calls.length, count, 'invalid choices never reach the network');
});
