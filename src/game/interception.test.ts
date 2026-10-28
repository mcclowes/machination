import { createLegacyGame as createGame } from './legacy';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, dispatch, installModule } from './simulation';
import { dispatchIntercept } from './interception';
import type { ModuleKind } from './modules';
import { interceptionCourse } from './flight';

test('a scavenger catches a moving enemy hauler, salvages losses, and returns home', () => {
  let game = installModule(createGame(0), 'a', 'scavenger', 'you');
  game = dispatch(game, 'e', 'a', 40, 'vesper');
  game = advance(game, 4, { rivals: false });
  const original = JSON.stringify(game);
  const launched = dispatchIntercept(game, 'a', game.fleets[0]!.id, 50, 'you');
  const rig = launched.fleets.find(f => f.owner === 'you')!;
  assert.ok(rig.arrives > 4 && rig.arrives < 8);
  assert.ok(rig.route);
  assert.equal(launched.rocks[0]!.module, undefined);
  const fought = advance(launched, rig.arrives, { rivals: false });
  assert.equal(fought.fleets.length, 1);
  assert.equal(fought.fleets[0]!.drones, 20);
  assert.equal(fought.fleets[0]!.returning, true);
  const home = advance(fought, 8, { rivals: false });
  assert.equal(home.fleets.length, 0);
  assert.equal(home.rocks[0]!.drones, 64);
  assert.equal(home.rocks[0]!.module, 'scavenger');
  assert.equal(JSON.stringify(game), original);
});

function encounter(module: ModuleKind | undefined, attackers: number, defenders: number) {
  let game = createGame(0);
  game.rocks[0]!.drones = 300; game.rocks[4]!.drones = 300;
  game = installModule(game, 'a', 'scavenger', 'you');
  if (module) game = installModule(game, 'e', module, 'vesper');
  game = advance(dispatch(game, 'e', 'a', defenders, 'vesper', !!module), 4, { rivals: false });
  const launched = dispatchIntercept(game, 'a', game.fleets[0]!.id, attackers, 'you');
  return { launched, at: launched.fleets.find(f => f.owner === 'you')!.arrives };
}

test('a defending conversion virus assimilates attackers before in-flight combat', () => {
  const { launched, at } = encounter('virus', 50, 40);
  const end = advance(launched, at, { rivals: false });
  assert.equal(end.fleets.length, 1);
  assert.equal(end.fleets[0]!.owner, 'vesper');
  assert.equal(end.fleets[0]!.drones, 10);
});

test('a defending charge self-destructs and surviving scavengers salvage the wreckage', () => {
  const lost = encounter('charge', 50, 40);
  assert.equal(advance(lost.launched, lost.at, { rivals: false }).fleets.length, 0);
  const won = encounter('charge', 100, 40);
  const end = advance(won.launched, won.at, { rivals: false });
  assert.equal(end.fleets.length, 1);
  assert.equal(end.fleets[0]!.drones, 40);
  assert.equal(end.fleets[0]!.returning, true);
});

test('a defending scavenger also returns home after surviving combat', () => {
  const { launched, at } = encounter('scavenger', 40, 60);
  const end = advance(launched, at, { rivals: false });
  assert.equal(end.fleets.length, 1);
  assert.equal(end.fleets[0]!.owner, 'vesper');
  assert.equal(end.fleets[0]!.drones, 30);
  assert.equal(end.fleets[0]!.returning, true);
  assert.equal(end.fleets[0]!.to, 'e');
});

test('ties destroy both haulers and a target that disappears never causes a ghost battle', () => {
  const tied = encounter(undefined, 40, 40);
  assert.equal(advance(tied.launched, tied.at, { rivals: false }).fleets.length, 0);
  const { launched, at } = encounter(undefined, 50, 40);
  const lost = { ...launched, fleets: launched.fleets.filter(f => f.owner === 'you') };
  const returned = advance(lost, at, { rivals: false });
  assert.equal(returned.fleets[0]!.drones, 50);
  assert.equal(returned.fleets[0]!.returning, true);
  assert.ok(returned.events.some(e => e.message.includes('target lost')));
});

