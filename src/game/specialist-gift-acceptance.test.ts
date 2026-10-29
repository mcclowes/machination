import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfiguredGame } from './world';
import { advance, type Game } from './simulation';
import { fleetPosition } from './flight';
import { worldDistance } from './geometry';
import { nextRouteEncounter } from './route-encounters';
import { createArchive, executeCommand, exportArchive, replayTo, restoreArchive, type GameCommand, type ReplayEntry } from './replay';
import { decodeSave } from './save-format';
import type { SpecialistKind } from './specialist-catalog';
import { workBetween } from './opening-clock';

// Authority: official Subs/Combat rules and Queen, Princess, and Admiral entries.
// https://subterfuge-game.com/rulebook/ and https://subterfuge-game.com/rulebook/Specialists.html
function fixture() {
  const baseline = createConfiguredGame({ playerCount: 2, mode: 'mining', driftingBases: false }, 0, 2026);
  const donor = baseline.rocks.filter(r => r.owner === 'you' && !r.coreOf);
  const recipient = baseline.rocks.filter(r => r.owner === 'vesper' && !r.coreOf);
  Object.assign(donor[0]!, { x: 20, y: 20, drones: 60 });
  Object.assign(recipient[0]!, { x: 68, y: 20, drones: 60 });
  for (const rock of baseline.rocks) { rock.productionAt = 1000; rock.shieldAt = 1000; }
  let game = baseline;
  const entries: ReplayEntry[] = [];
  return {
    baseline, donor, recipient,
    get game() { return game; },
    command(command: GameCommand) {
      entries.push({ hour: game.hour, command });
      game = executeCommand(game, command);
      return game.fleets.at(-1)!;
    },
    at(hour: number) { game = advance(game, hour, { rivals: false }); return game; },
    check() {
      assert.equal([...game.rocks, ...game.fleets].reduce((sum, a) => sum + a.drones, 0),
        baseline.rocks.reduce((sum, r) => sum + r.drones, 0));
      const data = { ...exportArchive(createArchive(baseline)), entries };
      assert.deepEqual(replayTo(restoreArchive(data), game.hour, { rivals: false, knownThrough: game.hour }), game);
      assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game, replay: data })).game, game);
    },
  };
}

