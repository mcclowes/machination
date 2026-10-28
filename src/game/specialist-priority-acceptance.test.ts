import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfiguredGame } from './world';
import { advance } from './simulation';
import { nextRouteEncounter } from './route-encounters';
import { createArchive, executeCommand, exportArchive, replayTo, restoreArchive, type GameCommand, type ReplayEntry } from './replay';
import { decodeSave } from './save-format';
import type { SpecialistKind } from './specialist-catalog';

// Current official combat sequence and Specialist Reference; no inferred stacking or Saboteur rules.
// https://subterfuge-game.com/rulebook/Specialists.html
function battle(a: SpecialistKind[], b: SpecialistKind[], drones: [number, number], reverse: boolean,
  globals: [SpecialistKind[], SpecialistKind[]] = [[], []]) {
  const baseline = createConfiguredGame({ playerCount: 2, mode: 'mining', driftingBases: false }, 0, 2026);
  const owners = ['you', 'vesper'] as const;
  const sources = owners.map(owner => baseline.rocks.find(r => r.owner === owner && !r.coreOf)!);
  for (const rock of baseline.rocks) { rock.productionAt = 1000; rock.shieldAt = 1000; }
  for (const [i, owner] of owners.entries()) {
    sources[i]!.drones = 60;
    sources[i]!.specialists = (i === 0 ? a : b).map((kind, index) => ({ id: `${owner}-local-${index}`, kind, owner }));
    const core = baseline.rocks.find(r => r.coreOf === owner)!;
    core.specialists!.push(...globals[i]!.map((kind, index) => ({ id: `${owner}-global-${index}`, kind, owner })));
  }
  let game = baseline;
  const entries: ReplayEntry[] = [];
  for (const i of reverse ? [1, 0] : [0, 1]) {
    const command: GameCommand = { type: 'dispatch', owner: owners[i]!, from: sources[i]!.id,
      to: sources[1 - i]!.id, drones: drones[i]!, specialists: sources[i]!.specialists!.map(u => u.id) };
    entries.push({ hour: game.hour, command });
    game = executeCommand(game, command);
  }
  game = advance(game, Math.max(...game.fleets.map(f => f.departed)), { rivals: false });
  const contact = nextRouteEncounter(game);
  assert.ok(Number.isFinite(contact) && contact > game.hour);
  game = advance(game, contact, { rivals: false });
  const data = { ...exportArchive(createArchive(baseline)), entries };
  assert.deepEqual(replayTo(restoreArchive(data), contact, { rivals: false, knownThrough: contact }), game);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game, replay: data })).game, game);
  return game;
}

for (const reverse of [false, true]) {
  for (const [a, b, expectedA, expectedB] of [[21, 19, 20, 20], [1, 7, 2, 6], [31, 47, 34, 44]] as const) {
    test(`reciprocal conversions use pre-conversion counts before termination: ${a}/${b}, reverse=${reverse}`, () => {
      const game = battle(['thief', 'infiltrator'], ['thief', 'infiltrator'], [a, b], reverse);
      assert.equal(game.fleets.length, 2);
      for (const [owner, expected] of [['you', expectedA], ['vesper', expectedB]] as const) {
        const fleet = game.fleets.find(f => f.owner === owner)!;
        assert.equal(fleet.drones, expected);
        assert.deepEqual(fleet.specialists!.map(u => u.kind), ['thief', 'infiltrator']);
        assert.ok(fleet.specialists!.every(u => !u.captive));
        assert.equal(fleet.returning, undefined);
      }
    });
  }

  test(`reciprocal priority-eight damage is simultaneous: reverse=${reverse}`, () => {
    const game = battle(['warHero', 'warHero'], ['warHero'], [37, 29], reverse);
    const winner = game.fleets.find(f => f.owner === 'you' && f.specialists?.some(u => !u.captive && u.owner === 'you'))!;
    assert.equal(winner.drones, 17);
    assert.equal(winner.specialists!.filter(u => !u.captive).length, 2);
    assert.ok(game.fleets.some(f => f.owner === 'you' && f.specialists?.some(u => u.owner === 'vesper' && u.captive)));
  });

  test(`assassins remove General eligibility before global damage but preserve King effects: reverse=${reverse}`, () => {
    const game = battle(['assassin'], ['assassin'], [43, 31], reverse,
      [['general', 'general', 'king'], ['general', 'general', 'general', 'king', 'king']]);
    // Both local units die. Kings deal floor(31/4)=7 and floor(43/4)=10; 36 versus 21 leaves 15.
    assert.equal(game.fleets.length, 1);
    assert.equal(game.fleets[0]!.owner, 'you');
    assert.equal(game.fleets[0]!.drones, 15);
    assert.deepEqual(game.fleets[0]!.specialists, []);
  });

  test(`global damage uses both post-specialist counts before driller combat: reverse=${reverse}`, () => {
    const game = battle(['lieutenant', 'warHero'], ['warHero'], [41, 37], reverse,
      [['general', 'king'], ['general', 'general', 'king', 'king']]);
    // Priority eight leaves 21/12. Global damage removes 23/15; both reach zero.
    const winner = game.fleets.find(f => f.specialists?.some(u => u.owner === 'you' && !u.captive))!;
    assert.equal(winner.owner, 'you');
    assert.equal(winner.drones, 0);
    assert.equal(winner.specialists!.filter(u => !u.captive).length, 2);
    assert.ok(game.fleets.some(f => f.specialists?.some(u => u.owner === 'vesper' && u.captive)));
    assert.deepEqual(game.eliminated, []);
  });
}
