import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, type Fleet } from '../game/simulation';
import { createLegacyGame } from '../game/legacy';
import { observe } from '../game/visibility';
import { observationIntervals } from './observation-intervals';

const crossing: Fleet = { id: 100, owner: 'vesper', from: 'e', to: 'b', drones: 4, departed: 0, arrives: 1, route: { from: { x: -40, y: 0 }, to: { x: 40, y: 0 } } };
function world() {
  const game = createGame(0);
  game.rocks = game.rocks.map((rock, index) => ({ ...rock, x: index * 200, y: index ? 200 : 0, owner: index ? 'vesper' : 'you', specialists: [] }));
  game.fleets = [crossing];
  return game;
}

test('fixed v2 spans retain transient sonar contacts and use existing incoming/preparation rules', () => {
  const game = world();
  const before = structuredClone(game);
  const support = observationIntervals(game, 'you', 1);
  assert.ok(Math.abs(support.fleets.get(100)![0]!.from - 0.1) < 1e-12);
  assert.ok(Math.abs(support.fleets.get(100)![0]!.through - 0.9) < 1e-12);
  for (const hour of [0, 0.2, 0.5, 0.8, 1]) assert.equal(support.fleets.get(100)!.some(window => hour >= window.from && hour <= window.through), observe({ ...game, hour }, 'you').fleets.length > 0);
  assert.deepEqual(game, before);
  game.fleets = [{ ...crossing, preparing: true }];
  assert.equal(observationIntervals(game, 'you', 1).fleets.has(100), false);
  game.fleets = [{ ...crossing, owner: 'you', preparing: true }];
  assert.deepEqual(observationIntervals(game, 'you', 1).fleets.get(100), [{ from: 0, through: 1 }]);
  game.fleets = [{ ...crossing, to: 'a', route: { from: { x: -200, y: 0 }, to: { x: -100, y: 0 } } }];
  assert.deepEqual(observationIntervals(game, 'you', 1).fleets.get(100), [{ from: 0, through: 1 }]);
});

test('legacy moving sonar reveals a static outpost and stationary rival only during the crossing', () => {
  const game = createLegacyGame(0);
  game.rocks = game.rocks.map((rock, index) => ({ ...rock, owner: index ? 'vesper' : 'you', x: index ? 100 : 0, y: index ? 50 : 0 }));
  game.fleets = [
    { ...crossing, id: 101, owner: 'you', from: 'a', route: { from: { x: 50, y: 50 }, to: { x: 150, y: 50 } } },
    { ...crossing, route: { from: { x: 100, y: 50 }, to: { x: 100, y: 50 } } },
  ];
  const support = observationIntervals(game, 'you', 1);
  for (const intervals of [support.sites.get('b')!, support.fleets.get(100)!]) {
    assert.ok(Math.abs(intervals[0]!.from - 0.34) < 1e-12);
    assert.ok(Math.abs(intervals[0]!.through - 0.66) < 1e-12);
  }
  for (const hour of [0, 0.4, 0.5, 0.6, 1]) {
    const view = observe({ ...game, hour }, 'you');
    assert.equal(support.sites.get('b')!.some(w => hour >= w.from && hour <= w.through), view.rocks.find(r => r.id === 'b')!.known);
    assert.equal(support.fleets.get(100)!.some(w => hour >= w.from && hour <= w.through), view.fleets.some(f => f.id === 100));
  }
});

test('interceptor incoming entitlement changes with the actual target relation', () => {
  const game = world();
  const route = { from: { x: -200, y: 0 }, to: { x: -100, y: 0 } };
  game.fleets = [{ ...crossing, route, intercept: { home: 'e', target: 101 } }, { ...crossing, id: 101, owner: 'you', route }];
  assert.deepEqual(observationIntervals(game, 'you', 1).fleets.get(100), [{ from: 0, through: 1 }]);
  game.fleets.pop();
  assert.equal(observationIntervals(game, 'you', 1).fleets.has(100), false);
  assert.equal(observe(game, 'you').fleets.some(f => f.id === 100), false);
});

test('current officer and wreck sensor rules are reused while modern haulers provide no coverage', () => {
  const game = world();
  game.rocks[0]!.specialists = [{ id: 'officer', owner: 'you', kind: 'intelligence' }];
  assert.deepEqual(observationIntervals(game, 'you', 1).fleets.get(100), [{ from: 0, through: 1 }]);
  game.rocks[0]!.specialists[0]!.captive = true;
  assert.ok(observationIntervals(game, 'you', 1).fleets.get(100)![0]!.from > 0);
  game.rocks[0]!.specialists = [];
  game.rocks[0]!.destroyed = true;
  assert.ok(observationIntervals(game, 'you', 1).fleets.has(100));
  game.fleets = [{ ...crossing, owner: 'you', route: { from: { x: 200, y: 200 }, to: { x: 200, y: 200 } } }];
  assert.equal(observationIntervals(game, 'you', 1).sites.has('b'), false);
});

test('torus crossing support agrees with wrapped observations across both chart edges', () => {
  const game = world();
  game.rules = { mechanicsVersion: 4, players: ['you', 'vesper', 'null'], mode: 'mining', victoryTarget: 200, map: { generator: 'balanced.v2', topology: 'torus', width: 100, height: 100, seed: 1 } };
  game.rocks = game.rocks.map((r, index) => ({ ...r, x: index ? 50 : 1, y: index ? 0 : 50 }));
  game.fleets = [{ ...crossing, route: { from: { x: 60, y: 50 }, to: { x: 140, y: 50 } } }];
  const windows = observationIntervals(game, 'you', 1).fleets.get(100)!;
  assert.ok(Math.abs(windows[0]!.from - 0.1125) < 1e-12);
  assert.ok(Math.abs(windows[0]!.through - 0.9125) < 1e-12);
  for (const hour of [0, 0.2, 0.5, 0.8, 1]) assert.equal(windows.some(w => hour >= w.from && hour <= w.through), observe({ ...game, hour }, 'you').fleets.length > 0);
});
