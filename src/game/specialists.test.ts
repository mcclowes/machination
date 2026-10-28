import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame, dispatch } from './simulation';
import { hireSpecialist, promoteSpecialist, recruitmentStatus, upgradeSpecialists } from './specialists';
import { cancelLaunch } from './transport';
import { decodeSave } from './save-format';
import { releaseSpecialist } from './specialist-travel';

test('recruitment opens at hour four, spends time-based credits, and places a specialist at the core', () => {
  const game = createGame(0);
  assert.equal(recruitmentStatus(game, 'you').credits, 0);
  assert.throws(() => hireSpecialist(game, 'you', recruitmentStatus(game, 'you').offers[0]!));
  const ready = advance(game, 4, { rivals: false });
  const status = recruitmentStatus(ready, 'you');
  assert.equal(status.credits, 1);
  assert.equal(status.offers.length, 3);
  const hired = hireSpecialist(ready, 'you', status.offers[0]!);
  assert.equal(recruitmentStatus(hired, 'you').credits, 0);
  assert.ok(hired.rocks.find(r => r.id === 'a')!.specialists!.some(u => u.kind === status.offers[0]));
  assert.equal(recruitmentStatus(advance(hired, 22, { rivals: false }), 'you').credits, 1);
  assert.equal(recruitmentStatus(ready, 'you').credits, 1);
});

test('the core travels without drones, keeps its preparation at the site, and can recruit again after docking', () => {
  const game = createGame(0);
  const core = game.rocks.find(r => r.id === 'a')!.specialists![0]!;
  const preparing = dispatch(game, 'a', 'c', 0, 'you', false, [core.id]);
  assert.equal(preparing.rocks.find(r => r.id === 'a')!.coreOf, 'you');
  assert.equal(preparing.fleets[0]!.specialists![0]!.id, core.id);
  const canceled = cancelLaunch(preparing, preparing.fleets[0]!.id, 'you');
  assert.equal(canceled.rocks.find(r => r.id === 'a')!.specialists![0]!.id, core.id);
  const traveling = advance(preparing, 1, { rivals: false });
  assert.equal(traveling.rocks.find(r => r.id === 'a')!.coreOf, undefined);
  assert.equal(recruitmentStatus(traveling, 'you').at, undefined);
  const docked = advance(preparing, 4, { rivals: false });
  assert.equal(docked.rocks.find(r => r.id === 'c')!.coreOf, 'you');
  assert.equal(recruitmentStatus(docked, 'you').at, 'c');
  assert.ok(!docked.eliminated.includes('you'));
  assert.equal(game.rocks.find(r => r.id === 'a')!.specialists![0]!.id, core.id);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: preparing })).game, preparing);
});

test('promotion consumes a recruitment credit, preserves identity, and requires an owned station', () => {
  const game = advance(createGame(0), 4, { rivals: false });
  game.rocks.find(r => r.id === 'c')!.specialists!.push({ id: 'test-foreman', owner: 'you', kind: 'foreman' });
  const promoted = promoteSpecialist(game, 'you', 'test-foreman');
  assert.equal(promoted.rocks.find(r => r.id === 'c')!.specialists!.find(u => u.id === 'test-foreman')!.kind, 'engineer');
  assert.equal(recruitmentStatus(promoted, 'you').credits, 0);
  assert.throws(() => promoteSpecialist(game, 'vesper', 'test-foreman'));
  assert.equal(game.rocks.find(r => r.id === 'c')!.specialists![0]!.kind, 'foreman');
});

test('multiple modules share a hauler and a routing daemon doubles its continuous travel speed', () => {
  const game = createGame(0);
  const site = game.rocks.find(r => r.id === 'c')!;
  site.specialists!.push({ id: 'routing-test', kind: 'helmsman', owner: 'you' }, { id: 'virus-test', kind: 'thief', owner: 'you' });
  const convoy = dispatch(game, 'c', 'i', 10, 'you', false, ['routing-test', 'virus-test']);
  const fleet = convoy.fleets[0]!;
  const to = game.rocks.find(r => r.id === 'i')!;
  assert.equal(fleet.specialists!.length, 2);
  assert.equal(fleet.arrives - fleet.departed, Math.hypot(site.x - to.x, site.y - to.y) / 16);
  const delivered = advance(convoy, fleet.arrives, { rivals: false });
  assert.deepEqual(delivered.rocks.find(r => r.id === 'i')!.specialists!.map(u => u.id), ['routing-test', 'virus-test']);
});

