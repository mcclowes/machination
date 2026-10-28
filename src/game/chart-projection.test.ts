import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartPosition, chartRoute } from './chart-projection';
import { constrainCamera } from './chart-camera';
import { mapOffsets } from './geometry';

const world = { rules: { map: { width: 200, height: 80, topology: 'torus' as const } } };
test('a short seam route and its translated contact agree on the visible copy after repeated pans', () => {
  const route = chartRoute(world, { x: 196, y: 78 }, { x: 4, y: 2 });
  assert.deepEqual(route, { from: { x: 196, y: 78 }, to: { x: 204, y: 82 } });
  for (const scale of [1, 4]) {
    const camera = constrainCamera(world, { scale, x: 50 * scale + 100 * scale * 20, y: 50 * scale });
    const endpoint = chartPosition(world, camera, route.to);
    const copies = mapOffsets(world).map(offset => chartPosition(world, camera, { x: 4 + offset.x, y: 2 + offset.y }));
    assert.ok(copies.some(copy => copy.x === endpoint.x && copy.y === endpoint.y));
    assert.ok(copies.some(copy => copy.x >= 0 && copy.x <= 100 && copy.y >= 0 && copy.y <= 100));
  }
});
test('legacy routes and projection keep their planar coordinates', () => {
  assert.deepEqual(chartRoute({}, { x: 98, y: 98 }, { x: 2, y: 2 }).to, { x: 2, y: 2 });
  assert.deepEqual(chartPosition({}, { scale: 1, x: 0, y: 0 }, { x: 25, y: 75 }), { x: 25, y: 75 });
});

test('Fit projects exactly one complete tile, and sensor circles carry across both seams', () => {
  const camera = { scale: 1, x: 0, y: 0 };
  assert.deepEqual(chartPosition(world, camera, { x: 0, y: 0 }), { x: 0, y: 0 });
  assert.deepEqual(chartPosition(world, camera, { x: 200, y: 80 }), { x: 100, y: 100 });
  const sensor = { x: 198, y: 79, radius: 5 };
  const target = chartPosition(world, camera, { x: 1, y: 1 });
  const coveringCopies = mapOffsets(world).filter(offset => {
    const center = chartPosition(world, camera, { x: sensor.x + offset.x, y: sensor.y + offset.y });
    const dx = (target.x - center.x) / (sensor.radius / 200 * 100);
    const dy = (target.y - center.y) / (sensor.radius / 80 * 100);
    return dx * dx + dy * dy <= 1;
  });
  assert.deepEqual(coveringCopies, [{ x: -200, y: -80 }]);
});
