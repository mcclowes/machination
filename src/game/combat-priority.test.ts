import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMBAT_PRIORITIES } from './combat-abilities';
import { SPECIALISTS, type SpecialistKind } from './specialist-catalog';
import { createConfiguredGame } from './world';
import { advance, type Game } from './simulation';
import { executeCommand } from './replay';
import { nextRouteEncounter } from './route-encounters';

// Official local combat priorities: https://subterfuge-game.com/rulebook/Specialists.html
const OFFICIAL: Partial<Record<SpecialistKind, number>> = { martyr: 1, elder: 2, saboteur: 3, thief: 4, infiltrator: 5, doubleAgent: 6, assassin: 7, lieutenant: 8, warHero: 8 };

test('catalog combat priorities match the official reference exactly', () => {
  const catalog = Object.fromEntries(Object.entries(SPECIALISTS).flatMap(([kind, d]) => 'priority' in d ? [[kind, d.priority]] : []));
  assert.deepEqual(catalog, OFFICIAL);
});

test('the combat phase resolves every catalog priority once, in ascending order', () => {
  assert.deepEqual(COMBAT_PRIORITIES, [...new Set(Object.values(OFFICIAL))].sort((x, y) => x - y));
});

function sweep(a: SpecialistKind, b: SpecialistKind, revision: 12 | 13, reverse: boolean): unknown {
  let game: Game = createConfiguredGame({ playerCount: 2, mode: 'mining', driftingBases: false }, 0, 2026);
  game.rules!.mechanicsVersion = revision;
  const owners = ['you', 'vesper'] as const;
  const sites = owners.map(owner => game.rocks.find(r => r.owner === owner && !r.coreOf)!);
  for (const rock of game.rocks) { rock.productionAt = 1000; rock.shieldAt = 1000; }
  for (const [i, kind] of [a, b].entries()) {
    Object.assign(sites[i]!, { x: 20 + i * 48, y: 20, drones: [37, 29][i]!, shield: 0 });
    sites[i]!.specialists = [{ id: `${owners[i]}-${kind}`, kind, owner: owners[i]! }];
  }
  for (const i of reverse ? [1, 0] : [0, 1]) game = executeCommand(game, { type: 'dispatch', owner: owners[i]!, from: sites[i]!.id,
    to: sites[1 - i]!.id, drones: [37, 29][i]!, specialists: [`${owners[i]}-${[a, b][i]}`] });
  game = advance(game, Math.max(...game.fleets.map(f => f.departed)), { rivals: false });
  game = advance(game, nextRouteEncounter(game), { rivals: false });
  const fleets = game.fleets.map(f => ({ owner: f.owner, drones: f.drones, to: f.to, returning: !!f.returning,
    units: (f.specialists ?? []).map(u => `${u.id}/${u.owner}/${u.kind}/${!!u.captive}`).sort() }));
  return { fleets: fleets.sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))),
    rocks: game.rocks.map(r => [r.id, r.owner, r.drones, r.destroyed ?? false, (r.specialists ?? []).map(u => u.id).sort()]) };
}

const kinds = Object.keys(OFFICIAL) as SpecialistKind[];
for (const revision of [12, 13] as const) {
  test(`every priority pairing resolves independently of side order: r${revision}`, () => {
    for (const a of kinds) for (const b of kinds) assert.deepEqual(sweep(a, b, revision, true), sweep(a, b, revision, false), `${a} vs ${b}`);
  });
}
