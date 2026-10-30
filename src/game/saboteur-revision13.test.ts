import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPreCargoGame as createConfiguredGame } from './test-world';
import { advance, type Fleet, type Game } from './simulation';
import { nextRouteEncounter } from './route-encounters';
import { createArchive, executeCommand, exportArchive, replayTo, restoreArchive, type GameCommand, type ReplayEntry } from './replay';
import { decodeSave } from './save-format';
import type { SpecialistKind } from './specialist-catalog';

// Saboteur: "Redirects enemy sub to its owner's nearest outpost when participating in sub-to-sub combat", priority 3.
// https://subterfuge-game.com/rulebook/Specialists.html; https://subterfuge.fandom.com/wiki/Saboteur ("Does not end combat").
// Revision 13 marks the opposing hauler at priority 3, resolves priorities 4-8, global damage and driller combat,
// then redirects only a marked hauler that survives. Revisions <= 12 keep the immediate, combat-ending redirect.
function encounter(a: SpecialistKind[], b: SpecialistKind[], drones: [number, number], revision: 12 | 13, options: { reverse?: boolean; outpost?: boolean } = {}) {
  const baseline = createConfiguredGame({ playerCount: 2, mode: 'mining', driftingBases: false }, 0, 2026);
  baseline.rules!.mechanicsVersion = revision;
  const owners = ['you', 'vesper'] as const;
  const sites = owners.map(owner => baseline.rocks.find(r => r.owner === owner && !r.coreOf)!);
  for (const rock of baseline.rocks) { rock.productionAt = 1000; rock.shieldAt = 1000; }
  for (const [i, kinds] of [a, b].entries()) {
    Object.assign(sites[i]!, { x: 20 + i * 48, y: 20, drones: drones[i]!, shield: 0 });
    sites[i]!.specialists = kinds.map((kind, index) => ({ id: `${owners[i]}-fixture-${index}`, kind, owner: owners[i]! }));
  }
  let game = baseline;
  const entries: ReplayEntry[] = [];
  const ids: number[] = [];
  const order = options.outpost ? [0] : options.reverse ? [1, 0] : [0, 1];
  for (const i of order) {
    const command: GameCommand = { type: 'dispatch', owner: owners[i]!, from: sites[i]!.id, to: sites[1 - i]!.id,
      drones: drones[i]!, specialists: sites[i]!.specialists!.map(u => u.id) };
    entries.push({ hour: game.hour, command });
    game = executeCommand(game, command);
    ids[i] = game.fleets.at(-1)!.id;
  }
  game = advance(game, Math.max(...game.fleets.map(f => f.departed)), { rivals: false });
  const contact = options.outpost ? game.fleets[0]!.arrives : nextRouteEncounter(game);
  assert.ok(Number.isFinite(contact) && contact > game.hour);
  game = advance(game, contact, { rivals: false });
  const data = { ...exportArchive(createArchive(baseline)), entries };
  const saved = decodeSave(JSON.stringify({ savedAt: 0, game, replay: data }));
  assert.deepEqual(saved.game, game);
  assert.deepEqual(replayTo(restoreArchive(saved.replay!), game.hour, { rivals: false, knownThrough: game.hour }), game);
  return { game, fleet: (i: 0 | 1) => game.fleets.find(f => f.id === ids[i]), sites };
}
const ownedBy = (game: Game, fleet: Fleet) => game.rocks.find(r => r.id === fleet.to)!.owner;
const unitIds = (fleet: Fleet | undefined) => (fleet?.specialists ?? []).map(u => `${u.id}${u.captive ? ':captive' : ''}`).sort();

