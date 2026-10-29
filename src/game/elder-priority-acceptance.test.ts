import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfiguredGame } from './world';
import { advance } from './simulation';
import { nextRouteEncounter } from './route-encounters';
import { createArchive, executeCommand, exportArchive, replayTo, restoreArchive, type GameCommand, type ReplayEntry } from './replay';
import { decodeSave } from './save-format';
import type { SpecialistKind } from './specialist-catalog';

// Official local combat priorities: Martyr 1, Elder 2, Saboteur 3, Thief 4,
// Infiltrator 5, Double Agent 6, Assassin 7, Lieutenant/War Hero 8.
// https://subterfuge-game.com/rulebook/Specialists.html
function encounter(a: SpecialistKind[], b: SpecialistKind[], reverse = false, outpost = false, revision?: 12 | 13) {
  // Controlled baseline manifests and paused economy are fixtures, not a recruitment playthrough.
  const baseline = createConfiguredGame({ playerCount: 2, mode: 'mining', driftingBases: false }, 0, 2026);
  if (revision !== undefined) baseline.rules!.mechanicsVersion = revision;
  const owners = ['you', 'vesper'] as const;
  const sites = owners.map(owner => baseline.rocks.find(r => r.owner === owner && !r.coreOf)!);
  for (const rock of baseline.rocks) { rock.productionAt = 1000; rock.shieldAt = 1000; }
  for (const [i, kinds] of [a, b].entries()) {
    Object.assign(sites[i]!, { x: 20 + i * 48, y: 20, drones: i === 0 ? 40 : 31, shield: 0 });
    sites[i]!.specialists = kinds.map((kind, index) => ({ id: `${owners[i]}-fixture-${index}`, kind, owner: owners[i]! }));
  }
  let game = baseline;
  const entries: ReplayEntry[] = [];
  const ids: number[] = [];
  function check() {
    const data = { ...exportArchive(createArchive(baseline)), entries };
    const saved = decodeSave(JSON.stringify({ savedAt: 0, game, replay: data }));
    assert.deepEqual(saved.game, game);
    assert.ok(saved.replay, 'strict save retains the replay');
    const restored = restoreArchive(saved.replay);
    assert.deepEqual(exportArchive(restored), data, 'archive remains canonical');
    assert.deepEqual(replayTo(restored, game.hour, { rivals: false, knownThrough: game.hour }), game);
  }
  for (const i of outpost ? [0] : reverse ? [1, 0] : [0, 1]) {
    const command: GameCommand = { type: 'dispatch', owner: owners[i]!, from: sites[i]!.id,
      to: sites[1 - i]!.id, drones: i === 0 ? 40 : 31, specialists: sites[i]!.specialists!.map(u => u.id) };
    entries.push({ hour: game.hour, command });
    game = executeCommand(game, command);
    const fleet = game.fleets.at(-1)!;
    assert.ok(fleet.preparing && fleet.departed > game.hour);
    ids[i] = fleet.id;
  }
  check();
  game = advance(game, Math.max(...game.fleets.map(f => f.departed)), { rivals: false });
  assert.ok(game.fleets.every(f => !f.preparing));
  check();
  const contact = outpost ? game.fleets[0]!.arrives : nextRouteEncounter(game);
  assert.ok(Number.isFinite(contact) && contact > game.hour);
  game = advance(game, contact, { rivals: false });
  check();
  return { game, ids, sites };
}

