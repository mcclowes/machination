import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { api, RejectedCommand } from './network';
import { testSnapshot } from './test-snapshot';
import { createConfiguredGame } from '../game/world';
import type { Faction } from '../game/players';
import { advance, createGame, dispatch } from '../game/simulation';
import { createLegacyGame } from '../game/legacy';
import { commandPulse } from '../game/pulse';
import { commandTacticalPulse } from '../game/tactical-pulse';

test('rate limits preserve uncertain pending commands while definitive rejections can clear them', async t => {
  const server = createServer((req, res) => {
    const status = req.url?.endsWith('rate-limit') ? 429 : 409;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ issues: [{ message: { detail: status === 429 ? 'Try again in a minute.' : 'Order rejected.' } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
  const session = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token: 'local-test-token' };
  await assert.rejects(() => api(session, 'rate-limit', {}), error => error instanceof Error && !(error instanceof RejectedCommand));
  await assert.rejects(() => api(session, 'reject', {}), error => error instanceof RejectedCommand && error.status === 409);
});

test('history uses its own authenticated envelope and requested metadata rather than terminal game hour', async t => {
  const { historicalApi } = await import('./network');
  const session = { url: 'https://belt.example', token: 'seat-secret', id: 'operation' };
  const frame = { id: session.id, faction: 'you', visibility: 'sensors.v1', history: { from: 0, through: 12, at: 10.25 }, game: { ...testSnapshot().game, hour: 9 } };
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, 'https://belt.example/v1/games/operation/history?hour=10.25');
    assert.equal(options.method, 'GET');
    assert.equal((options.headers as Record<string, string>).Authorization, 'Bearer seat-secret');
    assert.equal(options.body, undefined);
    return new Response(JSON.stringify(frame), { status: 200 });
  });
  assert.deepEqual(await historicalApi(session, 10.25), frame);
  await assert.rejects(api(session, 'games/operation/history?hour=10.25'), /Unsupported server response/);
  for (const invalid of [
    { ...frame, history: undefined }, { ...frame, id: 'another-operation' },
    { ...frame, history: { from: 11, through: 12, at: 10.25 } },
    { ...frame, history: { from: 0, through: 10, at: 10.25 } },
    { ...frame, history: { from: 0, through: 12, at: 8 } },
    { ...frame, visibility: 'all' }, { ...frame, faction: 'unknown' },
  ]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(invalid)));
    await assert.rejects(historicalApi(session, 10.25), /Unsupported historical/);
  }
});

test('history preserves 401 rejection status and supports caller cancellation', async t => {
  const { historicalApi } = await import('./network');
  const session = { url: 'https://belt.example', token: 'revoked', id: 'operation' };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ issues: [{ message: { detail: 'Seat revoked.' } }] }), { status: 401 }));
  await assert.rejects(historicalApi(session, 1), error => error instanceof RejectedCommand && error.status === 401 && error.message === 'Seat revoked.');
  await assert.rejects(historicalApi(session, Infinity), /finite historical hour/);
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(new Error('Canceled.')));
  }));
  const pending = historicalApi(session, 1, controller.signal);
  controller.abort();
  await assert.rejects(pending, /Canceled/);
});

test('configured seats accept catalog members and reject seats outside the operation roster', async t => {
  const { historicalApi } = await import('./network');
  const session = { url: 'https://belt.example', token: 'secret', id: 'generic-operation-id' };
  const game = JSON.parse(JSON.stringify(createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 73)).replaceAll('"vesper"', '"zenith"'));
  const frame = { ...testSnapshot(session.id, 'zenith', game), history: { from: 0, through: 12, at: 10 } };
  let response: unknown = frame;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(response)));
  assert.deepEqual(await api(session, 'games/generic-operation-id'), frame);
  assert.deepEqual(await historicalApi(session, 10), frame);
  for (const faction of ['vesper', 'inactive', 'unknown']) {
    response = { ...frame, faction };
    await assert.rejects(api(session, 'games/generic-operation-id'), /Unsupported server response/);
    await assert.rejects(historicalApi(session, 10), /Unsupported historical/);
  }
  response = { ...frame, id: 'other-operation' };
  await assert.rejects(historicalApi(session, 10), /Unsupported historical/);
  for (const faction of ['you', 'vesper', 'null']) {
    response = { ...testSnapshot(session.id, faction as Faction), history: frame.history };
    await api(session, 'games/generic-operation-id');
    await historicalApi(session, 10);
  }
  response = { ...testSnapshot(session.id), faction: 'zenith' };
  await assert.rejects(api(session, 'games/generic-operation-id'), /Unsupported server response/);
});

