import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { GameService } from './service';
import { createPreCargoGame as createConfiguredGame } from '../src/game/test-world';
import { advance } from '../src/game/simulation';
import { powerCapacity } from '../src/game/economy';

test('authoritative gift capacity survives retries, private observations, history, and restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-gift-cap-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'world.json'); let now = 0;
  let sourceId = '', targetId = '';
  const initial = () => {
    const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 73);
    for (const rock of game.rocks) { rock.productionAt = 1000; rock.shieldAt = 1000; rock.drones = 0; }
    const source = game.rocks.find(r => r.owner === 'you' && !r.coreOf)!;
    const target = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
    sourceId = source.id; targetId = target.id;
    Object.assign(source, { x: 20, y: 20, drones: 30 });
    Object.assign(target, { x: 68, y: 20, drones: powerCapacity(game, 'vesper') - 7 });
    return advance(game, 0);
  };
  let service = await GameService.open(file, () => now, initial);
  const host = randomBytes(32).toString('hex'), guest = randomBytes(32).toString('hex');
  const room = await service.create(host); await service.join(room.invite, guest);
  const started = await service.start(room.id, host);
  const command = { requestId: randomUUID(), revision: started.revision, from: sourceId, to: targetId, drones: 30, recipient: 'vesper' as const };
  const launched = await service.gift(room.id, host, command);
  assert.deepEqual((await service.gift(room.id, host, command)).game, launched.game);
  now = launched.game.fleets[0]!.arrives * 3_600_000;
  const received = await service.snapshot(room.id, guest);
  assert.equal(received.game.rocks.find(r => r.id === targetId)!.drones, 250);
  assert.equal(received.game.fleets.length, 0);
  const before = await service.history(room.id, guest, 0);
  assert.equal(before.game.rocks.find(r => r.id === targetId)!.drones, 243);
  service = await GameService.open(file, () => now, initial);
  assert.deepEqual((await service.snapshot(room.id, guest)).game, received.game);
  assert.deepEqual((await service.history(room.id, guest, received.game.hour)).game, received.game);
});
