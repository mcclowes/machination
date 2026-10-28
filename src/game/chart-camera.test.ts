import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitPlayerCamera } from './chart-camera';
import { createConfiguredGame } from './world';
import { observe } from './visibility';

test('opening a large chart fits every owned site and does not depend on hidden enemy observations', () => {
  const game = createConfiguredGame({ playerCount: 10, mode: 'mining' }, 0, 3);
  const view = observe(game, 'zenith');
  const camera = fitPlayerCamera(view, 'zenith');
  assert.ok(camera.scale > 1 && camera.scale <= 4);
  for (const r of view.rocks.filter(r => r.owner === 'zenith')) {
    const x = (r.x / view.rules!.map.width * 100 - 50) * camera.scale + 50 + camera.x;
    const y = (r.y / view.rules!.map.height * 100 - 50) * camera.scale + 50 + camera.y;
    assert.ok(x >= 0 && x <= 100 && y >= 0 && y <= 100);
  }
  assert.deepEqual(fitPlayerCamera({ ...view, rocks: view.rocks.filter(r => r.owner === 'zenith') }, 'zenith'), camera);
});
test('empty observations fit the full chart and opposite owned corners remain reachable', () => {
  assert.deepEqual(fitPlayerCamera({ rocks: [] }, 'you'), { scale: 1, x: 0, y: 0 });
  const game = { rocks: [{ x: 0, y: 0, owner: 'you' as const }, { x: 100, y: 100, owner: 'you' as const }] };
  assert.deepEqual(fitPlayerCamera(game, 'you'), { scale: 1, x: 0, y: 0 });
});