test('creation sends validated explicit options and preserves the legacy omitted-options request', async t => {
  const { creationPayload } = await import('./network');
  assert.deepEqual(creationPayload(), {});
  assert.deepEqual(creationPayload(undefined, undefined, 'gold'), { preferredColor: 'gold' });
  assert.throws(() => creationPayload(undefined, undefined, 'invalid' as never), /known player color/);
  const options = { playerCount: 10, mode: 'domination' as const };
  const payload = creationPayload(options);
  options.playerCount = 2;
  assert.deepEqual(payload, { options: { playerCount: 10, mode: 'domination' } });
  for (const value of [{ playerCount: 1, mode: 'mining' }, { playerCount: 11, mode: 'mining' }, { playerCount: 2.5, mode: 'mining' }, { playerCount: 3, mode: 'other' }, null]) {
    assert.throws(() => creationPayload(value as any), /Choose 2–10 players/);
  }
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body as string), { options: { playerCount: 10, mode: 'domination' } });
    return new Response(JSON.stringify(testSnapshot('new-operation')));
  });
  await api({ url: 'https://belt.example', token: 'secret' }, 'games', payload);
});

test('pending schedule edits send authenticated manifests with omitted and empty selections intact', async t => {
  const session = { url: 'https://belt.example', token: 'seat-token', id: 'operation' };
  const frame = testSnapshot(session.id);
  for (const specialists of [undefined, [] as string[], ['unit-alias']]) {
    const pending: import('./client').Pending = { kind: 'edit-schedule', body: { requestId: 'unique-request-id', revision: 3, planId: 'queued-launch-id', drones: 4, ...(specialists === undefined ? {} : { specialists }) } };
    t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
      assert.equal(url, 'https://belt.example/v1/games/operation/edit-schedule');
      assert.equal(options.method, 'POST');
      assert.equal((options.headers as Record<string, string>).Authorization, 'Bearer seat-token');
      assert.deepEqual(JSON.parse(options.body as string), pending.body);
      return new Response(JSON.stringify(frame));
    });
    assert.deepEqual(await api(session, `games/${session.id}/${pending.kind}`, pending.body), frame);
  }
});

test('sensors.v1 accepts additive hidden ownership in live and history while retaining legacy omission', async t => {
  const { historicalApi } = await import('./network');
  const session = { url: 'https://belt.example', token: 'seat', id: 'operation' };
  for (const owner of [undefined, null, 'vesper']) {
    const rock = { id: 'remote', name: 'Remote', x: 90, y: 90, known: false, kind: 'unknown', ...(owner === undefined ? {} : { owner }) };
    const frame = { ...testSnapshot(session.id), history: { from: 0, through: 4, at: 4 }, game: { ...testSnapshot().game, rocks: [rock] } };
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(frame)));
    assert.deepEqual((await api(session, 'games/operation')).game.rocks, [rock]);
    assert.deepEqual((await historicalApi(session, 4)).game.rocks, [rock]);
  }
});

