import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame, dispatch, installModule, travelHours } from './simulation';
import { MODULES } from './modules';

test('purchased routing daemon costs drones and only accelerates a loaded hauler', () => {
  const start = createGame(0);
  const equipped = installModule(start, 'a', 'routing', 'you');
  assert.equal(equipped.rocks[0]!.drones, 90 - MODULES.routing.cost);
  assert.equal(start.rocks[0]!.module, undefined);
  const normal = dispatch(equipped, 'a', 'b', 30, 'you');
  assert.equal(normal.fleets[0]!.arrives, 3);
  assert.equal(normal.rocks[0]!.module, 'routing');
  const loaded = dispatch(equipped, 'a', 'b', 30, 'you', true);
  assert.equal(loaded.fleets[0]!.arrives, 2);
  assert.equal(loaded.rocks[0]!.module, undefined);
  assert.equal(loaded.fleets[0]!.module, 'routing');
  const arrived = advance(loaded, 2, { rivals: false });
  assert.equal(arrived.rocks[1]!.module, 'routing');
  assert.equal(arrived.rocks[1]!.owner, 'you');
  assert.equal(travelHours(start.rocks[0]!, start.rocks[1]!, 'routing'), 2);
});

test('conversion virus turns defenders before combat and remains with the survivors', () => {
  const equipped = installModule(createGame(0), 'a', 'virus', 'you');
  const loaded = dispatch(equipped, 'a', 'b', 12, 'you', true);
  const arrived = advance(loaded, 3, { rivals: false });
  assert.equal(arrived.rocks[1]!.owner, 'you');
  assert.equal(arrived.rocks[1]!.drones, 2);
  assert.equal(arrived.rocks[1]!.module, 'virus');
});

test('scavenger rig recovers a quarter of combat losses only after winning', () => {
  const equipped = installModule(createGame(0), 'a', 'scavenger', 'you');
  const won = advance(dispatch(equipped, 'a', 'b', 30, 'you', true), 3, { rivals: false });
  assert.equal(won.rocks[1]!.drones, 19);
  assert.equal(won.rocks[1]!.module, 'scavenger');
  const lost = advance(dispatch(equipped, 'a', 'b', 10, 'you', true), 3, { rivals: false });
  assert.equal(lost.rocks[1]!.drones, 4);
  assert.equal(lost.rocks[1]!.module, undefined);
});

test('self-destruct charge sacrifices its hauler, empties a garrison, and leaves core ownership intact', () => {
  const start = createGame(0);
  start.rocks[4]!.drones = 0;
  const equipped = installModule(start, 'a', 'charge', 'you');
  const loaded = dispatch(equipped, 'a', 'e', 20, 'you', true);
  const end = advance(loaded, 8, { rivals: false });
  assert.equal(end.rocks[4]!.drones, 0);
  assert.equal(end.rocks[4]!.owner, 'vesper');
  assert.equal(end.rocks[4]!.coreOf, 'vesper');
  assert.equal(end.fleets.length, 0);
  assert.equal(end.eliminated.length, 0);
  assert.equal(end.rocks[4]!.module, undefined);
});

test('module orders reject unauthorized, unaffordable, occupied, and nonexistent bays', () => {
  const start = createGame(0);
  assert.throws(() => installModule(start, 'e', 'routing', 'you'));
  assert.throws(() => installModule(start, 'b', 'routing', 'you'));
  assert.throws(() => installModule(start, 'a', 'missing' as 'routing', 'you'));
  assert.throws(() => dispatch(start, 'a', 'b', 10, 'you', true));
  const equipped = installModule(start, 'a', 'routing', 'you');
  assert.throws(() => installModule(equipped, 'a', 'charge', 'you'));
  const poor = createGame(0); poor.rocks[0]!.drones = 1;
  assert.throws(() => installModule(poor, 'a', 'routing', 'you'));
  const defeated = createGame(0); defeated.eliminated.push('you');
  assert.throws(() => installModule(defeated, 'a', 'routing', 'you'));
  assert.deepEqual(start, createGame(0));
});

test('friendly delivery preserves an occupied bay and never triggers a charge', () => {
  const start = installModule(installModule(createGame(0), 'a', 'charge', 'you'), 'c', 'routing', 'you');
  const end = advance(dispatch(start, 'a', 'c', 10, 'you', true), 4, { rivals: false });
  assert.equal(end.rocks[2]!.module, 'routing');
  assert.equal(end.rocks[2]!.drones, 36 - 24 + 16 + 10);
  assert.ok(end.events.some(e => e.message.includes('occupied module bay')));
});

test('a charge followed by a normal hauler resolves in launch sequence at the same timestamp', () => {
  const equipped = installModule(createGame(0), 'a', 'charge', 'you');
  const wave = dispatch(dispatch(equipped, 'a', 'b', 10, 'you', true), 'a', 'b', 10, 'you');
  const direct = advance(wave, 3, { rivals: false });
  const stepped = advance(advance(wave, 1.25, { rivals: false }), 3, { rivals: false });
  assert.deepEqual(stepped, direct);
  assert.equal(direct.rocks[1]!.owner, 'you');
  assert.equal(direct.rocks[1]!.drones, 10);
  assert.equal(direct.rocks[1]!.module, undefined);
});

test('conversion is capped at twenty drones and a finished operation cannot construct modules', () => {
  const start = createGame(0);
  start.rocks[0]!.drones = 300;
  start.rocks[1]!.drones = 200;
  const loaded = dispatch(installModule(start, 'a', 'virus', 'you'), 'a', 'b', 190, 'you', true);
  const end = advance(loaded, 3, { rivals: false });
  assert.equal(end.rocks[1]!.drones, 30);
  const finished = createGame(0); finished.winner = 'you';
  assert.throws(() => installModule(finished, 'a', 'routing', 'you'));
});