test('multiple interceptors resolve by launch order and the second returns if the target is gone', () => {
  const { launched, at } = encounter(undefined, 50, 40);
  const original = launched.fleets.find(f => f.owner === 'you')!;
  launched.fleets.push({ ...original, id: launched.nextId++, drones: 10 });
  const end = advance(launched, at, { rivals: false });
  assert.equal(end.fleets.length, 2);
  assert.deepEqual(end.fleets.map(f => f.drones).sort((a, b) => a - b), [10, 20]);
  assert.ok(end.fleets.every(f => f.returning));
  const midway = advance(launched, 5, { rivals: false });
  assert.deepEqual(advance(midway, at, { rivals: false }), end);
});

test('an interceptor returning to a captured home fights instead of reinforcing its captor', () => {
  let game = createGame(0);
  game.rocks[2]!.drones = 200; game.rocks[6]!.drones = 1000;
  game = installModule(game, 'c', 'scavenger', 'you');
  game = dispatch(game, 'g', 'c', 500, 'null');
  game = dispatch(game, 'e', 'a', 40, 'vesper');
  game = advance(game, 4, { rivals: false });
  const target = game.fleets.find(f => f.owner === 'vesper')!;
  const launched = dispatchIntercept(game, 'c', target.id, 50, 'you');
  const rig = launched.fleets.find(f => f.owner === 'you')!;
  const fought = advance(launched, rig.arrives, { rivals: false });
  const homebound = fought.fleets.find(f => f.owner === 'you')!;
  const before = advance(fought, homebound.arrives - 0.001, { rivals: false });
  const end = advance(before, homebound.arrives, { rivals: false });
  assert.equal(end.rocks[2]!.owner, 'null');
  assert.ok(Math.abs(end.rocks[2]!.drones - (before.rocks[2]!.drones + 0.004 - homebound.drones)) < 1e-8);
  assert.ok(!end.fleets.some(f => f.id === rig.id));
});

test('interception rejects hidden, friendly, unaffordable, unequipped, and unreachable targets', () => {
  let game = installModule(createGame(0), 'a', 'scavenger', 'you');
  game = dispatch(game, 'e', 'a', 40, 'vesper');
  assert.throws(() => dispatchIntercept(game, 'a', game.fleets[0]!.id, 1, 'you'));
  const observed = advance(game, 4, { rivals: false });
  assert.throws(() => dispatchIntercept(observed, 'c', observed.fleets[0]!.id, 1, 'you'));
  assert.throws(() => dispatchIntercept(observed, 'a', observed.fleets[0]!.id, 1000, 'you'));
  assert.throws(() => dispatchIntercept(observed, 'a', observed.fleets[0]!.id, 0, 'you'));
  const friendly = dispatch(observed, 'c', 'b', 1, 'you');
  assert.throws(() => dispatchIntercept(friendly, 'a', friendly.fleets.find(f => f.owner === 'you')!.id, 1, 'you'));
  const world = { hour: 0, rocks: [{ id: 'start', x: 10, y: 0 }, { id: 'end', x: 100, y: 0 }] };
  const fast = { id: 1, owner: 'vesper' as const, from: 'start', to: 'end', drones: 10, departed: 0, arrives: 9 };
  assert.equal(interceptionCourse(world, { x: 0, y: 0 }, fast), null);
  const closing = { ...fast, from: 'end', to: 'start', arrives: 10 };
  const course = interceptionCourse(world, { x: 0, y: 0 }, closing)!;
  assert.ok(Math.abs(course.point.x - course.arrives * 8) < 1e-8);
  assert.ok(course.arrives < closing.arrives);
});

test('a target that changes course is not fought at its old rendezvous point', () => {
  const { launched, at } = encounter('scavenger', 50, 40);
  const target = launched.fleets.find(f => f.owner === 'vesper')!;
  const current = { x: 51, y: 61 };
  target.from = 'e'; target.to = 'e'; target.returning = true;
  target.route = { from: current, to: { x: 80, y: 49 } };
  target.departed = 4; target.arrives = 8;
  const end = advance(launched, at, { rivals: false });
  assert.equal(end.fleets.find(f => f.owner === 'you')!.drones, 50);
  assert.equal(end.fleets.find(f => f.owner === 'vesper')!.drones, 40);
  assert.ok(end.events.some(e => e.message.includes('target lost')));
});
