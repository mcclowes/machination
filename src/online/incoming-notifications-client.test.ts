import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messageNotificationsApi, setMessageNotificationsApi } from './network';
import { notificationDisposition, parseNotificationData } from './message-notifications';

const gameId = 'a'.repeat(24), deviceId = 'b'.repeat(64);
const seat = { url: 'https://belt.example', token: 'c'.repeat(64), id: gameId };
const legacy = { gameId, deviceId, revision: 2, available: true, enabled: true, bindingId: 'binding-1' };

test('preference reads negotiate incoming support while retaining a legacy response unchanged', async t => {
  const requested: string[] = [];
  const responses = [legacy, { ...legacy, incoming: false }, { ...legacy, incoming: true }];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    requested.push(url);
    return new Response(JSON.stringify(responses.shift()), { status: 200 });
  });
  assert.deepEqual(await messageNotificationsApi(seat, deviceId), legacy);
  assert.deepEqual(await messageNotificationsApi(seat, deviceId), { ...legacy, incoming: false });
  assert.deepEqual(await messageNotificationsApi(seat, deviceId), { ...legacy, incoming: true });
  assert.ok(requested.every(url => new URL(url).searchParams.get('version') === '2'));
});

test('incoming consent writes use version two; legacy message and token writes retain version one', async t => {
  const requests: { url: string; body: any }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    requests.push({ url, body });
    return new Response(JSON.stringify({ ...legacy, revision: 3, ...(body.incoming === undefined ? {} : { incoming: body.incoming }) }), { status: 200 });
  });
  const body = { requestId: 'incoming-request-001', deviceId, revision: 2, enabled: true, expoPushToken: 'ExponentPushToken[device]' };
  assert.deepEqual(await setMessageNotificationsApi(seat, body), { ...legacy, revision: 3 });
  for (const incoming of [false, true]) {
    const consent = { ...body, incoming };
    assert.deepEqual(await setMessageNotificationsApi(seat, consent), { ...legacy, revision: 3, incoming });
  }
  const preferenceOnly = { ...body, expoPushToken: undefined, incoming: false };
  assert.deepEqual(await setMessageNotificationsApi(seat, preferenceOnly), { ...legacy, revision: 3, incoming: false });
  assert.equal(new URL(requests[0]!.url).searchParams.get('version'), null);
  assert.deepEqual(requests.slice(1).map(request => new URL(request.url).searchParams.get('version')), ['2', '2', '2']);
  assert.deepEqual(requests.map(request => request.body.incoming), [undefined, false, true, false]);
  assert.equal(requests[3]!.body.expoPushToken, undefined, 'Changing consent does not require a provider token request');
});

test('only an old server’s query-validation refusal falls back to message-only preferences', async t => {
  const requested: string[] = [];
  let failure = { status: 400, issue: 'notification.validation.device' };
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    requested.push(url);
    return new URL(url).searchParams.has('version')
      ? new Response(JSON.stringify({ issues: [{ issue: failure.issue, message: { detail: 'Unsupported query.' } }] }), { status: failure.status })
      : new Response(JSON.stringify(legacy), { status: 200 });
  });
  assert.deepEqual(await messageNotificationsApi(seat, deviceId), legacy);
  assert.deepEqual(requested.map(url => new URL(url).searchParams.get('version')), ['2', null]);
  for (const denied of [{ status: 401, issue: 'seat.unauthorized.token' }, { status: 400, issue: 'notification.validation.payload' }, { status: 503, issue: 'notification.unavailable.delivery' }]) {
    failure = denied;
    const before = requested.length;
    await assert.rejects(messageNotificationsApi(seat, deviceId), /Unsupported query/);
    assert.equal(requested.length, before + 1, 'Authentication, transient failures, and unrelated validation do not downgrade');
  }
});

test('incoming preferences reject malformed or disabled consent before making a request', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('Unexpected request'); });
  const body = { requestId: 'incoming-request-002', deviceId, revision: 2, enabled: false };
  for (const incoming of [true, 'false', null, 1]) {
    await assert.rejects(setMessageNotificationsApi(seat, { ...body, incoming } as any), /Invalid notification preference/);
  }
  assert.equal(calls, 0);
});

test('incoming response flags remain strict and cannot bypass binding or privacy validation', async t => {
  let response: unknown;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(response), { status: 200 }));
  for (const patch of [{ incoming: 'true' }, { incoming: null }, { incoming: true, enabled: false, bindingId: undefined }, { incoming: true, token: 'private-token' }]) {
    response = { ...legacy, ...patch };
    await assert.rejects(messageNotificationsApi(seat, deviceId), /Unsupported notification settings/);
  }
  response = { gameId, deviceId, revision: 3, available: true, enabled: false, incoming: false };
  assert.deepEqual(await messageNotificationsApi(seat, deviceId), response);
});

test('incoming taps preserve their kind and accept only opaque navigation data', () => {
  const data = { kind: 'machination.incoming', version: 1, gameId, bindingId: 'binding-1', notificationId: 'attack-1' };
  assert.deepEqual(parseNotificationData(data), { kind: 'machination.incoming', gameId, bindingId: 'binding-1', notificationId: 'attack-1' });
  for (const patch of [{ version: 2 }, { kind: 'unknown' }, { fleetId: 123 }, { sender: 'Vesper' }, { arrives: 4 }, { bindingId: '' }]) {
    assert.equal(parseNotificationData({ ...data, ...patch }), undefined);
  }
});

test('incoming taps require fresh incoming consent as well as the restored operation and binding', () => {
  const request = parseNotificationData({ kind: 'machination.incoming', version: 1, gameId, bindingId: 'binding-1', notificationId: 'attack-1' })!;
  assert.ok(request);
  const target = { restored: true, gameId, bindingId: 'binding-1' };
  assert.equal(notificationDisposition(request, { ...target, restored: false, incoming: true }), 'wait');
  assert.equal(notificationDisposition(request, { ...target, bindingId: undefined, incoming: true }), 'wait');
  for (const incoming of [undefined, false]) assert.equal(notificationDisposition(request, { ...target, incoming }), 'ignore');
  assert.equal(notificationDisposition(request, { ...target, incoming: true }), 'open');
  assert.equal(notificationDisposition(request, { ...target, gameId: 'd'.repeat(24), incoming: true }), 'ignore');
  assert.equal(notificationDisposition(request, { ...target, bindingId: 'old-binding', incoming: true }), 'ignore');
});
