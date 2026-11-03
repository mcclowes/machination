import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moveReplayScene } from './motion';
import type { ReplayRock, ReplayScene } from './presentation';

function shieldScene(rock: Partial<ReplayRock>, energy: number, exposed = 0): ReplayScene {
  return {
    hour: 12,
    rocks: [{ id: 'a', name: 'Alpha', x: 0, y: 0, known: true, kind: 'factory', owner: 'you', drones: 0, ...rock }],
    fleets: [], coverage: [], cargo: { you: 0 }, eliminated: [], winner: null,
    pulse: { kings: [], pulses: [], modifiers: [], shields: { a: { energy, exposed } } },
  };
}

test('destroyed sites retain zero pulse shield energy when replay motion moves forward or rewinds', () => {
  const scene = shieldScene({ destroyed: true }, 0);
  const before = structuredClone(scene);
  for (const hour of [11, 13]) {
    const moved = moveReplayScene(scene, hour);
    assert.equal(moved.hour, hour);
    assert.deepEqual(moved.pulse!.shields, scene.pulse!.shields);
  }
  assert.deepEqual(scene, before);
});

test('destroyed exposed sites retain zero pulse shield energy in both directions', () => {
  const scene = shieldScene({ destroyed: true }, 0, 2);
  const before = structuredClone(scene);
  for (const hour of [11, 13]) assert.deepEqual(moveReplayScene(scene, hour).pulse!.shields, scene.pulse!.shields);
  assert.deepEqual(scene, before);
});

test('living unexposed shields retain their recharge law and full shields remain full', () => {
  const scene = shieldScene({}, 50);
  const before = structuredClone(scene);
  assert.equal(moveReplayScene(scene, 11).pulse!.shields.a!.energy, 45);
  assert.equal(moveReplayScene(scene, 13).pulse!.shields.a!.energy, 55);
  const full = shieldScene({}, 100);
  for (const hour of [11, 13]) assert.deepEqual(moveReplayScene(full, hour).pulse!.shields, full.pulse!.shields);
  assert.deepEqual(scene, before);
});

test('living exposed shields retain their drain law', () => {
  const scene = shieldScene({}, 50, 2);
  const before = structuredClone(scene);
  assert.equal(moveReplayScene(scene, 11).pulse!.shields.a!.energy, 90);
  assert.equal(moveReplayScene(scene, 13).pulse!.shields.a!.energy, 10);
  assert.deepEqual(scene, before);
});

test('stasis still pauses recharge while disabled exposed shields do not drain', () => {
  for (const scene of [shieldScene({ stasisUntil: 14 }, 50), shieldScene({ shieldsDisabled: true }, 50, 2)]) {
    const before = structuredClone(scene);
    for (const hour of [11, 13]) assert.deepEqual(moveReplayScene(scene, hour).pulse!.shields, scene.pulse!.shields);
    assert.deepEqual(scene, before);
  }
});

test('exposed shields still drain in stasis and unexposed disabled shields still recharge', () => {
  for (const [scene, earlier, later] of [
    [shieldScene({ stasisUntil: 14 }, 50, 2), 90, 10],
    [shieldScene({ shieldsDisabled: true }, 50), 45, 55],
  ] as const) {
    const before = structuredClone(scene);
    assert.equal(moveReplayScene(scene, 11).pulse!.shields.a!.energy, earlier);
    assert.equal(moveReplayScene(scene, 13).pulse!.shields.a!.energy, later);
    assert.deepEqual(scene, before);
  }
});
