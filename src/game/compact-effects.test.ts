import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, advance } from './simulation';
import { createCompact } from './compact';
import { rockSensorRange } from './sensors';
import { hireSpecialist } from './specialists';
import { applyCombatAbilities } from './combat-abilities';
import { detonate } from './destruction';
import { resolveHaulerBattle, resolveStationArrival } from './specialist-combat';

test('weapons interlocks prevent recruitment and keep existing self-destruct units dormant after expiry', () => {
  const game = createGame(0); game.hour = 4; game.compact = createCompact(['you', 'vesper', 'null']);
  game.recruitment!.you!.offers = ['martyr'];
  assert.throws(() => hireSpecialist(game, 'you', 'martyr'), /interlock/i);
  game.compact.waivers.weapons = { startsAt: 0, expiresAt: 48 };
  const hired = hireSpecialist(game, 'you', 'martyr');
  assert.ok(hired.rocks[0]!.specialists!.some(u => u.kind === 'martyr'));
  hired.hour = 48;
  const attacker = { id: 1, owner: 'you' as const, from: 'a', to: 'e', drones: 1, departed: 47, arrives: 49, specialists: [{ id: 'm', kind: 'martyr' as const, owner: 'you' as const }] };
  assert.equal(applyCombatAbilities(hired, attacker, hired.rocks.find(r => r.id === 'e')!).ended, false);
});

test('weapons permission alone preserves installations; a separate waiver permits demolition', () => {
  const game = createGame(0); game.compact = createCompact(['you', 'vesper', 'null']);
  assert.throws(() => detonate(game, game.rocks[0]!), /interlock/i);
  game.compact.waivers.weapons = { startsAt: 0, expiresAt: 48 };
  const protectedGame = structuredClone(game);
  detonate(protectedGame, protectedGame.rocks[0]!);
  assert.equal(protectedGame.rocks[0]!.destroyed, undefined);
  assert.equal(protectedGame.rocks[0]!.drones, 0);
  game.compact.waivers.infrastructure = { startsAt: 0, expiresAt: 48 };
  detonate(game, game.rocks[0]!);
  assert.equal(game.rocks[0]!.destroyed, true);
});

test('open salvage rights let the surviving side recover opposing wreckage', () => {
  const game = createGame(0); game.compact = createCompact(['you', 'vesper', 'null']);
  const fleet = (id: number, owner: 'you' | 'vesper', drones: number) => ({ id, owner, from: 'a', to: 'e', drones, departed: 0, arrives: 8, specialists: [] });
  game.fleets = [fleet(1, 'you', 100), fleet(2, 'vesper', 40)];
  const restricted = structuredClone(game);
  resolveHaulerBattle(restricted, restricted.fleets[0]!, restricted.fleets[1]!);
  assert.equal(restricted.fleets[0]!.drones, 60);
  game.compact.waivers.salvage = { startsAt: 0, expiresAt: 48 };
  resolveHaulerBattle(game, game.fleets[0]!, game.fleets[1]!);
  assert.equal(game.fleets[0]!.drones, 70);
});

test('salvage excludes converted drones and requires a surviving operator', () => {
  const game = createGame(0); game.compact = createCompact(['you', 'vesper', 'null']);
  game.compact.waivers.salvage = { startsAt: 0, expiresAt: 48 };
  game.fleets = [
    { id: 1, owner: 'you', from: 'a', to: 'e', drones: 100, departed: 0, arrives: 8, specialists: [{ id: 'thief', kind: 'thief', owner: 'you' }] },
    { id: 2, owner: 'vesper', from: 'e', to: 'a', drones: 40, departed: 0, arrives: 8, specialists: [] },
  ];
  resolveHaulerBattle(game, game.fleets[0]!, game.fleets[1]!);
  assert.equal(game.fleets[0]!.drones, 80, 'six converted drones are not wreckage: 72 survivors plus eight salvage');
  const target = game.rocks.find(r => r.id === 'f')!; target.shield = 0; target.drones = 40;
  game.fleets = [{ id: 3, owner: 'you', from: 'a', to: 'f', drones: 40, departed: 0, arrives: 8, specialists: [] }];
  resolveStationArrival(game, game.fleets[0]!, target);
  assert.equal(target.drones, 0, 'mutual destruction leaves nobody to salvage the wreckage');
});

test('replication permission increases factory output within the existing capacity', () => {
  const game = createGame(0); game.compact = createCompact(['you', 'vesper', 'null']);
  assert.equal(advance(game, 8, { rivals: false }).rocks.find(r => r.id === 'a')!.drones, 6);
  game.compact.waivers.replication = { startsAt: 0, expiresAt: 48 };
  assert.equal(advance(game, 8, { rivals: false }).rocks.find(r => r.id === 'a')!.drones, 9);
});

test('surveillance permission extends station coverage only during the authorized interval', () => {
  const game = createGame(0); game.compact = createCompact(['you', 'vesper', 'null']);
  assert.equal(rockSensorRange(game, game.rocks[0]!), 32);
  game.compact.waivers.sensors = { startsAt: 24, expiresAt: 72 };
  assert.equal(rockSensorRange(game, game.rocks[0]!), 32);
  game.hour = 24; assert.equal(rockSensorRange(game, game.rocks[0]!), 48);
  game.hour = 72; assert.equal(rockSensorRange(game, game.rocks[0]!), 32);
});

test('transit waivers authorize new missions without speeding up old missions or slowing them at expiry', () => {
  let game = createGame(0);
  game.compact = createCompact(['you', 'vesper', 'null']);
  game.rocks.find(r => r.id === 'a')!.drones = 30;
  game.rocks.find(r => r.id === 'c')!.x = 1000;
  game = dispatch(game, 'a', 'c', 1, 'you');
  assert.equal(game.fleets[0]!.speed, 8);
  game.compact!.waivers.transit = { startsAt: 0, expiresAt: 48 };
  game = dispatch(game, 'a', 'c', 1, 'you');
  assert.equal(game.fleets[1]!.speed, 12);
  const later = advance(game, 49, { rivals: false });
  assert.equal(later.fleets[0]!.speed, 8);
  assert.equal(later.fleets[1]!.speed, 12);
  assert.equal(dispatch(later, 'a', 'c', 1, 'you').fleets.at(-1)!.speed, 8);
});
