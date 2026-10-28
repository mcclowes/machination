import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constrainCamera, fitPlayerCamera, zoomCamera } from './chart-camera';
import { createConfiguredGame } from './world';
import { observe } from './visibility';
import { mapOffsets } from './geometry';

test('opening a large chart fits every owned site and does not depend on hidden enemy observations', () => {
  const game = createConfiguredGame({ playerCount: 10, mode: 'mining' }, 0, 3);
  const view = observe(game, 'zenith');
  const camera = fitPlayerCamera(view, 'zenith');
  assert.ok(camera.scale >= 1 && camera.scale <= 4);
  for (const r of view.rocks.filter(r => r.owner === 'zenith')) {
    assert.ok(mapOffsets(view).some(offset => {
      const x = ((r.x + offset.x) / view.rules!.map.width * 100 - 50) * camera.scale + 50 + camera.x;
      const y = ((r.y + offset.y) / view.rules!.map.height * 100 - 50) * camera.scale + 50 + camera.y;
      return x >= 0 && x <= 100 && y >= 0 && y <= 100;
    }));
  }
  assert.deepEqual(fitPlayerCamera({ ...view, rocks: view.rocks.filter(r => r.owner === 'zenith') }, 'zenith'), camera);
});
test('empty observations fit the full chart and opposite owned corners remain reachable', () => {
  assert.deepEqual(fitPlayerCamera({ rocks: [] }, 'you'), { scale: 1, x: 0, y: 0 });
  const game = { rocks: [{ x: 0, y: 0, owner: 'you' as const }, { x: 100, y: 100, owner: 'you' as const }] };
  assert.deepEqual(fitPlayerCamera(game, 'you'), { scale: 1, x: 0, y: 0 });
});

test('Home fits a compact owned territory spanning both seams without using enemy sites', () => {
  const chart = { rules: { map: { width: 200, height: 100, topology: 'torus' as const } }, rocks: [
    { x: 196, y: 98, owner: 'you' as const }, { x: 4, y: 2, owner: 'you' as const },
  ] };
  const camera = fitPlayerCamera(chart, 'you');
  assert.equal(camera.scale, 4);
  assert.ok(Math.abs(camera.x) === 200 && Math.abs(camera.y) === 200);
  assert.deepEqual(fitPlayerCamera({ ...chart, rocks: [...chart.rocks, { x: 100, y: 50, owner: 'zenith' as const }] }, 'you'), camera);
});

test('torus panning stays periodic at Fit and zoom while legacy charts clamp', () => {
  const world = { rules: { map: { width: 200, height: 80, topology: 'torus' as const } } };
  for (const scale of [1, 2, 4]) {
    assert.deepEqual(constrainCamera(world, { scale, x: 25 + 100 * scale * 31, y: -30 - 100 * scale * 17 }), { scale, x: 25, y: -30 });
  }
  assert.deepEqual(constrainCamera({}, { scale: 1, x: 25, y: -30 }), { scale: 1, x: 0, y: 0 });
  assert.deepEqual(constrainCamera({}, { scale: 2, x: 999, y: -999 }), { scale: 2, x: 50, y: -50 });
});

test('zoom preserves the viewed world center after a seam pan', () => {
  const world = { rules: { map: { width: 200, height: 80, topology: 'torus' as const } } };
  const camera = { scale: 1, x: 40, y: -30 };
  assert.deepEqual(zoomCamera(world, camera, 4), { scale: 4, x: 160, y: -120 });
  assert.deepEqual(zoomCamera(world, zoomCamera(world, camera, 4), 1), camera);
});
