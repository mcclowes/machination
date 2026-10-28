import { fleetPosition } from '../game/flight';
import { worldDistance } from '../game/geometry';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atOrdinal, ordinal, nextHour, previousHour, hypotBounds, requireNumericRuntime, UnsupportedVisibilityNumericError, distanceBounds } from './numeric-support';

test('ordinal splits preserve adjacent positive binary64 values including subnormals', () => {
  for (const hour of [0, Number.MIN_VALUE, 0.1, 7.5, 2 ** 50, Number.MAX_VALUE]) assert.equal(atOrdinal(ordinal(hour)), hour);
  assert.equal(nextHour(0), Number.MIN_VALUE);
  for (const hour of [0.1, 7.5, 2 ** 50]) {
    assert.ok(previousHour(hour) < hour && nextHour(hour) > hour);
    assert.equal(nextHour(previousHour(hour)), hour);
  }
});

test('pinned hypot operation enclosures cover every input in small binary64 rectangles', () => {
  requireNumericRuntime();
  for (const [a, b] of [[0, 0], [1, 1], [0.75, 1], [1, 0.75], [Number.MIN_VALUE, 2 * Number.MIN_VALUE], [1e-200, 1e-200], [1e200, 1e200]]) {
    const xs = Array.from({ length: 20 }, (_, i) => atOrdinal(ordinal(a!) + BigInt(i)));
    const ys = Array.from({ length: 20 }, (_, i) => atOrdinal(ordinal(b!) + BigInt(i)));
    const [lo, hi] = hypotBounds([xs[0]!, xs.at(-1)!], [ys[0]!, ys.at(-1)!]);
    for (const x of xs) for (const y of ys) {
      const actual = Math.hypot(x, y);
      assert.ok(lo <= actual && actual <= hi, `${x}, ${y}`);
    }
  }
});

test('unknown and replaced numeric runtimes refuse instead of publishing assumed bounds', () => {
  const descriptor = Object.getOwnPropertyDescriptor(process.versions, 'v8')!;
  try {
    Object.defineProperty(process.versions, 'v8', { ...descriptor, value: 'unknown' });
    assert.throws(requireNumericRuntime, UnsupportedVisibilityNumericError);
  } finally { Object.defineProperty(process.versions, 'v8', descriptor); }
  const original = Math.hypot;
  try {
    Math.hypot = () => 1;
    assert.throws(requireNumericRuntime, UnsupportedVisibilityNumericError);
  } finally { Math.hypot = original; }
});

test('nonfinite source arithmetic refuses without numeric data in the error', () => {
  const point = { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, source: { from: { x: -Number.MAX_VALUE, y: 0 }, to: { x: Number.MAX_VALUE, y: 0 }, departed: 0, arrives: 1 } };
  assert.throws(() => distanceBounds({}, point, point, 0, 0, 1), error => error instanceof UnsupportedVisibilityNumericError && error.code === 'unsupported-visibility-numeric' && !error.message.includes(String(Number.MAX_VALUE)));
});

test('coordinate bounds enclose every value across binary64 modulo and shortest-image cuts', () => {
  const world = { rules: { map: { width: 10, height: 10, topology: 'torus' as const } } };
  const sensor = { position: { x: 0, y: 1 }, velocity: { x: 0, y: 0 } };
  for (const center of [1, 2, 5, 10, 20]) for (const velocity of [-10, 10]) for (const flight of [false, true]) {
    const point = { position: { x: 0, y: 0 }, velocity: { x: velocity, y: 0 }, ...(flight ? { source: { from: { x: 0, y: 0 }, to: { x: 100 * velocity, y: 0 }, departed: 0, arrives: 100 } } : {}) };
    const times = Array.from({ length: 33 }, (_, i) => atOrdinal(ordinal(center) - 16n + BigInt(i)));
    const [lo, hi] = distanceBounds(world, point, sensor, 0, times[0]!, times.at(-1)!);
    for (const hour of times) {
      const p = flight ? fleetPosition({ ...world, rocks: [], hour }, { id: 1, owner: 'you', from: 'a', to: 'b', drones: 1, departed: 0, arrives: 100, route: point.source! }) : { x: velocity * hour, y: 0 };
      const actual = worldDistance(world, sensor.position, p);
      assert.ok(lo <= actual && actual <= hi, `${hour}, ${velocity}, ${flight}`);
    }
  }
});
