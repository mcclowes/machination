import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPreCargoGame as createConfiguredGame } from './test-world';
import { advance, type Game } from './simulation';
import { nextRouteEncounter } from './route-encounters';
import { createArchive, executeCommand, exportArchive, replayTo, restoreArchive, type GameCommand, type ReplayEntry } from './replay';
import { decodeSave } from './save-format';
import type { SpecialistKind } from './specialist-catalog';

// Global General damage survives local Elder suppression; see the evidence limits in specialist-acceptance-audit.md.
type Side = { carried?: SpecialistKind[]; remote?: SpecialistKind[]; captiveAtOpponent?: SpecialistKind[] };
const owners = ['you', 'vesper'] as const;

function encounter(sides: [Side, Side], drones: [number, number], reverse: boolean) {
  const baseline = createConfiguredGame({ playerCount: 2, mode: 'mining', driftingBases: false }, 0, 2026);
  baseline.rules!.mechanicsVersion = 13;
  const sites = owners.map(owner => baseline.rocks.find(r => r.owner === owner && !r.coreOf)!);
  const remotes = owners.map((owner, i) => baseline.rocks.find(r => r.owner === owner && r !== sites[i])!);
  for (const rock of baseline.rocks) { rock.productionAt = 1000; rock.shieldAt = 1000; }
  for (const [i, side] of sides.entries()) {
    const unit = (kind: SpecialistKind, index: number, tag: string) => ({ id: `${owners[i]}-${tag}-${index}`, kind, owner: owners[i]! });
    Object.assign(sites[i]!, { x: 20 + i * 48, y: 20, drones: drones[i]!, shield: 0 });
    sites[i]!.specialists = (side.carried ?? []).map((kind, index) => unit(kind, index, 'carried'));
    remotes[i]!.specialists!.push(...(side.remote ?? []).map((kind, index) => unit(kind, index, 'remote')));
    remotes[1 - i]!.specialists!.push(...(side.captiveAtOpponent ?? []).map((kind, index) => ({ ...unit(kind, index, 'captive'), captive: true as const })));
  }
  let game = baseline;
  const entries: ReplayEntry[] = [];
  const ids: number[] = [];
  for (const i of reverse ? [1, 0] : [0, 1]) {
    const command: GameCommand = { type: 'dispatch', owner: owners[i]!, from: sites[i]!.id, to: sites[1 - i]!.id,
      drones: drones[i]!, specialists: sites[i]!.specialists!.map(u => u.id) };
    entries.push({ hour: game.hour, command });
    game = executeCommand(game, command);
    ids[i] = game.fleets.at(-1)!.id;
  }
  game = advance(game, Math.max(...game.fleets.map(f => f.departed)), { rivals: false });
  for (const [i, side] of sides.entries()) {
    assert.deepEqual(game.rocks.find(r => r.id === remotes[i]!.id)!.specialists!.filter(u => u.id.startsWith(`${owners[i]}-remote`)).map(u => u.kind), side.remote ?? [], 'remote units stay stationary');
  }
  const contact = nextRouteEncounter(game);
  assert.ok(Number.isFinite(contact) && contact > game.hour);
  game = advance(game, contact, { rivals: false });
  const data = { ...exportArchive(createArchive(baseline)), entries };
  const saved = decodeSave(JSON.stringify({ savedAt: 0, game, replay: data }));
  assert.deepEqual(saved.game, game);
  assert.deepEqual(replayTo(restoreArchive(saved.replay!), game.hour, { rivals: false, knownThrough: game.hour }), game);
  return { game, fleet: (i: 0 | 1) => game.fleets.find(f => f.id === ids[i]) };
}
function assertSurvivor(result: { game: Game; fleet: (i: 0 | 1) => Game['fleets'][number] | undefined }, drones: number) {
  assert.equal(result.fleet(1), undefined, 'the opposing hauler is destroyed');
  assert.equal(result.fleet(0)?.drones, drones);
}

// 30 v 20: 10 survive without a General, or 20 after the General removes 10 enemy drones.
for (const reverse of [false, true]) {
  const suffix = `reverse=${reverse}`;

  test(`control: a lone Elder with no General leaves 10: ${suffix}`, () => {
    assertSurvivor(encounter([{ carried: ['elder'] }, {}], [30, 20], reverse), 10);
  });

  test(`remote General applies beside its own side's lone Elder: ${suffix}`, () => {
    assertSurvivor(encounter([{ carried: ['elder'], remote: ['general'] }, {}], [30, 20], reverse), 20);
  });

  test(`remote General applies against an opposing lone Elder; a suppressed Lieutenant still makes it eligible: ${suffix}`, () => {
    // Unsuppressed, the Lieutenant would add 5 more (25 survive); suppressed, only the General's 10 applies.
    assertSurvivor(encounter([{ carried: ['lieutenant'], remote: ['general'] }, { carried: ['elder'] }], [30, 20], reverse), 20);
  });

  test(`carried General applies against an opposing lone Elder: ${suffix}`, () => {
    assertSurvivor(encounter([{ carried: ['general'] }, { carried: ['elder'] }], [30, 20], reverse), 20);
  });

  test(`carried General applies beside its own side's lone Elder: ${suffix}`, () => {
    assertSurvivor(encounter([{ carried: ['general', 'elder'] }, {}], [30, 20], reverse), 20);
  });

  test(`remote General needs one of its owner's modules present: ${suffix}`, () => {
    assertSurvivor(encounter([{ remote: ['general'] }, { carried: ['elder'] }], [30, 20], reverse), 10);
  });

  test(`captive General supplies no global damage: ${suffix}`, () => {
    // Your General is held captive at vesper's outpost; your Elder makes you eligible, but no active General remains.
    assertSurvivor(encounter([{ carried: ['elder'], captiveAtOpponent: ['general'] }, {}], [30, 20], reverse), 10);
  });

  test(`opposing captive General held by you supplies vesper no damage: ${suffix}`, () => {
    // Vesper's General is captive at your outpost; vesper carries an Elder. Only drone combat applies: 30 - 20.
    assertSurvivor(encounter([{}, { carried: ['elder'], captiveAtOpponent: ['general'] }], [30, 20], reverse), 10);
  });
}
