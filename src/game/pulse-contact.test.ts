import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, type Fleet, type Rock } from './simulation';
import { expandingIntersection } from './pulse-contact';

const origin = { x: 0, y: 0 };
const site = (x: number, y = 0): Rock => ({ id: 'target', name: 'Target', x, y, kind: 'mine', owner: 'vesper', drones: 0 });
const fleet = (): Fleet => ({ id: 1, owner: 'vesper', from: 'target', to: 'destination', drones: 1, departed: 0, arrives: 4, route: { from: { x: 16, y: 0 }, to: origin } });

test('pulse contacts select the earliest wrapped image and respect the next event boundary', () => {
  const game = createGame(0), target = site(2, 10), source = { x: 98, y: 10 };
  assert.equal(expandingIntersection(game, source, 0, 2, target, 100), 48);
  game.rules = { mechanicsVersion: 8, players: ['you', 'vesper'], mode: 'pulse', victoryTarget: 1, map: { generator: 'balanced.v2', seed: 1, width: 100, height: 100, topology: 'torus' } };
  assert.equal(expandingIntersection(game, source, 0, 2, target, 100), 2);
  assert.equal(expandingIntersection(game, source, 0, 2, target, 1), Infinity);
});

test('pulse contacts retain entry, exit, tangency, and equal-speed linear roots for moving sites', () => {
  const game = createGame(0), target = site(-5);
  target.drift = { origin: { x: -5, y: 0 }, velocity: { x: 1, y: 0 } };
  assert.equal(expandingIntersection(game, origin, 2, 0, target, 10), 3);
  game.hour = 3.5;
  assert.equal(expandingIntersection(game, origin, 2, 0, target, 10), 7);
  game.hour = 0;
  target.drift.origin.y = 2;
  assert.equal(expandingIntersection(game, origin, 2, 0, target, 10), 5);
  target.drift = { origin: { x: 4, y: 0 }, velocity: { x: -2, y: 0 } };
  assert.equal(expandingIntersection(game, origin, 0, 2, target, 10), 1);
});

test('preparing haulers follow their drifting station while engine outages stop in-flight motion', () => {
  const game = createGame(0), source = site(10), hauler = fleet();
  source.drift = { origin: { x: 10, y: 0 }, velocity: { x: .5, y: 0 } };
  game.rocks = [source];
  hauler.preparing = true;
  hauler.departed = 10;
  hauler.arrives = 14;
  assert.ok(Math.abs(expandingIntersection(game, origin, 0, 2, hauler, 9) - 10 / 1.5) < 1e-9);
  delete hauler.preparing;
  hauler.departed = 0;
  hauler.arrives = 4;
  game.hour = 2;
  assert.equal(expandingIntersection(game, origin, 0, 4, hauler, 3), 3);
  hauler.enginesDisabledUntil = 3;
  hauler.arrives = 7;
  assert.equal(expandingIntersection(game, origin, 0, 4, hauler, 3), Infinity);
});

test('in-flight contacts use the current opening rate on each side of its boundary', () => {
  const game = createGame(0), hauler = fleet();
  game.rules = { mechanicsVersion: 9, players: ['you', 'vesper'], mode: 'pulse', victoryTarget: 1, map: { generator: 'balanced.v2', seed: 1, width: 100, height: 100 } };
  hauler.departed = 10;
  hauler.arrives = 14;
  game.hour = 11;
  assert.equal(expandingIntersection(game, origin, 0, 8, hauler, 12), 11.875);
  game.hour = 12;
  assert.ok(Math.abs(expandingIntersection(game, origin, 0, 8, hauler, 14) - (12 + 4 / 7)) < 1e-9);
});
