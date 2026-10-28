import { createLegacyGame } from '../src/game/legacy';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { GameService } from './service';
import { createApi } from './http';
import type { GiftOrder, Snapshot } from '../src/online/protocol';

test('HTTP gifts authorize observed support, deduplicate, preserve ownership across restart, and settle offline', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-gifts-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'game.json'); let now = 0;
  const server = createApi(await GameService.open(file, () => now, createLegacyGame));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const tokens = Array.from({ length: 3 }, () => randomBytes(32).toString('hex'));
  async function post(path: string, seat: number, payload: unknown) {
    const response = await fetch(`${url}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${tokens[seat]}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return { status: response.status, data: await response.json() as Snapshot };
  }
  const created = (await post('games', 0, {})).data; const base = `games/${created.id}`;
  const gift: GiftOrder = { requestId: randomUUID(), revision: 0, from: 'a', to: 'b', drones: 20, recipient: 'vesper', carryModule: true };
  assert.equal((await post(`${base}/gifts`, 0, gift)).status, 409);
  await post('join', 1, { invite: created.invite }); await post('join', 2, { invite: created.invite });
  const started = (await post(`${base}/start`, 0, {})).data;
  await post(`${base}/orders`, 1, { requestId: randomUUID(), revision: 0, from: 'f', to: 'b', drones: 30 });
  now = 5 * 3_600_000;
  const built = (await post(`${base}/modules`, 0, { requestId: randomUUID(), revision: started.revision, rock: 'a', module: 'routing' })).data;
  gift.revision = built.revision;
  assert.equal(built.game.rocks[1]!.owner, 'vesper');
  for (const invalid of [
    { to: 'e' }, { to: 'd' }, { recipient: 'you' }, { recipient: '__proto__' }, { recipient: null },
    { from: 'e' }, { drones: 1000 }, { drones: 1.5 }, { carryModule: 'yes' }, { revision: 0 },
  ]) assert.equal((await post(`${base}/gifts`, 0, { ...gift, ...invalid, requestId: randomUUID() })).status, 409, JSON.stringify(invalid));
  assert.equal((await post(`${base}/gifts`, 2, { ...gift, revision: 0 })).status, 409);
  assert.equal((await post(`${base}/gifts`, 3, gift)).status, 401);
  const results = await Promise.all([post(`${base}/gifts`, 0, gift), post(`${base}/gifts`, 0, gift)]);
  assert.ok(results.every(r => r.status === 200));
  const sent = results[0]!.data;
  assert.equal(sent.game.rocks[0]!.drones, 90 + 20 - 24 - 20);
  assert.equal(sent.game.rocks[0]!.module, undefined);
  assert.equal(sent.game.fleets.length, 1);
  assert.equal(sent.game.fleets[0]!.owner, 'vesper');
  assert.equal(sent.game.fleets[0]!.module, 'routing');
  assert.equal(sent.game.fleets[0]!.arrives, 7);
  assert.equal((await post(`${base}/gifts`, 0, { ...gift, drones: 21 })).status, 409);
  assert.equal((await post(`${base}/orders`, 0, gift)).status, 409, 'a gift receipt cannot be reused as an attack');
  const resumed = await GameService.open(file, () => now, createLegacyGame);
  const received = await resumed.snapshot(created.id, tokens[1]!);
  assert.equal(received.revision, 2, 'receiving new owned assets invalidates a previous recipient command revision');
  assert.equal(received.game.fleets[0]!.owner, 'vesper');
  assert.ok(received.game.events.some(e => e.message.includes('gifted')));
  assert.ok(!(await resumed.snapshot(created.id, tokens[2]!)).game.events.some(e => e.message.includes('gifted')));
  assert.equal((await resumed.snapshot(created.id, tokens[2]!)).game.fleets.length, 0);
  assert.equal((await resumed.gift(created.id, tokens[0]!, gift)).game.fleets.length, 1);
  now = 8 * 3_600_000;
  const arrival = await resumed.snapshot(created.id, tokens[1]!);
  assert.equal(arrival.game.rocks[1]!.owner, 'vesper');
  assert.equal(arrival.game.rocks[1]!.drones, 36);
  assert.equal(arrival.game.rocks[1]!.module, 'routing');
  assert.equal(arrival.game.fleets.length, 0);
});
