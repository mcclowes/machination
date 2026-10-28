import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartOffsets, chartPosition, chartRoute, chartTransform } from './chart-projection';
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

test('phone, landscape, and open-sheet viewports preserve circular ranges and equal world distances', () => {
  for (const viewport of [{ width: 390, height: 780 }, { width: 390, height: 180 }, { width: 1000, height: 500 }]) {
    for (const scale of [1, 2, 4]) {
      const camera = { scale, x: 23, y: -31 };
      const center = chartPosition(world, camera, { x: 100, y: 40 }, viewport);
      const east = chartPosition(world, camera, { x: 110, y: 40 }, viewport);
      const south = chartPosition(world, camera, { x: 100, y: 50 }, viewport);
      const horizontalRadius = (east.x - center.x) / 100 * viewport.width;
      const verticalRadius = (south.y - center.y) / 100 * viewport.height;
      assert.ok(Math.abs(horizontalRadius - verticalRadius) < 1e-9, 'Equal world distances must occupy equal screen distances');
      const transform = chartTransform(world, camera, viewport);
      assert.ok(Math.abs(center.x / 100 * viewport.width - (transform.x + 100 * transform.scale)) < 1e-9, 'SVG and touch targets share one projection');
      assert.ok(Math.abs(center.y / 100 * viewport.height - (transform.y + 40 * transform.scale)) < 1e-9);
    }
  }
});

test('tall torus viewports remain tiled across the entire screen after panning', () => {
  const viewport = { width: 390, height: 900 };
  const camera = constrainCamera(world, { scale: 1, x: 45, y: -45 });
  const offsets = chartOffsets(world, camera, viewport);
  for (const x of [0, 50, 100]) for (const y of [0, 50, 100]) {
    assert.ok(offsets.some(offset => {
      const first = chartPosition(world, camera, offset, viewport);
      const last = chartPosition(world, camera, { x: offset.x + 200, y: offset.y + 80 }, viewport);
      return first.x <= x && last.x >= x && first.y <= y && last.y >= y;
    }), `Wrapped geometry must cover screen position ${x}, ${y}`);
  }
});
