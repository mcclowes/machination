import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createGame } from '../src/game/simulation';
import { api, historicalApi, RejectedCommand } from '../src/online/network';
import type { Snapshot } from '../src/contracts/protocol';
import { GameService } from './service';
import { createApi } from './http';

// Only the initial scenario is arranged; captures and private plans use real commands.
const remoteBattle: typeof createGame = (...args) => {
  const game = createGame(...args);
  for (const rock of game.rocks) if (rock.owner === 'you') { rock.x = 0; rock.y = 0; }
  const source = game.rocks.find(r => r.id === 'f')!;
  Object.assign(source, { x: 80, y: 80, drones: 100 });
  Object.assign(game.rocks.find(r => r.id === 'h')!, { x: 85, y: 80, drones: 1 });
  Object.assign(game.rocks.find(r => r.id === 'p')!, { destroyed: true });
  return game;
};

test('v2 HTTP transports fresh remote third-party ownership through history, retries, and restart without widening authority', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-public-owner-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'world.json'); let now = 0;
  let service = await GameService.open(file, () => now, remoteBattle);
  let server = createApi(service);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const origin = () => `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const tokens = Array.from({ length: 4 }, () => randomBytes(32).toString('hex'));
  const session = (seat: number) => ({ url: origin(), token: tokens[seat]! });
  const created = await api(session(0), 'games', {});
  const path = `games/${created.id}`;
  const hidden = (view: Pick<Snapshot, 'game' | 'visibility'>, owner: string) => {
    assert.equal(view.visibility, 'sensors.v1');
    const rock = view.game.rocks.find(r => r.id === 'h')!;
    assert.deepEqual(rock, { id: 'h', name: 'Lacuna', x: 85, y: 80, kind: 'unknown', known: false, owner });
    const wreck = view.game.rocks.find(r => r.id === 'p')!;
    assert.deepEqual(wreck, { id: 'p', name: 'Ember', x: 85, y: 32, kind: 'unknown', known: false, owner: 'vesper' });
    assert.equal(view.game.rocks.find(r => r.id === 'j')!.owner, null);
    assert.deepEqual(view.game.scheduled, []);
    assert.deepEqual(view.game.fleets, []);
    assert.ok(!JSON.stringify(view).includes('core-vesper'));
  };
  hidden(created, 'null');
  await api(session(1), 'join', { invite: created.invite });
  await api(session(2), 'join', { invite: created.invite });
  const started = await api(session(0), `${path}/start`, {}); hidden(started, 'null');
  const rival = await api(session(1), path);
  const command = { requestId: randomUUID(), revision: rival.revision, from: 'f', to: 'h', drones: 80 };
  const launched = await api(session(1), `${path}/orders`, command);
  assert.equal(launched.game.fleets.length, 1);
  const queued = await api(session(1), `${path}/schedules`, { requestId: randomUUID(), revision: launched.revision, from: 'f', to: 'h', drones: 1, executeAt: 20 });
  assert.equal(queued.game.scheduled.length, 1);
  const group = await api(session(1), `${path}/groups`, { requestId: randomUUID(), name: 'Private war plan', members: ['vesper', 'null'] });
  const channelId = group.groups![0]!.id;
  await api(session(1), `${path}/channel-messages`, { requestId: randomUUID(), channelId, text: 'Future private attack' });
  const before = await api(session(0), path); hidden(before, 'null');
  now = 4 * 3_600_000;
  const captured = await api(session(0), `${path}?faction=vesper&visibility=all&forecast=24`);
  hidden(captured, 'vesper');
  assert.deepEqual(captured.game.coverage, before.game.coverage);
  assert.equal(captured.revision, started.revision);
  assert.deepEqual(captured.groups, []); assert.equal(captured.channels!.length, 1);
  assert.ok(!JSON.stringify(captured).includes('Future private attack'));
  assert.ok(!captured.game.events.some(e => /Lacuna|dispatched/.test(e.message)));
  const historySession = { ...session(0), id: created.id };
  hidden(await historicalApi(historySession, 0), 'null');
  hidden(await historicalApi(historySession, 4), 'vesper');
  hidden(await api(session(0), `${path}/activity`, {}), 'vesper');
  hidden(await api(session(0), `${path}/messages`, { requestId: randomUUID(), to: 'vesper', text: 'Hello' }), 'vesper');
  const recovery = randomBytes(32).toString('hex');
  hidden(await api(session(0), `${path}/recovery`, { requestId: randomUUID(), secret: recovery }), 'vesper');
  for (const [action, payload] of [
    ['orders', { from: 'h', to: 'f', drones: 1 }],
    ['sites', { rock: 'h', action: 'shields', disabled: true }],
    ['specialists', { action: 'release', unit: 'core-vesper' }],
    ['haulers', { action: 'cancel-launch', fleet: launched.game.fleets[0]!.id }],
    ['channel-messages', { channelId, text: 'Intrusion' }],
  ] as const) await assert.rejects(api(session(0), `${path}/${action}`, { requestId: randomUUID(), revision: captured.revision, ...payload }), error => error instanceof RejectedCommand);
  await assert.rejects(api(session(3), path));
  const receipts = JSON.parse(await readFile(file, 'utf8')).rooms[0].receipts;
  await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
  service = await GameService.open(file, () => now, remoteBattle); server = createApi(service);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  hidden(await api(session(0), path), 'vesper');
  const retried = await api(session(1), `${path}/orders`, command);
  assert.equal(retried.game.rocks.find(r => r.id === 'h')!.owner, 'vesper');
  assert.equal(retried.game.fleets.length, 0, 'retry cannot relaunch the captured fleet');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).rooms[0].receipts, receipts);
  hidden(await historicalApi({ ...session(0), id: created.id }, 0), 'null');
  hidden(await historicalApi({ ...session(0), id: created.id }, 4), 'vesper');
  const ownOrder = { requestId: randomUUID(), revision: captured.revision, from: 'c', to: 'm', drones: 1 };
  const actionReply = await api(session(0), `${path}/orders`, ownOrder);
  assert.deepEqual(actionReply.game.rocks.find(r => r.id === 'h'), captured.game.rocks.find(r => r.id === 'h'));
  assert.equal(actionReply.game.fleets.length, 1);
  assert.notEqual(actionReply.game.fleets[0]!.id, launched.game.fleets[0]!.id);
  const recovered = await api(session(3), `${path}/recover`, { secret: recovery });
  assert.deepEqual(recovered.game, actionReply.game);
  const ownRetry = await api(session(3), `${path}/orders`, { ...ownOrder, specialists: [], carryModule: false });
  assert.deepEqual(ownRetry.game, recovered.game, 'canonical optional manifest receipt survives recovery');
  await assert.rejects(api(session(0), path));
});