test('reference sidecars are optional but cannot identify objects outside the returned observation', async t => {
  const { historicalApi } = await import('./network');
  const session = { url: 'https://belt.example', token: 'seat', id: 'operation' };
  const references = { version: 1, outposts: [{ id: 'remote', ref: 'a'.repeat(64) }], haulers: [{ id: 999, ref: 'b'.repeat(64) }] };
  const frame = { ...testSnapshot(session.id), history: { from: 0, through: 4, at: 4 }, game: { ...testSnapshot().game, hour: 4,
    rocks: [{ id: 'remote', name: 'Remote', x: 90, y: 90, known: false, kind: 'unknown' }],
    fleets: [{ id: 999, owner: 'vesper', from: 'remote', to: 'remote', drones: 1, departed: 0, arrives: 9, route: { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } } }],
  }, references };
  let response: unknown = frame;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(response)));
  assert.deepEqual((await api(session, 'games/operation')).references, references);
  assert.deepEqual((await historicalApi(session, 4)).references, references);
  for (const invalid of [
    null, { ...references, version: 2 }, { ...references, secret: 'private' },
    { ...references, outposts: [{ id: 'not-observed', ref: 'a'.repeat(64) }] },
    { ...references, haulers: [{ id: 1000, ref: 'b'.repeat(64) }] },
    { ...references, haulers: [{ id: 999, ref: 'not-a-digest' }] },
    { ...references, haulers: [...references.haulers, ...references.haulers] },
    { ...references, outposts: [{ id: 'remote', ref: 'b'.repeat(64) }] },
  ]) {
    response = { ...frame, references: invalid };
    await assert.rejects(api(session, 'games/operation'), /Unsupported server/);
    await assert.rejects(historicalApi(session, 4), /Unsupported historical/);
  }
  response = { ...frame, references: undefined };
  assert.equal((await historicalApi(session, 4)).references, undefined);
});

test('a connected operation rejects live frames from a different operation', async t => {
  const session = { url: 'https://belt.example', token: 'seat', id: 'expected-operation' };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(testSnapshot('other-operation'))));
  await assert.rejects(api(session, 'games/expected-operation'), /Unsupported server/);
});

test('successful responses must contain the live envelope and the observed game before reaching the screen', async t => {
  const session = { url: 'https://belt.example', token: 'seat', id: 'operation' };
  let response: unknown = {
    id: session.id, visibility: 'sensors.v1', faction: 'you', messages: [], game: { scheduled: [] },
  };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(response)));
  await assert.rejects(api(session, 'games/operation'), /Unsupported server response/);
  for (const key of ['invite', 'status', 'host', 'members', 'revision', 'serverTime']) {
    const missing: Record<string, unknown> = { ...testSnapshot(session.id) };
    delete missing[key]; response = missing;
    await assert.rejects(api(session, 'games/operation'), /Unsupported server response/, key);
  }
  for (const key of ['hour', 'epoch', 'rocks', 'fleets', 'cargo', 'eliminated', 'winner', 'scheduled', 'events', 'coverage', 'uncertain', 'interceptionUncertain']) {
    const frame = testSnapshot(session.id);
    const game: Record<string, unknown> = { ...frame.game };
    delete game[key]; response = { ...frame, game };
    await assert.rejects(api(session, 'games/operation'), /Unsupported server response/, key);
  }
});

