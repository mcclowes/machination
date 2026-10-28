import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame, dispatch } from './simulation';
import { drillMine, droneInventory, mineCost, powerCapacity, setShields } from './economy';
import { decodeSave } from './save-format';

test('new operations start with five sites, 160 drones per intelligence, and undefended dormant sites', () => {
  const game = createGame(0);
  assert.equal(game.version, 2);
  for (const faction of ['you', 'vesper', 'null'] as const) {
    const owned = game.rocks.filter(r => r.owner === faction);
    assert.equal(owned.length, 5);
    assert.equal(owned.reduce((n, r) => n + r.drones, 0), 160);
    assert.equal(owned.filter(r => r.coreOf === faction).length, 1);
    assert.equal(owned.filter(r => r.drones === 40).length, 4);
  }
  assert.ok(game.rocks.filter(r => !r.owner).every(r => r.drones === 0));
  assert.ok(game.rocks.every(r => r.kind !== 'mine'));
});

test('recharging shields absorb attacks before drones, and disabling them permits a negotiated handover', () => {
  const game = createGame(0);
  const defended = game.rocks.find(r => r.id === 'c')!;
  defended.shield = 8; defended.shieldAt = 100; defended.productionAt = 100;
  const attack = dispatch(game, 'f', 'c', 20, 'vesper');
  const end = advance(attack, attack.fleets[0]!.arrives, { rivals: false });
  assert.equal(end.rocks.find(r => r.id === 'c')!.drones, 28);
  assert.equal(end.rocks.find(r => r.id === 'c')!.shield, 0);
  assert.equal(defended.shield, 8);
  const disabled = setShields(game, 'c', 'you', true);
  const unshielded = dispatch(disabled, 'f', 'c', 20, 'vesper');
  assert.equal(advance(unshielded, unshielded.fleets[0]!.arrives, { rivals: false }).rocks.find(r => r.id === 'c')!.drones, 20);
  assert.throws(() => setShields(game, 'c', 'vesper', true));
});

test('power limits total stationed and traveling drones and production resumes after losses', () => {
  const game = createGame(0);
  assert.equal(powerCapacity(game, 'you'), 250);
  game.rocks.find(r => r.id === 'c')!.drones += 85;
  const capped = advance(game, 8, { rivals: false });
  assert.equal(droneInventory(capped, 'you'), 250);
  const stillCapped = advance(capped, 16, { rivals: false });
  assert.equal(droneInventory(stillCapped, 'you'), 250);
  stillCapped.rocks.find(r => r.id === 'c')!.drones -= 20;
  assert.equal(droneInventory(advance(stillCapped, 24, { rivals: false }), 'you'), 248);
});

test('factories deliver six drones per eight-hour cycle while generators supply capacity', () => {
  const game = createGame(0);
  const before = advance(game, 7.99, { rivals: false });
  assert.equal(before.rocks.find(r => r.id === 'c')!.drones, 40);
  const cycle = advance(game, 8, { rivals: false });
  assert.equal(cycle.rocks.find(r => r.id === 'c')!.drones, 46);
  assert.equal(cycle.rocks.find(r => r.id === 'n')!.drones, 40);
  assert.equal(cycle.rocks.find(r => r.id === 'a')!.drones, 6);
});

test('mine construction replaces industry, consumes a growing drone cost, and mines daily by territory', () => {
  const game = createGame(0);
  game.rocks.find(r => r.id === 'c')!.drones = 50;
  assert.equal(mineCost(game, 'you'), 50);
  const mined = drillMine(game, 'c', 'you');
  assert.equal(mined.rocks.find(r => r.id === 'c')!.kind, 'mine');
  assert.equal(mined.rocks.find(r => r.id === 'c')!.drones, 0);
  assert.equal(mineCost(mined, 'you'), 100);
  assert.equal(advance(mined, 23.99, { rivals: false }).cargo.you, 0);
  assert.equal(advance(mined, 24, { rivals: false }).cargo.you, 5);
  assert.equal(game.rocks.find(r => r.id === 'c')!.kind, 'factory');
});

test('capturing a mine removes a fifth of its former owner reserves and restarts its production clock', () => {
  let game = createGame(0);
  game.rocks.find(r => r.id === 'f')!.drones = 50;
  game = drillMine(game, 'f', 'vesper');
  game.cargo.vesper = 100;
  game.rocks.find(r => r.id === 'c')!.drones = 100;
  const attack = dispatch(game, 'c', 'f', 100, 'you');
  const hour = attack.fleets[0]!.arrives;
  const captured = advance(attack, hour, { rivals: false });
  assert.equal(captured.cargo.vesper, 80);
  assert.equal(captured.cargo.you, 0);
  assert.equal(captured.rocks.find(r => r.id === 'f')!.miningAt, hour + 24);
});

test('industry and shield clocks survive fractional polling and version-two persistence', () => {
  let start = createGame(0);
  start.rocks.find(r => r.id === 'c')!.drones = 50;
  start = drillMine(start, 'c', 'you');
  const direct = advance(start, 48, { rivals: false });
  assert.equal(direct.rocks.find(r => r.id === 'a')!.shield, 30);
  let polled = start;
  for (let hour = 0.137; hour < 48; hour += 0.137) polled = advance(polled, hour, { rivals: false });
  polled = advance(polled, 48, { rivals: false });
  assert.deepEqual(polled, direct);
  for (const world of [start, direct, advance(direct, 1000, { rivals: false })]) {
    assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: world })).game, world);
  }
  const broken = structuredClone(start); delete broken.minesDrilled;
  assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game: broken })));
});