for (const reverse of [false, true]) {
  const suffix = `reverse=${reverse}`;

  test(`r12 keeps the immediate combat-ending redirect: ${suffix}`, () => {
    const { game, fleet, sites } = encounter(['saboteur'], [], [20, 30], 12, { reverse });
    assert.equal(fleet(1)!.drones, 30); assert.equal(fleet(1)!.returning, true); assert.equal(ownedBy(game, fleet(1)!), 'vesper');
    assert.equal(fleet(0)!.drones, 20); assert.equal(fleet(0)!.to, sites[1]!.id); assert.equal(fleet(0)!.returning, undefined);
  });

  test(`r13 losing Saboteur still diverts the surviving enemy after driller combat: ${suffix}`, () => {
    const { game, fleet } = encounter(['saboteur'], [], [20, 30], 13, { reverse });
    assert.equal(fleet(0), undefined, 'the Saboteur hauler is destroyed');
    const survivor = fleet(1)!;
    assert.equal(survivor.drones, 10);
    assert.equal(survivor.returning, true);
    assert.equal(survivor.courseLocked, undefined);
    assert.equal(ownedBy(game, survivor), 'vesper');
    const captive = [...game.fleets, ...game.rocks].flatMap(r => r.specialists ?? []).find(u => u.id === 'you-fixture-0')!;
    assert.equal(captive.owner, 'you'); assert.equal(captive.captive, true, 'the Saboteur is captured as usual');
  });

  test(`r13 winning Saboteur leaves no survivor to divert and keeps its own course: ${suffix}`, () => {
    const { fleet, sites } = encounter(['saboteur'], [], [30, 20], 13, { reverse });
    assert.equal(fleet(1), undefined);
    assert.equal(fleet(0)!.drones, 10); assert.equal(fleet(0)!.to, sites[1]!.id); assert.equal(fleet(0)!.returning, undefined);
  });

  test(`r13 later priorities resolve before the redirect (Thief 4, War Hero 8): ${suffix}`, () => {
    // Vesper's Thief steals ceil(20 * 0.15) = 3: 17/33. Your War Hero deals 20: 17/13. You win with 4,
    // and as the hauler vesper's Saboteur marked, the survivor turns home.
    const { game, fleet } = encounter(['warHero'], ['saboteur', 'thief'], [20, 30], 13, { reverse });
    assert.equal(fleet(1), undefined);
    assert.equal(fleet(0)!.drones, 17 - 13);
    assert.equal(fleet(0)!.returning, true); assert.equal(ownedBy(game, fleet(0)!), 'you');
  });

  test(`r13 Thief conversion applies before the marked enemy wins and turns home: ${suffix}`, () => {
    const { game, fleet } = encounter(['saboteur'], ['thief'], [20, 30], 13, { reverse });
    // 20/30 -> 17/33 after the Thief; vesper wins with 16 and is diverted.
    assert.equal(fleet(1)!.drones, 16); assert.equal(fleet(1)!.returning, true); assert.equal(ownedBy(game, fleet(1)!), 'vesper');
  });

  test(`r13 Assassin at 7 still kills the Saboteur but the priority-3 mark stands: ${suffix}`, () => {
    const { game, fleet } = encounter(['saboteur'], ['assassin'], [20, 30], 13, { reverse });
    assert.equal(fleet(1)!.drones, 10); assert.equal(fleet(1)!.returning, true); assert.equal(ownedBy(game, fleet(1)!), 'vesper');
    assert.ok(![...game.fleets, ...game.rocks].flatMap(r => r.specialists ?? []).some(u => u.id === 'you-fixture-0'));
  });

  test(`r13 Infiltrator termination at 5 releases both haulers and applies the earlier mark: ${suffix}`, () => {
    const { game, fleet, sites } = encounter(['saboteur'], ['infiltrator'], [20, 30], 13, { reverse });
    assert.equal(fleet(1)!.drones, 30); assert.equal(fleet(1)!.returning, true); assert.equal(ownedBy(game, fleet(1)!), 'vesper');
    assert.equal(fleet(0)!.drones, 20); assert.equal(fleet(0)!.to, sites[1]!.id);
  });

  test(`r13 both sides with Saboteurs: only the surviving hauler is diverted: ${suffix}`, () => {
    const { game, fleet } = encounter(['saboteur'], ['saboteur'], [20, 30], 13, { reverse });
    assert.equal(fleet(0), undefined);
    assert.equal(fleet(1)!.drones, 10); assert.equal(fleet(1)!.returning, true); assert.equal(ownedBy(game, fleet(1)!), 'vesper');
    assert.deepEqual(unitIds(fleet(1)).filter(id => id.startsWith('vesper')), ['vesper-fixture-0']);
  });

  test(`r13 both sides with Saboteurs and an Infiltrator: both survivors are diverted: ${suffix}`, () => {
    const { game, fleet } = encounter(['saboteur', 'infiltrator'], ['saboteur'], [20, 30], 13, { reverse });
    for (const [i, owner, drones] of [[0, 'you', 20], [1, 'vesper', 30]] as const) {
      assert.equal(fleet(i)!.drones, drones); assert.equal(fleet(i)!.returning, true); assert.equal(ownedBy(game, fleet(i)!), owner);
    }
  });

  test(`r13 tied drillers: specialist count decides; a specialist-only marked winner turns home: ${suffix}`, () => {
    const { game, fleet } = encounter(['saboteur'], ['saboteur', 'saboteur'], [25, 25], 13, { reverse });
    // Equal drillers; vesper has more living specialists, wins with 0 drillers and its modules, and is marked.
    assert.equal(fleet(0), undefined);
    assert.equal(fleet(1)!.drones, 0); assert.equal(fleet(1)!.returning, true); assert.equal(ownedBy(game, fleet(1)!), 'vesper');
  });

  test(`r13 Double Agent swap at 6: the marked hauler turns home to its new owner (proposed): ${suffix}`, () => {
    const { game, fleet } = encounter(['saboteur'], ['doubleAgent'], [20, 30], 13, { reverse });
    // Fleets swap owners and lose all drillers; vesper's original hauler, marked at 3, now belongs to "you".
    assert.equal(fleet(1)!.owner, 'you'); assert.equal(fleet(1)!.returning, true); assert.equal(ownedBy(game, fleet(1)!), 'you');
    assert.equal(fleet(0)!.owner, 'vesper'); assert.equal(fleet(0)!.returning, undefined);
  });

  test(`r13 one-sided Elder still suppresses the Saboteur: ${suffix}`, () => {
    const { fleet } = encounter(['saboteur'], ['elder'], [20, 30], 13, { reverse });
    assert.equal(fleet(0), undefined); assert.equal(fleet(1)!.drones, 10); assert.equal(fleet(1)!.returning, undefined);
  });
}

test('r13 Saboteur has no effect at outposts: shields and capture are unchanged', () => {
  const plain = encounter([], [], [40, 31], 13, { outpost: true });
  const sabotage = encounter(['saboteur'], [], [40, 31], 13, { outpost: true });
  const site = (g: Game, id: string) => g.rocks.find(r => r.id === id)!;
  for (const key of ['owner', 'drones', 'shield'] as const) assert.equal(site(sabotage.game, sabotage.sites[1]!.id)[key], site(plain.game, plain.sites[1]!.id)[key]);
  assert.equal(site(sabotage.game, sabotage.sites[1]!.id).owner, 'you');
});
