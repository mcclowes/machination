import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flightMotionSpans, VisibilityCapacityError, visibilityIntervals } from './visibility-intervals';
import { fleetPosition } from '../game/flight';
import { worldDistance, wrapPoint } from '../game/geometry';

test('an entire short contact survives between sampled endpoints', () => {
  const point = { position: { x: -10, y: 0 }, velocity: { x: 4, y: 0 } };
  const sensors = [{ position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, radius: 2 }];
  assert.deepEqual(visibilityIntervals({}, point, sensors, 1, 5), [{ from: 3, through: 4 }]);
});

test('closed contacts retain tangency, stationary boundaries, and overlapping coverage', () => {
  const stationary = { velocity: { x: 0, y: 0 } };
  const sensor = { ...stationary, position: { x: 0, y: 0 }, radius: 1 };
  assert.deepEqual(visibilityIntervals({}, { position: { x: -2, y: 1 }, velocity: { x: 4, y: 0 } }, [sensor], 7, 8), [{ from: 7.5, through: 7.5 }]);
  assert.deepEqual(visibilityIntervals({}, { ...stationary, position: { x: 1, y: 0 } }, [sensor], 7, 8), [{ from: 7, through: 8 }]);
  assert.deepEqual(visibilityIntervals({}, { ...stationary, position: { x: 1.001, y: 0 } }, [sensor], 7, 8), []);
  assert.deepEqual(visibilityIntervals({}, { ...stationary, position: { x: 0, y: 0 } }, [sensor], 7, 7), [{ from: 7, through: 7 }]);
  assert.deepEqual(visibilityIntervals({}, { position: { x: -4, y: 0 }, velocity: { x: 1, y: 0 } }, [
    { ...stationary, position: { x: -1, y: 0 }, radius: 2 },
    { ...stationary, position: { x: 1, y: 0 }, radius: 2 },
  ], 0, 8), [{ from: 1, through: 7 }]);
  assert.deepEqual(visibilityIntervals({}, { position: { x: -1, y: 0 }, velocity: { x: 2, y: 0 } }, [{ ...sensor, radius: 0 }], 0, 1), [{ from: 0.5, through: 0.5 }]);
});

test('moving legacy sensors use relative motion rather than static sample circles', () => {
  const stationary = { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } };
  assert.deepEqual(visibilityIntervals({}, stationary, [{ position: { x: -10, y: 0 }, velocity: { x: 4, y: 0 }, radius: 2 }], 0, 4), [{ from: 2, through: 3 }]);
  assert.deepEqual(visibilityIntervals({}, { position: { x: -10, y: 0 }, velocity: { x: 8, y: 0 } }, [{ ...stationary, velocity: { x: 4, y: 0 }, radius: 2 }], 0, 4), [{ from: 2, through: 3 }]);
  assert.deepEqual(visibilityIntervals({}, { position: { x: 2, y: 0 }, velocity: { x: 4, y: 0 } }, [{ ...stationary, velocity: { x: 4, y: 0 }, radius: 2 }], 0, 4), [{ from: 0, through: 4 }]);
});

test('wrapped contacts cover repeated seam crossings beyond nine local images', () => {
  const world = { rules: { map: { width: 10, height: 20, topology: 'torus' as const } } };
  const point = { position: { x: 9, y: 0 }, velocity: { x: 2, y: 0 } };
  const sensor = { position: { x: 1, y: 0 }, velocity: { x: 0, y: 0 }, radius: 0.5 };
  const windows = visibilityIntervals(world, point, [sensor], 0, 18);
  assert.equal(windows.length, 4);
  for (let i = 0; i < windows.length; i++) {
    assert.ok(Math.abs(windows[i]!.from - (0.75 + i * 5)) < 1e-12);
    assert.ok(Math.abs(windows[i]!.through - (1.25 + i * 5)) < 1e-12);
  }
});