for (const contact of ['outpost', 'sub'] as const) {
  test(`gifted Queen becomes recipient Princess and donor Princess succeeds at ${contact} contact`, () => {
    const f = fixture();
    const core = f.baseline.rocks.find(r => r.coreOf === 'you')!;
    Object.assign(core, { x: 20, y: 20 });
    const queen = core.specialists!.find(u => u.kind === 'queen')!;
    const recipientQueen = f.baseline.rocks.find(r => r.coreOf === 'vesper')!.specialists!.find(u => u.kind === 'queen')!;
    f.donor[1]!.specialists = [{ id: 'successor', kind: 'princess', owner: 'you' }];
    const gift = f.command({ type: 'gift', owner: 'you', recipient: 'vesper', from: core.id,
      to: f.recipient[0]!.id, drones: 0, specialists: [queen.id] });
    if (contact === 'sub') f.command({ type: 'dispatch', owner: 'vesper', from: f.recipient[0]!.id,
      to: core.id, drones: 13 });
    f.at(gift.departed);
    const allUnits = (g: Game) => [...g.rocks, ...g.fleets].flatMap(a => a.specialists ?? []);
    assert.equal(allUnits(f.game).find(u => u.id === queen.id)!.owner, 'you');
    assert.equal(allUnits(f.game).find(u => u.id === 'successor')!.kind, 'princess');
    f.check();
    f.at(contact === 'sub' ? nextRouteEncounter(f.game) : gift.arrives);
    const units = allUnits(f.game);
    assert.deepEqual(units.find(u => u.id === queen.id), { ...queen, kind: 'princess', owner: 'vesper' });
    assert.deepEqual(units.find(u => u.id === 'successor'), { id: 'successor', kind: 'queen', owner: 'you' });
    assert.deepEqual(units.find(u => u.id === recipientQueen.id), recipientQueen);
    assert.equal(units.filter(u => u.owner === 'you' && u.kind === 'queen').length, 1);
    assert.equal(units.filter(u => u.owner === 'vesper' && u.kind === 'queen').length, 1);
    assert.equal(units.length, allUnits(f.baseline).length);
    assert.deepEqual(f.game.eliminated, []);
    f.check();
  });

  test(`Admiral gift moves global ordinary-fleet speed at ${contact} contact without teleporting`, () => {
    const f = fixture();
    f.donor[0]!.specialists = [{ id: 'admiral-gift', kind: 'admiral', owner: 'you' }];
    for (const [sites, y] of [[f.donor, 45], [f.recipient, 65]] as const) {
      Object.assign(sites[1]!, { x: 5, y, drones: 60 });
      Object.assign(sites[2]!, { x: 45, y });
    }
    const gift = f.command({ type: 'gift', owner: 'you', recipient: 'vesper', from: f.donor[0]!.id,
      to: f.recipient[0]!.id, drones: 17, specialists: ['admiral-gift'] });
    const donorFleet = f.command({ type: 'dispatch', owner: 'you', from: f.donor[1]!.id, to: f.donor[2]!.id, drones: 19 });
    const recipientFleet = f.command({ type: 'dispatch', owner: 'vesper', from: f.recipient[1]!.id, to: f.recipient[2]!.id, drones: 23 });
    let opposingId: number | undefined;
    if (contact === 'sub') opposingId = f.command({ type: 'dispatch', owner: 'vesper', from: f.recipient[0]!.id,
      to: f.donor[0]!.id, drones: 29 }).id;
    f.at(gift.departed);
    const before = f.game;
    assert.equal(before.fleets.find(v => v.id === donorFleet.id)!.speed, 12);
    assert.equal(before.fleets.find(v => v.id === recipientFleet.id)!.speed, 8);
    assert.equal(before.fleets.find(v => v.id === gift.id)!.owner, 'you');
    f.check();
    const hour = contact === 'sub' ? nextRouteEncounter(before) : gift.arrives;
    assert.ok(Number.isFinite(hour) && hour > before.hour);
    f.at(hour);
    intactSites(before, f.game);
    for (const [id, owner, speed, drones] of [[donorFleet.id, 'you', 8, 19], [recipientFleet.id, 'vesper', 12, 23]] as const) {
      const old = before.fleets.find(v => v.id === id)!;
      const current = f.game.fleets.find(v => v.id === id)!;
      assert.equal(current.owner, owner);
      assert.equal(current.drones, drones);
      assert.deepEqual(current.specialists, old.specialists);
      assert.equal(current.to, old.to);
      assert.equal(current.speed, speed);
      const expectedPoint = fleetPosition({ ...before, hour }, old);
      const point = fleetPosition(f.game, current);
      assert.ok(Math.hypot(point.x - expectedPoint.x, point.y - expectedPoint.y) < 1e-7);
      assert.ok(current.arrives > hour);
    }
    const units = [...f.game.rocks, ...f.game.fleets].flatMap(a => a.specialists ?? []);
    assert.deepEqual(units.filter(u => u.id === 'admiral-gift'), [{ id: 'admiral-gift', kind: 'admiral', owner: 'vesper' }]);
    if (contact === 'sub') {
      const received = f.game.fleets.find(v => v.id === gift.id)!;
      assert.equal(received.owner, 'vesper');
      assert.equal(received.drones, 17);
      assert.equal(received.speed, 12);
      assert.equal(received.returning, true);
      assert.equal(f.game.fleets.find(v => v.id === opposingId)!.drones, 29);
    } else assert.equal(f.game.rocks.find(r => r.id === f.recipient[0]!.id)!.drones, 77);
    f.check();
    const atContact = f.game;
    f.at(hour + 0.1);
    for (const [id, speed] of [[donorFleet.id, 8], [recipientFleet.id, 12]] as const) {
      const a = fleetPosition(atContact, atContact.fleets.find(v => v.id === id)!);
      const b = fleetPosition(f.game, f.game.fleets.find(v => v.id === id)!);
      assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - speed * workBetween(atContact, hour, hour + .1)) < 1e-7);
    }
    f.check();
  });
}