test('winning combat captures opposing modules, and a fallback core succeeds a captured core', () => {
  const game = createGame(0);
  game.rocks.find(r => r.id === 'c')!.drones = 100;
  const target = game.rocks.find(r => r.id === 'e')!;
  target.specialists!.push({ id: 'enemy-routing', owner: 'vesper', kind: 'helmsman' });
  game.rocks.find(r => r.id === 'f')!.specialists!.push({ id: 'fallback-vesper', owner: 'vesper', kind: 'princess' });
  const attack = dispatch(game, 'c', 'e', 100, 'you');
  const end = advance(attack, attack.fleets[0]!.arrives, { rivals: false });
  assert.equal(end.rocks.find(r => r.id === 'e')!.specialists!.find(u => u.id === 'enemy-routing')!.captive, true);
  assert.equal(end.rocks.find(r => r.id === 'f')!.coreOf, 'vesper');
  assert.ok(!end.eliminated.includes('vesper'));
});

test('conversion uses fifteen percent rounded upward before shields and drone combat', () => {
  const game = createGame(0);
  game.rocks.find(r => r.id === 'c')!.specialists!.push({ id: 'thief-test', owner: 'you', kind: 'thief' });
  const target = game.rocks.find(r => r.id === 'f')!;
  target.drones = 41; target.shieldsDisabled = true; target.productionAt = 100;
  const attack = dispatch(game, 'c', 'f', 40, 'you', false, ['thief-test']);
  const end = advance(attack, attack.fleets[0]!.arrives, { rivals: false });
  assert.equal(end.rocks.find(r => r.id === 'f')!.owner, 'you');
  assert.equal(end.rocks.find(r => r.id === 'f')!.drones, 13);
});

test('simultaneous assassins kill each other before later combat effects can fire', () => {
  const game = createGame(0);
  const source = game.rocks.find(r => r.id === 'c')!;
  source.specialists!.push({ id: 'kill-a', kind: 'assassin', owner: 'you' }, { id: 'siege-a', kind: 'warHero', owner: 'you' });
  const target = game.rocks.find(r => r.id === 'f')!;
  target.drones = 10; target.productionAt = 100; target.shieldsDisabled = true;
  target.specialists!.push({ id: 'kill-b', kind: 'assassin', owner: 'vesper' }, { id: 'siege-b', kind: 'warHero', owner: 'vesper' });
  const attack = dispatch(game, 'c', 'f', 20, 'you', false, ['kill-a', 'siege-a']);
  const end = advance(attack, attack.fleets[0]!.arrives, { rivals: false });
  assert.equal(end.rocks.find(r => r.id === 'f')!.drones, 10);
  assert.deepEqual(end.rocks.find(r => r.id === 'f')!.specialists, []);
});

test('repair meshes restore rounded-up combat losses globally and add their local repair', () => {
  const game = createGame(0);
  const source = game.rocks.find(r => r.id === 'c')!;
  source.specialists!.push({ id: 'repair-a', owner: 'you', kind: 'engineer' });
  const target = game.rocks.find(r => r.id === 'f')!;
  target.drones = 11; target.shieldsDisabled = true; target.productionAt = 100;
  const attack = dispatch(game, 'c', 'f', 30, 'you', false, ['repair-a']);
  const end = advance(attack, attack.fleets[0]!.arrives, { rivals: false });
  assert.equal(end.rocks.find(r => r.id === 'f')!.drones, 25);
});

test('self-destruct modules destroy nearby sites and cores, rather than applying payload-limited damage', () => {
  const game = createGame(0);
  const source = game.rocks.find(r => r.id === 'c')!;
  source.specialists!.push({ id: 'blast-test', owner: 'you', kind: 'martyr' });
  const target = game.rocks.find(r => r.id === 'f')!;
  target.x = 82; target.y = 52;
  const attack = dispatch(game, 'c', 'f', 1, 'you', false, ['blast-test']);
  const end = advance(attack, attack.fleets[0]!.arrives, { rivals: false });
  assert.equal(end.rocks.find(r => r.id === 'f')!.destroyed, true);
  assert.equal(end.rocks.find(r => r.id === 'e')!.destroyed, true);
  assert.ok(end.eliminated.includes('vesper'));
  assert.equal(end.rocks.find(r => r.id === 'c')!.destroyed, undefined);
  assert.throws(() => dispatch(end, 'c', 'f', 1, 'you'));
});

test('shield servitors fill friendly shields on arrival and refill after defending combat', () => {
  const game = createGame(0);
  const source = game.rocks.find(r => r.id === 'm')!;
  source.specialists!.push({ id: 'inspector-test', owner: 'you', kind: 'inspector' });
  const delivery = dispatch(game, 'm', 'c', 0, 'you', false, ['inspector-test']);
  const arrived = advance(delivery, delivery.fleets[0]!.arrives, { rivals: false });
  assert.equal(arrived.rocks.find(r => r.id === 'c')!.shield, 10);
  const attack = dispatch(arrived, 'f', 'c', 5, 'vesper');
  const defended = advance(attack, attack.fleets[0]!.arrives, { rivals: false });
  assert.equal(defended.rocks.find(r => r.id === 'c')!.shield, 10);
});

