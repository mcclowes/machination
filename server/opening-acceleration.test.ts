import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { GameService } from './service';
import { createPreCargoGame as createConfiguredGame } from '../src/game/test-world';
import { fleetPosition } from '../src/game/flight';
import { recruitmentStatus } from '../src/game/specialists';

test('opening travel and recruitment survive authoritative retries and restart at hour twelve', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-opening-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'world.json'); let now = 0;
  let sourceId = '', targetId = '';
  const initial = () => {
    const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 73);
    game.rules!.map.width = 200; game.rules!.map.height = 200;
    for (const rock of game.rocks) { rock.productionAt = 1000; rock.shieldAt = 1000; }
    const source = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
    const target = game.rocks.find(r => r.owner === null)!;
    sourceId = source.id; targetId = target.id;
    Object.assign(source, { x: 20, y: 20 }); Object.assign(target, { x: 36, y: 20 });
    return game;
  };
  let service = await GameService.open(file, () => now, initial);
  const host = randomBytes(32).toString('hex'), guest = randomBytes(32).toString('hex');
  const room = await service.create(host); await service.join(room.invite, guest); await service.start(room.id, host);
  now = (11 - 1 / 6) * 3_600_000;
  const ready = await service.snapshot(room.id, host);
  const command = { requestId: randomUUID(), revision: ready.revision, from: sourceId, to: targetId, drones: 10, carryModule: false };
  const sent = await service.order(room.id, host, command);
  assert.ok(Math.abs(sent.game.fleets[0]!.arrives - 12.5) < 1e-9);
  assert.deepEqual((await service.order(room.id, host, command)).game, sent.game);
  now = 12 * 3_600_000;
  const noon = await service.snapshot(room.id, host);
  assert.ok(Math.abs(fleetPosition(noon.game, noon.game.fleets[0]!).x - 32) < 1e-9);
  assert.equal(recruitmentStatus(noon.game, 'you').nextAt, 16);
  assert.equal(JSON.stringify(noon.game.rules).includes('"seed"'), false);
  service = await GameService.open(file, () => now, initial);
  assert.deepEqual((await service.snapshot(room.id, host)).game, noon.game);
  assert.deepEqual((await service.history(room.id, host, 12)).game, noon.game);
  now = sent.game.fleets[0]!.arrives * 3_600_000;
  const arrived = await service.snapshot(room.id, host);
  assert.equal(arrived.game.rocks.find(r => r.id === targetId)!.owner, 'you');
  assert.equal(arrived.game.rocks.find(r => r.id === targetId)!.drones, 10);
  assert.equal(arrived.game.fleets.length, 0);
});
