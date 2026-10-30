import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game/simulation';
import type { Database, Room } from './database';
import { claimSends, enqueue, enqueueIncoming, seatGeneration, type IncomingRenderer } from './notifications';

test('mixed claims discard obsolete incoming alerts before spending the batch limit and preserve each notification kind', () => {
  const room: Room = {
    id: 'operation', invite: 'invite', startedAt: null, revision: 0, game: createGame(0),
    seats: [{ faction: 'you', hash: 'a'.repeat(64) }], messages: [], receipts: {},
  };
  const binding = {
    id: 'b'.repeat(32), roomId: room.id, faction: 'you' as const, deviceId: 'c'.repeat(64),
    generation: seatGeneration(room.seats[0]!), revision: 1, enabled: true, incoming: true as const,
    token: 'ExponentPushToken[test]', updatedAt: 0, requests: [],
  };
  const db: Database = { version: 1, rooms: [room], notifications: { bindings: [binding], jobs: [] } };
  const now = 1_000;
  assert.equal(enqueueIncoming(db, room.id, [
    { faction: 'you', fleet: 1, key: '1|obsolete', firstHour: 0, arrivesAt: 5_000 },
    { faction: 'you', fleet: 2, key: '2|fresh', firstHour: 0, arrivesAt: 5_000 },
  ], now), 2);
  assert.equal(enqueue(db, room, ['you'], 'message:1', now), 1);
  const rendered: number[] = [];
  const render = (job: Parameters<IncomingRenderer>[0]) => {
    rendered.push(job.alert.fleet);
    return job.alert.fleet === 1 ? undefined : { body: '' };
  };
  const first = claimSends(db, 'worker', now, 1, render);
  assert.deepEqual(rendered, [1, 2]);
  assert.equal(first.items.length, 1);
  const attack = first.items[0]!.message;
  assert.equal(attack.body, '', 'an empty rendered body is retained');
  assert.equal(attack.data.kind, 'machination.incoming');
  assert.equal(attack.channelId, 'machination-alerts');
  assert.equal(attack.ttl, 4);
  assert.ok(!db.notifications!.jobs.some(job => job.alert?.fleet === 1), 'obsolete work is removed');
  const second = claimSends(db, 'worker', now, 1, render);
  assert.deepEqual(rendered, [1, 2], 'ordinary messages never call the incoming renderer');
  assert.equal(second.items.length, 1);
  const message = second.items[0]!.message;
  assert.equal(message.body, 'New transmission received.');
  assert.equal(message.data.kind, 'machination.message');
  assert.equal(message.channelId, 'machination-messages');
  for (const claim of [first, second]) {
    const item = claim.items[0]!;
    assert.equal(item.message.collapseId, item.jobId);
    assert.equal(item.message.tag, item.jobId);
    assert.deepEqual(Object.keys(item.message.data).sort(), ['bindingId', 'gameId', 'kind', 'notificationId', 'version']);
    assert.equal(db.notifications!.jobs.find(job => job.id === item.jobId)!.attempts, 1);
  }
  assert.deepEqual(claimSends(db, 'other-worker', now).items, [], 'live leases prevent duplicate delivery');
});