test('flight pieces retain preparation clamps, unwrapped seam motion, and arrival clamps', () => {
  const world = { hour: 0, rules: { map: { width: 10, height: 10, topology: 'torus' as const } }, rocks: [{ id: 'a', x: 9, y: 1 }, { id: 'b', x: 1, y: 1 }] };
  const fleet = { id: 1, owner: 'you' as const, from: 'a', to: 'b', drones: 1, departed: 1, arrives: 3 };
  const pieces = flightMotionSpans(world, fleet, 0, 4);
  assert.deepEqual(pieces.map(piece => [piece.from, piece.through]), [[0, 1], [1, 3], [3, 4]]);
  assert.deepEqual(pieces.map(piece => piece.motion.velocity), [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }]);
  for (const piece of pieces) for (const hour of [piece.from, (piece.from + piece.through) / 2, piece.through]) {
    const point = wrapPoint(world, { x: piece.motion.position.x + piece.motion.velocity.x * (hour - piece.from), y: piece.motion.position.y + piece.motion.velocity.y * (hour - piece.from) });
    assert.deepEqual(point, fleetPosition({ ...world, hour }, fleet));
  }
  assert.equal(flightMotionSpans(world, fleet, 2, 2).length, 1);
});

test('differential interior queries agree with existing wrapped and planar distance predicates', () => {
  let seed = 314159;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (const topology of [undefined, 'torus' as const]) {
    const world = { rules: { map: { width: 12, height: 9, ...(topology ? { topology } : {}) } } };
    for (let i = 0; i < 60; i++) {
      const point = { position: { x: random() * 12, y: random() * 9 }, velocity: { x: random() * 30 - 15, y: random() * 20 - 10 } };
      const sensors = Array.from({ length: 2 }, () => ({ position: { x: random() * 12, y: random() * 9 }, velocity: { x: random() * 4 - 2, y: random() * 4 - 2 }, radius: random() * 4 }));
      const windows = visibilityIntervals(world, point, sensors, 2, 5);
      for (let step = 0; step <= 40; step++) {
        const delta = step * 3 / 40, hour = 2 + delta;
        const expected = sensors.some(sensor => worldDistance(world,
          { x: point.position.x + point.velocity.x * delta, y: point.position.y + point.velocity.y * delta },
          { x: sensor.position.x + sensor.velocity.x * delta, y: sensor.position.y + sensor.velocity.y * delta }) <= sensor.radius);
        assert.equal(windows.some(window => hour >= window.from && hour <= window.through), expected);
      }
    }
  }
});

test('invalid or excessive geometry refuses instead of truncating contact support', () => {
  const point = { position: { x: 0, y: 0 }, velocity: { x: 1, y: 0 } };
  const sensor = { position: { x: 1, y: 0 }, velocity: { x: 0, y: 0 }, radius: 0.1 };
  assert.throws(() => visibilityIntervals({}, point, [sensor], 2, 1), RangeError);
  assert.throws(() => visibilityIntervals({}, point, [{ ...sensor, radius: -1 }], 0, 1), RangeError);
  assert.throws(() => visibilityIntervals({}, { ...point, velocity: { x: Infinity, y: 0 } }, [sensor], 0, 1), RangeError);
  const world = { rules: { map: { width: 10, height: 20, topology: 'torus' as const } } };
  assert.throws(() => visibilityIntervals(world, { ...point, velocity: { x: 1e9, y: 0 } }, [sensor], 0, 1), VisibilityCapacityError);
  assert.deepEqual(visibilityIntervals({ rules: { map: { width: 10, height: 100, topology: 'torus' } } }, { position: { x: 0, y: 50 }, velocity: { x: 1e15, y: 0 } }, [sensor], 0, 1), [], 'An empty image axis skips all winding work');
  assert.deepEqual(visibilityIntervals(world, point, [{ ...sensor, radius: 20 }], 0, 1), [{ from: 0, through: 1 }]);
});