test('live and historical responses reject malformed observed assets, schedules, and optional state at the boundary', async t => {
  const { historicalApi } = await import('./network');
  const session = { url: 'https://belt.example', token: 'seat', id: 'operation' };
  const frame = { ...testSnapshot(session.id, 'you', dispatch(createGame(0), 'c', 'b', 1, 'you')), history: { from: 0, through: 2, at: 1 } };
  const rock = frame.game.rocks.find(r => r.known)!;
  const fleet = frame.game.fleets[0]!;
  const patches: object[] = [
    { rocks: [null] }, { rocks: [{ ...rock, x: 'near' }] }, { rocks: [{ ...rock, owner: 'unknown' }] },
    { rocks: [{ ...rock, drones: -1 }] }, { rocks: [{ ...rock, kind: 'unsupported' }] }, { rocks: [{ ...rock, kind: 'unknown' }] },
    { rocks: [{ ...rock, specialists: [null] }] }, { rocks: [{ ...rock, module: 'unsupported' }] },
    { rocks: [{ ...rock, shield: 'full' }] }, { rocks: [{ ...rock, known: 'yes' }] },
    { rocks: [{ ...rock, drift: { origin: {}, velocity: {} } }] }, { rocks: [rock, rock] },
    { fleets: [null] }, { fleets: [{ ...fleet, id: 'one' }] }, { fleets: [{ ...fleet, owner: 'unknown' }] },
    { fleets: [{ ...fleet, drones: 'many' }] }, { fleets: [{ ...fleet, arrives: null }] },
    { fleets: [{ ...fleet, route: { from: {}, to: {} } }] }, { fleets: [{ ...fleet, specialists: [null] }] },
    { fleets: [{ ...fleet, pendingCourse: {} }] }, { fleets: [fleet, fleet] },
    { scheduled: [null] }, { scheduled: [{ id: 'plan' }] }, { scheduled: [{ id: 'plan', owner: 'you', executeAt: 1, action: {} }] },
    { events: [null] }, { events: [{ hour: 0, message: {} }] }, { coverage: [{}] },
    { cargo: { you: 'zero' } }, { eliminated: ['unknown'] }, { winner: 'unknown' }, { version: 3 },
    { recruitment: { you: { used: 0, offers: ['unsupported'] } } }, { funding: [{ from: 'you' }] },
    { standings: { you: { cargo: 0 } } }, { minesDrilled: { you: -1 } }, { forecastUncertain: 'yes' },
    { rules: { players: [] } }, { rules: { players: ['you', 'you'] } },
  ];
  let response: unknown = frame;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(response)));
  await api(session, 'games/operation'); await historicalApi(session, 1);
  for (const game of patches) {
    response = { ...frame, game: { ...frame.game, ...game } };
    await assert.rejects(api(session, 'games/operation'), /Unsupported server response/, JSON.stringify(game));
    await assert.rejects(historicalApi(session, 1), /Unsupported historical server response/, JSON.stringify(game));
  }
});

test('live and account responses validate diplomacy, recovery, inactivity, and available history metadata', async t => {
  const { accountSessionApi } = await import('./network');
  const session = { url: 'https://belt.example', token: 'seat', id: 'operation' };
  const frame = testSnapshot(session.id);
  const changes: object[] = [
    { status: 'unknown' }, { host: 'yes' }, { members: ['you', 'unknown'] }, { members: ['you', 'you'] },
    { revision: -1 }, { serverTime: null }, { messages: [{}] }, { messages: [null] },
    { groups: [{}] }, { channels: [{}] }, { recoveryEnabled: 'yes' },
    { inactivity: {} }, { inactivity: { expiresAt: 'tomorrow' } },
    { history: {} }, { history: { from: 2, through: 1 } },
  ];
  let response: unknown = frame;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(response)));
  for (const change of changes) {
    response = { ...frame, ...change };
    await assert.rejects(api(session, 'games/operation'), /Unsupported server response/, JSON.stringify(change));
    response = { snapshot: response };
    await assert.rejects(accountSessionApi(session), /Unsupported server response/, JSON.stringify(change));
  }
  response = { snapshot: null };
  assert.equal(await accountSessionApi(session), null);
  response = { snapshot: { ...frame, id: 'another-operation' } };
  await assert.rejects(accountSessionApi(session), /Unsupported server response/, 'saved operation identity remains bound during account restoration');
  assert.equal((await accountSessionApi({ url: session.url, token: session.token }))!.id, 'another-operation', 'a new account connection can restore its assigned operation');
});

