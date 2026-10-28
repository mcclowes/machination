import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createGame } from '../src/game/simulation';
import { GameService } from './service';
import { createApi } from './http';
import type { FundingOrder, Snapshot } from '../src/online/protocol';

test('HTTP funding authorizes sponsors, hides unrelated identities, retries once, persists, and expires offline', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-funding-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'world.json'); let now = 0;
  const factory = (epoch = 0) => {
    const game = createGame(epoch); game.cargo.you = 20;
    const mine = game.rocks.find(r => r.id === 'f')!; mine.kind = 'mine'; mine.miningAt = 1;
    return game;
  };
  const tokens = Array.from({ length: 3 }, () => randomBytes(32).toString('hex'));
  let service = await GameService.open(file, () => now, factory);
  const created = await service.create(tokens[0]!);
  await service.join(created.invite, tokens[1]!); await service.join(created.invite, tokens[2]!);
  await service.start(created.id, tokens[0]!);
  const server = createApi(service); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}/v1/games/${created.id}/funding`;
  async function post(token: string, body: unknown) {
    const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { response, data: await response.json() as Snapshot };
  }
  const start = await service.snapshot(created.id, tokens[0]!);
  const command: FundingOrder = { requestId: randomUUID(), revision: start.revision, recipient: 'vesper', enabled: true };
  const funded = await post(tokens[0]!, command); assert.equal(funded.response.status, 200);
  assert.deepEqual(funded.data.game.funding, [{ from: 'you', to: 'vesper' }]);
  assert.equal((await post(tokens[0]!, command)).data.revision, funded.data.revision);
  assert.equal((await post(tokens[0]!, { ...command, recipient: 'null' })).response.status, 409);
  assert.equal((await post('0'.repeat(64), command)).response.status, 401);
  const stranger = await service.snapshot(created.id, tokens[2]!);
  assert.deepEqual(stranger.game.funding, []); assert.equal(stranger.game.standings!.vesper!.funders, 1);
  assert.equal((await post(tokens[2]!, { ...command, requestId: randomUUID(), revision: stranger.revision, from: 'you' })).response.status, 409);
  const recipient = await service.snapshot(created.id, tokens[1]!);
  assert.deepEqual(recipient.game.funding, [{ from: 'you', to: 'vesper' }]);
  service = await GameService.open(file, () => now);
  assert.deepEqual((await service.snapshot(created.id, tokens[0]!)).game.funding, funded.data.game.funding);
  now = 3_600_000;
  const expired = await service.snapshot(created.id, tokens[0]!);
  assert.deepEqual(expired.game.funding, []);
  assert.equal(expired.game.standings!.vesper!.funders, 0);
  assert.equal(expired.game.events.filter(e => e.message.includes('Funding from you to vesper ended')).length, 1);
  assert.deepEqual((await service.funding(created.id, tokens[0]!, command)).game.funding, []);
});
