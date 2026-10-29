import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartOffsets, chartPosition, chartRoute, chartTransform, overlayLift, revealAboveCamera } from './chart-projection';
import { constrainCamera, focusCamera, zoomCamera } from './chart-camera';
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

// Issue #59: an inspected hauler must stay in the chart band above its bottom contextual card.
const screenY = (w: typeof world | { rules?: undefined }, camera: Parameters<typeof chartTransform>[1], point: { x: number; y: number }, viewport: { width: number; height: number }) =>
  chartOffsets(w, camera, viewport).map(offset => chartPosition(w, camera, { x: point.x + offset.x, y: point.y + offset.y }, viewport).y / 100 * viewport.height);

test('a focused point moves from under a tall bottom card to the centre of the clear band', () => {
  const phone = { width: 393, height: 616 }, card = 330;
  for (const point of [{ x: 100, y: 40 }, { x: 3, y: 78 }, { x: 197, y: 1 }]) for (const scale of [2, 4]) {
    const focused = focusCamera(world, { scale, x: 0, y: 0 }, point);
    assert.ok(screenY(world, focused, point, phone).some(y => Math.abs(y - phone.height / 2) < 1e-6), 'focus centres on the whole chart');
    const revealed = revealAboveCamera(world, focused, point, phone, card);
    assert.equal(revealed.scale, focused.scale); assert.equal(revealed.x, focused.x);
    assert.ok(screenY(world, revealed, point, phone).some(y => Math.abs(y - (phone.height - card) / 2) < 1e-6), `clear-band centre at ${point.x},${point.y} x${scale}`);
  }
});

test('a point already clear of the card keeps the manual camera', () => {
  const phone = { width: 393, height: 616 };
  const camera = constrainCamera(world, { scale: 2, x: 30, y: 40 });
  const point = { x: 100, y: 10 };
  const [y] = screenY(world, camera, point, phone).filter(y => y >= 22 && y <= 616 - 330 - 22);
  assert.ok(y !== undefined);
  assert.deepEqual(revealAboveCamera(world, camera, point, phone, 330), camera);
});

test('a bounded chart lifts for the card, and no card leaves focus unchanged', () => {
  const bounded = {}; const phone = { width: 393, height: 616 };
  const focused = focusCamera(bounded, { scale: 2, x: 0, y: 0 }, { x: 50, y: 50 });
  assert.deepEqual(revealAboveCamera(bounded, focused, { x: 50, y: 50 }, phone, 0), focused);
  const nearBottom = focusCamera(bounded, { scale: 2, x: 0, y: 0 }, { x: 50, y: 95 });
  const revealed = revealAboveCamera(bounded, nearBottom, { x: 50, y: 95 }, phone, 330);
  // Focus alone stops at the ordinary lower bound (scale 2 allows ±50); the reveal lifts past it for the card.
  assert.deepEqual(nearBottom, { scale: 2, x: 0, y: -50 });
  assert.ok(revealed.y < nearBottom.y);
});

test('an untiled chart lifts its lower edge above a tall card so bottom-edge haulers stay clear', () => {
  const bounded = {}; const phone = { width: 393, height: 616 }; const covered = 340;
  const lift = overlayLift(bounded, phone, covered);
  assert.equal(overlayLift(world, phone, covered), 0, 'tiled charts never need lift');
  assert.equal(overlayLift(bounded, phone, 0), 0);
  for (const y of [80, 95, 100]) for (const scale of [1, 2, 4]) {
    const point = { x: 50, y };
    const focused = constrainCamera(bounded, { scale, x: 0, y: (50 - y) * scale });
    const revealed = revealAboveCamera(bounded, focused, point, phone, covered);
    assert.equal(revealed.scale, scale);
    assert.deepEqual(constrainCamera(bounded, revealed, lift), revealed, 'the render clamp keeps the reveal while the card is open');
    const [shown] = screenY(bounded, revealed, point, phone);
    assert.ok(shown! >= 22 && shown! <= phone.height - covered, `y=${y} x${scale} lands at ${shown}`);
    assert.deepEqual(zoomCamera(bounded, revealed, scale, lift), revealed, 'starting a pinch does not discard the overlay allowance');
  }
  const lifted = revealAboveCamera(bounded, focusCamera(bounded, { scale: 2, x: 0, y: 0 }, { x: 50, y: 95 }), { x: 50, y: 95 }, phone, covered);
  assert.deepEqual(constrainCamera(bounded, lifted), { scale: 2, x: 0, y: -50 }, 'closing the card returns to the ordinary bound');
});