test('assimilation daemons take ownership of local captives, while captors can release others into return transit', () => {
  const game = createGame(0);
  const site = game.rocks.find(r => r.id === 'c')!;
  site.specialists!.push({ id: 'assimilation-test', owner: 'you', kind: 'hypnotist' }, { id: 'captive-test', owner: 'vesper', kind: 'helmsman', captive: true });
  const converted = advance(game, 1, { rivals: false });
  const unit = converted.rocks.find(r => r.id === 'c')!.specialists!.find(u => u.id === 'captive-test')!;
  assert.equal(unit.owner, 'you'); assert.equal(unit.captive, undefined);
  site.specialists = site.specialists!.filter(u => u.kind !== 'hypnotist');
  const released = releaseSpecialist(game, 'you', 'captive-test');
  assert.equal(released.fleets[0]!.owner, 'vesper');
  assert.equal(released.fleets[0]!.specialists![0]!.captive, undefined);
  assert.ok(released.fleets[0]!.arrives > released.hour);
});

test('simultaneous destruction of every core ends the operation as a draw and freezes time', () => {
  const game = createGame(0);
  game.rocks.find(r => r.id === 'c')!.specialists!.push({ id: 'draw-blast', owner: 'you', kind: 'martyr' });
  for (const rock of game.rocks.filter(r => r.coreOf)) { rock.x = 82; rock.y = 52; }
  const attack = dispatch(game, 'c', 'f', 1, 'you', false, ['draw-blast']);
  const target = attack.rocks.find(r => r.id === 'f')!;
  target.x = 82; target.y = 52;
  const end = advance(attack, 100, { rivals: false });
  assert.equal(end.draw, true);
  assert.equal(end.winner, null);
  assert.equal(end.eliminated.length, 3);
  assert.equal(advance(end, 200, { rivals: false }).hour, end.hour);
});

test('pre-specialist version-two saves recover their fixed cores before live ticks can erase their markers', () => {
  const legacy = createGame(0);
  delete legacy.specialistVersion; delete legacy.recruitment;
  for (const rock of legacy.rocks) { delete rock.specialists; delete rock.coreOf; }
  const upgraded = upgradeSpecialists(legacy);
  assert.equal(upgraded.specialistVersion, 1);
  assert.equal(upgraded.rocks.find(r => r.id === 'a')!.specialists![0]!.kind, 'queen');
  assert.equal(advance(legacy, 1, { rivals: false }).rocks.find(r => r.id === 'a')!.coreOf, 'you');
  assert.equal(legacy.rocks.find(r => r.id === 'a')!.specialists, undefined);
});

test('specialist save validation refuses missing rosters, duplicate leadership, and active foreign units', () => {
  for (const mutate of [
    (g: ReturnType<typeof createGame>) => { delete g.rocks[0]!.specialists; },
    (g: ReturnType<typeof createGame>) => { g.rocks[2]!.specialists!.push({ id: 'duplicate-core', owner: 'you', kind: 'queen' }); },
    (g: ReturnType<typeof createGame>) => { g.rocks[2]!.specialists!.push({ id: 'foreign-active', owner: 'vesper', kind: 'helmsman' }); },
  ]) {
    const game = createGame(0); mutate(game);
    assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game })));
  }
});

test('pre-specialist queued module transfers retain their pinned cargo after migration', () => {
  const game = createGame(0);
  delete game.specialistVersion;
  game.rocks.find(r => r.id === 'c')!.module = 'routing';
  game.scheduled = [{ id: 'legacy-module-plan', owner: 'you', from: 'c', to: 'm', drones: 1, executeAt: 1, module: 'routing' }];
  const upgraded = upgradeSpecialists(game);
  assert.equal(upgraded.scheduled![0]!.module, undefined);
  const launched = advance(upgraded, 1, { rivals: false });
  assert.equal(launched.fleets[0]!.specialists![0]!.kind, 'helmsman');
  assert.equal(game.scheduled[0]!.module, 'routing');
});

test('pre-specialist interception saves migrate their rig before enforcing the new manifest contract', () => {
  const game = createGame(0);
  delete game.specialistVersion; delete game.recruitment;
  for (const rock of game.rocks) delete rock.specialists;
  game.nextId = 3;
  game.fleets = [
    { id: 1, owner: 'vesper', from: 'f', to: 'c', drones: 5, departed: 0, arrives: 10 },
    { id: 2, owner: 'you', from: 'a', to: 'a', drones: 10, departed: 0, arrives: 2, module: 'scavenger', route: { from: { x: 17, y: 74 }, to: { x: 40, y: 60 } }, intercept: { target: 1, home: 'a' } },
  ];
  const loaded = decodeSave(JSON.stringify({ savedAt: 0, game })).game;
  assert.equal(loaded.fleets[1]!.specialists![0]!.kind, 'pirate');
  assert.equal(loaded.fleets[1]!.module, undefined);
});