for (const paired of [false, true]) {
  const elders: SpecialistKind[] = paired ? ['elder'] : [];
  for (const outpost of [false, true]) {
    test(`Martyr detonates before ${paired ? 'paired Elders' : 'one Elder'} at ${outpost ? 'outpost' : 'sub'} contact`, () => {
      const { game, sites } = encounter(['martyr', ...elders], ['elder'], false, outpost);
      assert.equal(game.fleets.length, 0);
      assert.ok(![...game.rocks, ...game.fleets].flatMap(r => r.specialists ?? []).some(u => u.id.startsWith('you-fixture')));
      if (outpost) {
        const target = game.rocks.find(r => r.id === sites[1]!.id)!;
        assert.equal(target.destroyed, true);
        assert.equal(target.drones, 0);
        assert.deepEqual(target.specialists, []);
      }
    });
  }

  test(`${paired ? 'paired Elders permit' : 'one Elder suppresses'} Saboteur redirection (r12 immediate redirect)`, () => {
    const { game, ids, sites } = encounter(['saboteur', ...elders], ['elder'], false, false, 12);
    if (paired) {
      assert.equal(game.fleets.length, 2);
      const redirected = game.fleets.find(f => f.id === ids[1])!;
      assert.equal(redirected.owner, 'vesper');
      assert.equal(redirected.drones, 31);
      assert.equal(redirected.returning, true);
      assert.equal(game.rocks.find(r => r.id === redirected.to)!.owner, 'vesper');
      assert.equal(game.fleets.find(f => f.id === ids[0])!.to, sites[1]!.id);
    } else assertWinner(game, 9, ['saboteur']);
  });

  test(`${paired ? 'paired Elders permit' : 'one Elder suppresses'} Saboteur redirection (r13 mark diverts only a survivor)`, () => {
    // The Saboteur's side wins 40/31 either way, so no marked enemy survives to divert.
    const { game } = encounter(['saboteur', ...elders], ['elder'], false, false, 13);
    assertWinner(game, 9, ['saboteur', ...elders]);
  });

  test(`${paired ? 'paired Elders permit' : 'one Elder suppresses'} conversion followed by Infiltrator termination`, () => {
    const { game, ids, sites } = encounter(['thief', 'infiltrator', ...elders], ['elder', 'doubleAgent']);
    if (paired) {
      assert.equal(game.fleets.length, 2);
      for (const [i, drones] of [45, 26].entries()) {
        const fleet = game.fleets.find(f => f.id === ids[i])!;
        assert.equal(fleet.owner, i === 0 ? 'you' : 'vesper');
        assert.equal(fleet.drones, drones);
        assert.equal(fleet.to, sites[1 - i]!.id);
        assert.equal(fleet.returning, undefined);
        assert.ok(fleet.specialists!.every(u => !u.captive));
      }
    } else assertWinner(game, 9, ['thief', 'infiltrator']);
  });

  test(`${paired ? 'paired Elders permit' : 'one Elder suppresses'} Double Agent ownership swap`, () => {
    const { game, ids } = encounter(['doubleAgent', ...elders], ['elder']);
    if (paired) {
      assert.equal(game.fleets.length, 2);
      for (const i of [0, 1]) {
        const fleet = game.fleets.find(f => f.id === ids[i])!;
        const owner = i === 0 ? 'vesper' : 'you';
        assert.equal(fleet.owner, owner);
        assert.equal(fleet.drones, 0);
        assert.ok(fleet.specialists!.length > 0);
        assert.ok(fleet.specialists!.every(u => u.owner === owner && !u.captive));
      }
    } else assertWinner(game, 9, ['doubleAgent']);
  });

  for (const reverse of [false, true]) {
    test(`${paired ? 'paired Elders permit simultaneous' : 'one Elder suppresses'} Assassin killing, reverse=${reverse}`, () => {
      const { game } = encounter(['assassin', ...elders], ['elder', 'assassin'], reverse);
      if (paired) {
        assert.equal(game.fleets.length, 1);
        assert.equal(game.fleets[0]!.owner, 'you');
        assert.equal(game.fleets[0]!.drones, 9);
        assert.deepEqual(game.fleets[0]!.specialists, []);
      } else assertWinner(game, 9, ['assassin']);
    });

    test(`${paired ? 'paired Elders permit simultaneous' : 'one Elder suppresses'} priority-eight damage, reverse=${reverse}`, () => {
      const { game } = encounter(['lieutenant', ...elders], ['elder', 'warHero'], reverse);
      if (paired) {
        const winner = game.fleets.find(f => f.owner === 'vesper' && f.specialists?.some(u => !u.captive))!;
        assert.ok(winner);
        assert.equal(winner.drones, 6); // (31 - 5) - (40 - 20).
        assert.deepEqual(winner.specialists!.filter(u => !u.captive).map(u => u.kind), ['elder', 'warHero']);
      } else assertWinner(game, 9, ['lieutenant']);
    });
  }
}

function assertWinner(game: ReturnType<typeof advance>, drones: number, active: SpecialistKind[]) {
  const winner = game.fleets.find(f => f.owner === 'you' && f.specialists?.some(u => !u.captive && u.owner === 'you'))!;
  assert.ok(winner, 'ordinary driller combat has a surviving attacking fleet');
  assert.equal(winner.drones, drones);
  assert.deepEqual(winner.specialists!.filter(u => !u.captive).map(u => u.kind), active);
  const units = [...game.rocks, ...game.fleets].flatMap(r => r.specialists ?? []);
  assert.ok(units.some(u => u.kind === 'elder' && u.owner === 'vesper' && u.captive), 'suppressed killing leaves Elder alive for capture');
}
