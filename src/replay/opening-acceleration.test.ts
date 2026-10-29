import assert from 'node:assert/strict';
import { test } from 'node:test';
import { travelProgress } from '../game/opening-clock';
import { wrapPoint, worldDistance } from '../game/geometry';
import { replayFleetPosition } from './playback';
import type { ReplayScene } from './presentation';
import { distanceBounds, motionPosition, nextHour, previousHour } from './numeric-support';
import { continuousVisibilityIntervals, flightMotionSpans, visibilityIntervals } from './visibility-intervals';

const fleet = { id: 1, owner: 'you' as const, from: 'a', to: 'b', drones: 1, departed: 11, arrives: 12.5,
  route: { from: { x: 9, y: 1 }, to: { x: 25, y: 1 } } };
function world(mechanicsVersion = 9, wrapped = false) {
  return { hour: 11, rocks: [{ id: 'a', x: 9, y: 1 }, { id: 'b', x: 25, y: 1 }],
    rules: { mechanicsVersion, map: { width: 20, height: 20, ...(wrapped ? { topology: 'torus' as const } : {}) } } };
}

test('replay and numeric source positions use the shared clock at adjacent boundary hours and wrapped seams', () => {
  for (const revision of [1, 5, 6, 7, 8, 9]) for (const wrapped of [false, true]) {
    const w = world(revision, wrapped);
    const spans = flightMotionSpans(w, fleet, 10, 14);
    for (const hour of [10, 11, 11.5, previousHour(12), 12, nextHour(12), 12.25, 12.5, 14]) {
      const progress = travelProgress(w, fleet.departed, fleet.arrives, hour);
      const expected = wrapPoint(w, { x: 9 + 16 * progress, y: 1 });
      assert.deepEqual(replayFleetPosition({ ...w, hour } as unknown as ReplayScene, fleet), expected);
      assert.deepEqual(wrapPoint(w, motionPosition(spans[0]!.motion, 10, hour)), expected);
      if (revision < 9) assert.equal(progress, Math.max(0, Math.min(1, (hour - 11) / 1.5)));
    }
  }
  assert.equal(replayFleetPosition({ ...world(), hour: 12 } as unknown as ReplayScene, fleet).x, 21);
});

test('motion spans split the opening boundary and retain preparation and arrival clamps', () => {
  const pieces = flightMotionSpans(world(), fleet, 10, 14);
  assert.deepEqual(pieces.map(p => [p.from, p.through]), [[10, 11], [11, 12], [12, 12.5], [12.5, 14]]);
  assert.deepEqual(pieces.map(p => p.motion.velocity.x), [0, 12, 8, 0]);
  assert.deepEqual(flightMotionSpans(world(8), fleet, 10, 14).map(p => [p.from, p.through]), [[10, 11], [11, 12.5], [12.5, 14]]);
  for (const [departed, arrives, velocity] of [[9, 10, 16], [12, 14, 8], [13, 15, 8]] as const) {
    const leg = { ...fleet, departed, arrives };
    assert.equal(flightMotionSpans(world(), leg, departed, arrives)[0]!.motion.velocity.x, velocity);
  }
});

test('piecewise visibility windows agree with source positions through the boundary and torus seam', () => {
  for (const wrapped of [false, true]) {
    const w = world(9, wrapped);
    const sensor = { position: { x: wrapped ? 1 : 21, y: 1 }, velocity: { x: 0, y: 0 }, radius: 2 };
    const pieces = flightMotionSpans(w, fleet, 11, 12.5);
    const continuous = pieces.flatMap(p => continuousVisibilityIntervals(w, p.motion, [sensor], p.from, p.through));
    assert.ok(Math.abs(continuous[0]!.from - (12 - 1 / 6)) < 1e-12);
    assert.equal(continuous.at(-1)!.through, 12.25);
    const windows = pieces.flatMap(p => visibilityIntervals(w, p.motion, [sensor], p.from, p.through));
    const contains = (hour: number) => windows.some(p => p.from <= hour && hour <= p.through);
    for (const hour of [11, 11.8, 11.9, previousHour(12), 12, nextHour(12), 12.2, 12.3, 12.5,
      ...windows.flatMap(p => [previousHour(p.from), p.from, nextHour(p.from), previousHour(p.through), p.through, nextHour(p.through)])]) {
      if (hour < 11 || hour > 12.5) continue;
      assert.equal(contains(hour), worldDistance(w, wrapPoint(w, motionPosition(pieces[0]!.motion, 11, hour)), sensor.position) <= sensor.radius, `hour ${hour}`);
    }
  }
});

test('numeric bounds include accelerated motion and identical-flight shortcut distinguishes clocks', () => {
  const motion = flightMotionSpans(world(), fleet, 11, 12.5)[0]!.motion;
  const identical = { ...motion, source: { ...motion.source! } };
  assert.deepEqual(distanceBounds(world(), motion, identical, 11, 11, 12.5), [0, 0]);
  assert.deepEqual(visibilityIntervals(world(), motion, [{ ...identical, radius: 0 }], 11, 12), [{ from: 11, through: 12 }]);
  const legacy = { ...motion, source: { ...motion.source!, mechanicsVersion: 8 } };
  const bounds = distanceBounds(world(), motion, legacy, 11, 12, 12);
  const distance = worldDistance(world(), motionPosition(motion, 11, 12), motionPosition(legacy, 11, 12));
  assert.ok(distance > 0);
  assert.deepEqual(bounds, [distance, distance]);
  const sensor = { position: { x: 21, y: 1 }, velocity: { x: 0, y: 0 } };
  const enclosure = distanceBounds(world(), motion, sensor, 11, 11.5, 12.25);
  for (const hour of [11.5, previousHour(12), 12, nextHour(12), 12.25]) {
    const d = worldDistance(world(), motionPosition(motion, 11, hour), sensor.position);
    assert.ok(d >= enclosure[0] && d <= enclosure[1]);
  }
});