test('pulse observations retain redacted Kings and reject malformed strategic or tactical state', async t => {
  const { historicalApi } = await import('./network');
  const session = { url: 'https://belt.example', token: 'seat', id: 'operation' };
  const frame = { ...testSnapshot(session.id, 'you', createConfiguredGame({ playerCount: 3, mode: 'pulse', beltCompact: true, driftingBases: true }, 0, 73)), history: { from: 0, through: 1, at: 0 } };
  let response: unknown = frame;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(response)));
  assert.deepEqual(await api(session, 'games/operation'), frame);
  assert.deepEqual(await historicalApi(session, 0), frame);
  assert.ok(frame.game.pulse!.kings.length < 3, 'unobserved Kings remain redacted');
  const pulse = frame.game.pulse!;
  for (const invalid of [
    undefined, null, {}, { ...pulse, kings: [null] }, { ...pulse, pulses: [{}] },
    { ...pulse, shields: { invalid: {} } }, { ...pulse, modifiers: [{}] },
    { ...pulse, tactical: undefined }, { ...pulse, tactical: null },
    { ...pulse, tactical: { ...pulse.tactical, charges: [{}] } },
    { ...pulse, tactical: { ...pulse.tactical, waves: [{}] } },
    { ...pulse, tactical: { ...pulse.tactical, resistance: { king: 'later' } } },
  ]) {
    response = { ...frame, game: { ...frame.game, pulse: invalid } };
    await assert.rejects(api(session, 'games/operation'), /Unsupported server response/);
    await assert.rejects(historicalApi(session, 0), /Unsupported historical server response/);
  }
});

test('malformed error envelopes retain status-based rejection semantics and a safe message', async t => {
  const session = { url: 'https://belt.example', token: 'seat', id: 'operation' };
  for (const status of [409, 429, 503]) for (const body of [null, [], { issues: [{}] }, { issues: [{ issue: {}, message: { detail: {} } }] }]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), { status }));
    await assert.rejects(api(session, 'games/operation', {}), error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'Command was not accepted.');
      assert.equal(error instanceof RejectedCommand, status === 409);
      if (error instanceof RejectedCommand) { assert.equal(error.status, status); assert.equal(error.issue, undefined); }
      return true;
    });
  }
});

test('decoders preserve legacy, diplomacy, charging, tactical-wave, and strategic-pulse wire data', async t => {
  const { historicalApi } = await import('./network');
  const session = { url: 'https://belt.example', token: 'seat', id: 'operation' };
  let charging = createConfiguredGame({ playerCount: 3, mode: 'pulse', driftingBases: true }, 0, 73);
  charging.cargo.you = 1000;
  charging.rocks.find(rock => rock.owner === 'you')!.specialists!.push({ id: 'disruptor-test', kind: 'disruptor', owner: 'you' });
  charging = commandPulse(charging, 'you', { id: 'charge-request-00001', action: 'START_CHARGE' });
  charging = commandTacticalPulse(charging, 'you', { id: 'tactical-request-0001', action: 'CHARGE_DISRUPTOR', specialistId: 'disruptor-test', resourceCost: 10 });
  const ready = advance(charging, 6, { rivals: false });
  const games = [createLegacyGame(0), createGame(0), charging, advance(charging, .25, { rivals: false }),
    advance(charging, .5, { rivals: false }), commandPulse(ready, 'you', { id: 'fire-request-0000001', action: 'FIRE_PULSE' })];
  let response: unknown;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(response)));
  for (const game of games) {
    const frame = { ...testSnapshot(session.id, 'you', game), recoveryEnabled: true, inactivity: { expiresAt: 100 },
      history: { from: 0, through: game.hour, at: game.hour }, extension: 'additive fields remain compatible',
      messages: [{ id: 1, from: 'vesper', to: 'you', text: 'Bilateral', sentAt: 0 }],
      groups: [{ id: 'private', name: 'Pact', members: ['you', 'vesper'], createdBy: 'you', createdAt: 0 }],
      channels: [{ id: 'public', kind: 'public', messages: [] }, { id: 'private', kind: 'private', messages: [{ id: 'message', from: 'vesper', text: 'Private', sentAt: 0 }] }],
    };
    response = frame;
    const expected = JSON.parse(JSON.stringify(frame));
    assert.deepEqual(await api(session, 'games/operation'), expected);
    assert.deepEqual(await historicalApi(session, game.hour), expected);
    if (game.version === 1) {
      response = { ...frame, game: { ...frame.game, version: undefined } };
      await api(session, 'games/operation');
    }
    response = { ...frame, recoveryEnabled: undefined, inactivity: undefined, groups: undefined, channels: undefined };
    await api(session, 'games/operation');
  }
});
