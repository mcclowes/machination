import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { GameService } from './service';
import { createConfiguredGame } from '../src/game/world';
import { forecastObservation, type GameView } from '../src/game/visibility';

for (const revision of [12, 13] as const) {
  test(`Saboteur continuation retains its rules through forecast, retry, history, and restart: r${revision}`, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'machination-saboteur-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, 'world.json');
    let now = 0, source = '', target = '';
    const initial = () => {
      const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 2026);
      game.rules!.mechanicsVersion = revision;
      for (const site of game.rocks) { site.productionAt = 1000; site.shieldAt = 1000; site.shieldsDisabled = true; site.y = 60; }
      const a = game.rocks.find(site => site.owner === 'you' && !site.coreOf)!;
      const b = game.rocks.find(site => site.owner === 'vesper' && !site.coreOf)!;
      source = a.id; target = b.id;
      Object.assign(a, { x: 10, y: 20, drones: 20, specialists: [{ id: 'durable-saboteur', kind: 'saboteur', owner: 'you' }] });
      Object.assign(b, { x: 50, y: 20, drones: 30 });
      Object.assign(game.rocks.find(site => site.coreOf === 'you')!, { x: 10, y: 20 });
      Object.assign(game.rocks.find(site => site.coreOf === 'vesper')!, { x: 50, y: 20 });
      // Keep the rival's return homes observed so this forecast has no hidden routing choice.
      for (const site of game.rocks.filter(site => site.owner === 'vesper')) Object.assign(site, { x: 50, y: 20 });
      Object.assign(game.rocks.find(site => site.owner === 'you' && site.id !== source && !site.coreOf)!, { x: 50, y: 21 });
      return game;
    };
    let service = await GameService.open(file, () => now, initial);
    const host = randomBytes(32).toString('hex'), guest = randomBytes(32).toString('hex');
    const room = await service.create(host); await service.join(room.invite, guest); await service.start(room.id, host);
    now = 24 * 3_600_000;
    const ready = await service.snapshot(room.id, host);
    const saboteur = ready.game.rocks.find(site => site.id === source)!.specialists!.find(unit => unit.kind === 'saboteur')!;
    const order = { requestId: randomUUID(), revision: ready.revision, from: source, to: target, drones: 20, specialists: [saboteur.id] };
    await service.order(room.id, host, order);
    const rival = await service.snapshot(room.id, guest);
    await service.order(room.id, guest, { requestId: randomUUID(), revision: rival.revision, from: target, to: source, drones: 30 });
    now = 24.2 * 3_600_000;
    const moving = await service.snapshot(room.id, host);
    const combat = (view: GameView) => view.fleets.map(fleet => ({ owner: fleet.owner, drones: fleet.drones,
      returning: fleet.returning, to: fleet.to, captives: (fleet.specialists ?? []).filter(unit => unit.captive).length }));
    const forecast = forecastObservation(moving.game, 'you', 26.7);
    assert.equal(forecast.fleets.filter(fleet => fleet.drones > 0).length, revision === 13 ? 1 : 2);
    const survivor = forecast.fleets.find(fleet => fleet.owner === 'vesper' && fleet.drones > 0)!;
    assert.equal(survivor.drones, revision === 13 ? 10 : 30);
    assert.equal(survivor.returning, true);
    assert.equal(forecast.fleets.flatMap(fleet => fleet.specialists ?? []).filter(unit => unit.captive).length, revision === 13 ? 1 : 0);
    now = 26.7 * 3_600_000;
    const current = await service.snapshot(room.id, host);
    assert.deepEqual(combat(current.game), combat(forecast));
    assert.deepEqual((await service.history(room.id, host, 26.7)).game, current.game);
    service = await GameService.open(file, () => now, initial);
    assert.deepEqual((await service.snapshot(room.id, host)).game, current.game);
    assert.deepEqual((await service.order(room.id, host, order)).game, current.game);
  });
}
