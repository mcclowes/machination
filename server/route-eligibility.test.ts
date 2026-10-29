import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { GameService } from './service';
import { createConfiguredGame } from '../src/game/world';
import { forecastObservation } from '../src/game/visibility';

for (const redirected of [false, true]) {
  test(`route eligibility survives retry, observed history, forecasts, and disk restart: redirected=${redirected}`, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'machination-route-pairs-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, 'world.json');
    let now = 0, a = '', b = '', c = '', d = '';
    const initial = () => {
      const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 2026);
      for (const site of game.rocks) { site.productionAt = 1000; site.shieldAt = 1000; site.shieldsDisabled = true; }
      const [source, target, other] = game.rocks.filter(site => site.owner === 'you' && !site.coreOf);
      const enemy = game.rocks.find(site => site.owner === 'vesper' && !site.coreOf)!;
      a = source!.id; b = target!.id; c = enemy.id; d = other!.id;
      Object.assign(source!, { x: 0, y: 20, drones: 40, ...(redirected ? { specialists: [{ id: 'route-navigator', kind: 'navigator', owner: 'you' }] } : {}) });
      Object.assign(target!, { x: 40, y: 20 });
      Object.assign(enemy, { x: 30, y: 20, ...(redirected ? { specialists: [{ id: 'route-assassin', kind: 'assassin', owner: 'vesper' }] } : {}) });
      Object.assign(other!, { x: redirected ? 40 : 10, y: 20 });
      return game;
    };
    let service = await GameService.open(file, () => now, initial);
    const host = randomBytes(32).toString('hex'), guest = randomBytes(32).toString('hex');
    const room = await service.create(host); await service.join(room.invite, guest); await service.start(room.id, host);
    now = 24 * 3_600_000;
    const ready = await service.snapshot(room.id, host);
    const nav = ready.game.rocks.find(site => site.id === a)!.specialists?.find(unit => unit.kind === 'navigator');
    const order = { requestId: randomUUID(), revision: ready.revision, from: a, to: b, drones: 10, ...(nav ? { specialists: [nav.id] } : {}) };
    const sent = await service.order(room.id, host, order);
    const id = sent.game.fleets[0]!.id;
    let foreign = await service.snapshot(room.id, guest);
    const assassin = foreign.game.rocks.find(site => site.id === c)!.specialists?.find(unit => unit.kind === 'assassin');
    await service.order(room.id, guest, { requestId: randomUUID(), revision: foreign.revision, from: c, to: redirected ? a : d, drones: 7, ...(assassin ? { specialists: [assassin.id] } : {}) });
    now = 24.5 * 3_600_000;
    let moving = await service.snapshot(room.id, host);
    if (redirected) {
      moving = await service.hauler(room.id, host, { requestId: randomUUID(), revision: moving.revision, fleet: id, action: 'course', to: d });
      assert.equal(moving.game.fleets.find(fleet => fleet.id === id)!.courseChanged, undefined);
      foreign = await service.snapshot(room.id, guest);
      assert.ok(foreign.game.fleets.every(fleet => !fleet.pendingCourse && !fleet.courseChanged));
      await service.order(room.id, guest, { requestId: randomUUID(), revision: foreign.revision, from: c, to: a, drones: 1 });
    } else {
      assert.deepEqual(forecastObservation(moving.game, 'you', 26.1).fleets.map(fleet => fleet.drones), [10, 7]);
    }
    now = 26.1 * 3_600_000;
    const current = await service.snapshot(room.id, host);
    assert.equal(current.game.fleets.find(fleet => fleet.id === id)!.drones, redirected ? 3 : 10);
    assert.equal(current.game.fleets.find(fleet => fleet.id === id)!.courseChanged, redirected ? true : undefined);
    if (redirected) assert.deepEqual(current.game.fleets.find(fleet => fleet.id === id)!.specialists, []);
    else assert.deepEqual(current.game.fleets.map(fleet => fleet.drones), [10, 7]);
    assert.equal((await service.history(room.id, host, 26.1)).game.fleets.find(fleet => fleet.id === id)!.drones, redirected ? 3 : 10);
    service = await GameService.open(file, () => now, initial);
    assert.deepEqual((await service.snapshot(room.id, host)).game, current.game);
    assert.deepEqual((await service.order(room.id, host, order)).game, current.game);
    if (redirected) {
      assert.equal(forecastObservation(current.game, 'you', 26.4).fleets.find(fleet => fleet.id === id)!.drones, 2);
      now = 26.4 * 3_600_000;
      const after = await service.snapshot(room.id, host);
      assert.equal(after.game.fleets.find(fleet => fleet.id === id)!.drones, 2);
      assert.equal(after.game.fleets.find(fleet => fleet.id === id)!.courseChanged, true);
      service = await GameService.open(file, () => now, initial);
      assert.deepEqual((await service.snapshot(room.id, host)).game, after.game);
    }
  });
}
