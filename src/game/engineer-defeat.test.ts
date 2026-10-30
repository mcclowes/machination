import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPreCargoGame as createConfiguredGame } from './test-world';
import { advance } from './simulation';
import { nextRouteEncounter } from './route-encounters';
import { createArchive, executeCommand, exportArchive, replayTo, restoreArchive, type GameCommand, type ReplayEntry } from './replay';
import { decodeSave } from './save-format';
import type { SpecialistKind } from './specialist-catalog';

// Max's ruling (issue #18): Engineer recovery, local or global, applies only after a combat its owner wins.
// The official text gates global recovery on victory; local recovery after defeat is ruled out for the rebuild.
function combat(local: SpecialistKind[], globals: SpecialistKind[], drones: [number, number], revision: 12 | 13, outpost: boolean) {
  const baseline = createConfiguredGame({ playerCount: 2, mode: 'mining', driftingBases: false }, 0, 2026);
  baseline.rules!.mechanicsVersion = revision;
  const owners = ['you', 'vesper'] as const;
  const sites = owners.map(owner => baseline.rocks.find(r => r.owner === owner && !r.coreOf)!);
  for (const rock of baseline.rocks) { rock.productionAt = 1000; rock.shieldAt = 1000; }
  // "you" always carries the Engineers and always loses.
  for (const [i, owner] of owners.entries()) {
    Object.assign(sites[i]!, { x: 20 + i * 48, y: 20, drones: drones[i]!, shield: 0 });
    sites[i]!.specialists = i === 0 ? local.map((kind, n) => ({ id: `you-local-${n}`, kind, owner })) : [];
  }
  baseline.rocks.find(r => r.coreOf === 'you')!.specialists!.push(...globals.map((kind, n) => ({ id: `you-global-${n}`, kind, owner: 'you' as const })));
  let game = baseline;
  const entries: ReplayEntry[] = [];
  // Hauler case: both dispatch. Outpost case: vesper attacks the Engineer's site.
  for (const i of outpost ? [1] : [0, 1]) {
    const command: GameCommand = { type: 'dispatch', owner: owners[i]!, from: sites[i]!.id, to: sites[1 - i]!.id,
      drones: drones[i]!, specialists: sites[i]!.specialists!.map(u => u.id) };
    entries.push({ hour: game.hour, command });
    game = executeCommand(game, command);
  }
  game = advance(game, Math.max(...game.fleets.map(f => f.departed)), { rivals: false });
  const contact = outpost ? game.fleets[0]!.arrives : nextRouteEncounter(game);
  game = advance(game, contact, { rivals: false });
  const data = { ...exportArchive(createArchive(baseline)), entries };
  const saved = decodeSave(JSON.stringify({ savedAt: 0, game, replay: data }));
  assert.deepEqual(saved.game, game);
  assert.deepEqual(replayTo(restoreArchive(saved.replay!), game.hour, { rivals: false, knownThrough: game.hour }), game);
  return { game, site: game.rocks.find(r => r.id === sites[0]!.id)! };
}

for (const revision of [12, 13] as const) {
  for (const globals of [[], ['engineer']] as SpecialistKind[][]) {
    const label = `r${revision}${globals.length ? ', plus a global Engineer' : ''}`;

    test(`a losing local Engineer's hauler creates no survivors: ${label}`, () => {
      const { game } = combat(['engineer', 'engineer'], globals, [20, 30], revision, false);
      assert.ok(!game.fleets.some(f => f.owner === 'you' && f.drones > 0), 'no repaired drillers survive for the loser');
      const winner = game.fleets.find(f => f.owner === 'vesper' && f.drones > 0)!;
      assert.equal(winner.drones, 10, 'the winner has no Engineer and gains nothing');
      const engineers = [...game.fleets, ...game.rocks].flatMap(r => r.specialists ?? []).filter(u => u.id.startsWith('you-local'));
      assert.equal(engineers.length, 2); assert.ok(engineers.every(u => u.captive), 'losing Engineers are captured');
    });

    test(`a losing local Engineer at a defended outpost repairs nothing: ${label}`, () => {
      // Vesper attacks with 30 against 20 unshielded defenders; the site falls with 10 attacking survivors.
      const { site } = combat(['engineer'], globals, [20, 30], revision, true);
      assert.equal(site.owner, 'vesper');
      assert.equal(site.drones, 10);
      assert.ok(site.specialists!.some(u => u.id === 'you-local-0' && u.captive));
    });
  }

  test(`control: a winning local Engineer still repairs: r${revision}`, () => {
    const { game } = combat(['engineer'], [], [30, 20], revision, false);
    // 10 survive, 20 lost; global and local shares each recover ceil(20 * 0.25) = 5.
    assert.equal(game.fleets.find(f => f.owner === 'you' && f.drones > 0)!.drones, 20);
  });
}