function intactSites(before: Game, after: Game) {
  assert.deepEqual(after.rocks.map(r => [r.id, r.owner, r.destroyed, r.shield]),
    before.rocks.map(r => [r.id, r.owner, r.destroyed, r.shield]));
  assert.deepEqual(after.cargo, before.cargo);
  assert.deepEqual(after.eliminated, []);
}

for (const kind of ['martyr', 'assassin', 'doubleAgent'] as const satisfies readonly SpecialistKind[]) {
  for (const contact of ['outpost', 'sub'] as const) {
    test(`${kind} gift bypasses combat at ${contact} contact and survives save/replay`, () => {
      const f = fixture();
      f.donor[0]!.specialists = [{ id: 'gift-unit', kind, owner: 'you' }];
      f.recipient[0]!.specialists = [{ id: 'recipient-unit', kind: 'princess', owner: 'vesper' }];
      const gift = f.command({ type: 'gift', owner: 'you', recipient: 'vesper', from: f.donor[0]!.id,
        to: f.recipient[0]!.id, drones: 17, specialists: ['gift-unit'] });
      let otherId: number | undefined;
      if (contact === 'sub') otherId = f.command({ type: 'dispatch', owner: 'vesper', from: f.recipient[0]!.id,
        to: f.donor[0]!.id, drones: 23, specialists: ['recipient-unit'] }).id;
      f.at(gift.departed);
      f.check();
      const before = f.game;
      assert.equal(before.fleets.find(v => v.id === gift.id)!.owner, 'you');
      const hour = contact === 'sub' ? nextRouteEncounter(before) : gift.arrives;
      assert.ok(Number.isFinite(hour) && hour > before.hour);
      const game = f.at(hour);
      intactSites(before, game);
      const accepted = { id: 'gift-unit', kind, owner: 'vesper' };
      if (contact === 'outpost') {
        const site = game.rocks.find(r => r.id === f.recipient[0]!.id)!;
        assert.equal(game.fleets.length, 0);
        assert.equal(site.drones, 77);
        assert.deepEqual(site.specialists, [{ id: 'recipient-unit', kind: 'princess', owner: 'vesper' }, accepted]);
      } else {
        assert.equal(game.fleets.length, 2);
        const received = game.fleets.find(v => v.id === gift.id)!;
        assert.equal(received.owner, 'vesper');
        assert.equal(received.drones, 17);
        assert.deepEqual(received.specialists, [accepted]);
        assert.equal(received.returning, true);
        assert.equal(received.giftAt, undefined);
        assert.equal(game.rocks.find(r => r.id === received.to)!.owner, 'vesper');
        const point = fleetPosition({ ...before, hour }, before.fleets.find(v => v.id === gift.id)!);
        assert.ok(worldDistance(game, point, fleetPosition(game, received)) < 1e-7);
        const destination = game.rocks.find(r => r.id === received.to)!;
        assert.equal(worldDistance(game, point, destination),
          Math.min(...game.rocks.filter(r => r.owner === 'vesper').map(r => worldDistance(game, point, r))));
        const other = game.fleets.find(v => v.id === otherId)!;
        assert.equal(other.owner, 'vesper');
        assert.equal(other.drones, 23);
        assert.deepEqual(other.specialists, [{ id: 'recipient-unit', kind: 'princess', owner: 'vesper' }]);
        assert.equal(other.to, f.donor[0]!.id);
        assert.equal(other.returning, undefined);
        assert.deepEqual(game.rocks.map(r => r.drones), before.rocks.map(r => r.drones));
      }
      f.check();
    });
  }
}
