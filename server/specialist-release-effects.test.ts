import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { GameService } from './service';
import { createConfiguredGame } from '../src/game/world';
import { maximumShield } from '../src/game/economy';
import type { Snapshot } from '../src/online/protocol';

for (const kind of ['admiral', 'tycoon', 'security', 'king'] as const) {
  test(`released ${kind} effects are authoritative at the command hour through retry, history, and restart`, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'machination-release-effects-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, 'world.json');
    let now = 0, heldId = '', sourceId = '', targetId = '', factoryId = '';
    const initial = () => {
      const game = createConfiguredGame({ playerCount: 3, mode: 'mining' }, 0, 2026);
      for (const site of game.rocks) { site.productionAt = 1000; site.shieldAt = 1000; }
      const held = game.rocks.find(site => site.owner === 'you' && !site.coreOf)!;
      const [source, target, factory] = game.rocks.filter(site => site.owner === 'vesper' && !site.coreOf);
      heldId = held.id; sourceId = source!.id; targetId = target!.id; factoryId = factory!.id;
      Object.assign(held, { x: 20, y: 20, specialists: [{ id: 'released-global', kind, owner: 'vesper', captive: true }] });
      Object.assign(source!, { x: 10, y: 10, drones: 40 });
      Object.assign(target!, { x: 49, y: 10 });
      Object.assign(factory!, { x: 10, y: 10, kind: 'factory', shieldMax: 10, productionAt: 32, drones: 0 });
      return game;
    };
    let service = await GameService.open(file, () => now, initial);
    const tokens = Array.from({ length: 3 }, () => randomBytes(32).toString('hex'));
    const room = await service.create(tokens[0]!);
    await service.join(room.invite, tokens[1]!); await service.join(room.invite, tokens[2]!);
    await service.start(room.id, tokens[0]!);
    now = 24 * 3_600_000;
    const donor = await service.snapshot(room.id, tokens[1]!);
    await service.order(room.id, tokens[1]!, { requestId: randomUUID(), revision: donor.revision, from: sourceId, to: targetId, drones: 10 });
    now = 24.5 * 3_600_000;
    const before = await service.snapshot(room.id, tokens[0]!);
    const captive = before.game.rocks.find(site => site.id === heldId)!.specialists!.find(unit => unit.kind === kind)!;
    assert.notEqual(captive.id, 'released-global');
    const measure = (snapshot: Pick<Snapshot, 'game'>) => {
      const factory = snapshot.game.rocks.find(site => site.id === factoryId)!;
      assert.ok(factory.known);
      const ordinary = snapshot.game.fleets.find(fleet => fleet.from === sourceId && fleet.to === targetId)!;
      return kind === 'admiral' ? ordinary.speed : kind === 'tycoon' ? factory.productionInterval : maximumShield(factory);
    };
    assert.equal(measure(before), kind === 'admiral' || kind === 'tycoon' ? 8 : 10);
    const foreign = await service.snapshot(room.id, tokens[1]!);
    await assert.rejects(() => service.specialist(room.id, tokens[1]!, { requestId: randomUUID(), revision: foreign.revision, action: 'release', unit: captive.id }));
    const request = { requestId: randomUUID(), revision: before.revision, action: 'release' as const, unit: captive.id };
    const released = await service.specialist(room.id, tokens[0]!, request);
    const expected = kind === 'admiral' ? 12 : kind === 'tycoon' ? 8 / 1.5 : kind === 'security' ? 20 : 0;
    assert.equal(measure(released), expected);
    assert.ok(released.game.fleets.some(fleet => fleet.returning && fleet.specialists?.some(unit => unit.id === captive.id && !unit.captive)));
    assert.deepEqual((await service.specialist(room.id, tokens[0]!, request)).game, released.game);
    const historical = await service.history(room.id, tokens[0]!, 24.5);
    assert.equal(measure(historical), expected);
    service = await GameService.open(file, () => now, initial);
    assert.deepEqual((await service.snapshot(room.id, tokens[0]!)).game, released.game);
    assert.deepEqual((await service.specialist(room.id, tokens[0]!, request)).game, released.game);
  });
}
