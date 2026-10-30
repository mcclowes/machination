import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutSpecialistMarkers, mapSpecialistSummary, specialistManifestDescription, specialistMarkerPlacement } from './map-specialists';
import { layoutSiteNames } from './map-labels';
import type { Specialist } from '../game/specialists';

const unit = (id: string, kind: Specialist['kind'], owner: Specialist['owner'] = 'you', captive?: true): Specialist => ({ id, kind, owner, ...(captive ? { captive } : {}) });
const viewport = { width: 300, height: 300 };

test('zero-drone haulers still summarize their specialist manifest', () => {
  const hauler = { drones: 0, specialists: [unit('a', 'pirate')] };
  const summary = mapSpecialistSummary(hauler);
  assert.deepEqual(summary.displayed, [{ kind: 'pirate', owner: 'you', captive: false, count: 1 }]);
  assert.equal(summary.total, 1);
  assert.equal(summary.overflow, 0);
  assert.deepEqual(mapSpecialistSummary({ specialists: [] }).groups, []);
});

test('repeated matching kinds group with counts; queen leads, then catalog order', () => {
  const summary = mapSpecialistSummary({ specialists: [unit('a', 'thief'), unit('b', 'lieutenant'), unit('c', 'queen'), unit('d', 'lieutenant')] });
  assert.deepEqual(summary.groups.map(g => [g.kind, g.count]), [['queen', 1], ['lieutenant', 2], ['thief', 1]]);
  assert.equal(summary.total, 4);
});

test('different owners and captives stay in separate groups', () => {
  const summary = mapSpecialistSummary({ specialists: [unit('a', 'diplomat', 'vesper', true), unit('b', 'diplomat'), unit('c', 'diplomat', 'vesper'), unit('d', 'diplomat', 'vesper', true)] });
  assert.deepEqual(summary.groups, [
    { kind: 'diplomat', owner: 'you', captive: false, count: 1 },
    { kind: 'diplomat', owner: 'vesper', captive: false, count: 1 },
    { kind: 'diplomat', owner: 'vesper', captive: true, count: 2 },
  ]);
  assert.equal(specialistManifestDescription(summary), 'Envoy (Mnemosyne), Envoy (Vesper), 2 × Envoy (Vesper, captive)');
  assert.equal(specialistManifestDescription(summary, owner => owner === 'vesper' ? 'Kade' : 'You'), 'Envoy (You), Envoy (Kade), 2 × Envoy (Kade, captive)');
});

test('at most three groups display and overflow counts remaining units, not groups', () => {
  const summary = mapSpecialistSummary({ specialists: [unit('a', 'queen'), unit('b', 'diplomat'), unit('c', 'elder'), unit('d', 'foreman'), unit('e', 'foreman'), unit('f', 'pirate')] });
  assert.equal(summary.displayed.length, 3);
  assert.equal(summary.groups.length, 5);
  assert.equal(summary.overflow, 3);
  assert.equal(summary.total, 6);
  assert.match(specialistManifestDescription(summary), /2 × Fabricator.*Interceptor/);
});

test('summary is independent of manifest order', () => {
  const units = [unit('a', 'saboteur', 'vesper'), unit('b', 'queen'), unit('c', 'thief'), unit('d', 'saboteur', 'vesper'), unit('e', 'thief', 'vesper', true)];
  assert.deepEqual(mapSpecialistSummary({ specialists: [...units].reverse() }), mapSpecialistSummary({ specialists: units }));
});

test('unknown, destroyed, and malformed sites never reveal units', () => {
  const leaked = [unit('a', 'queen')];
  assert.equal(mapSpecialistSummary({ known: false, specialists: leaked }).total, 0);
  assert.equal(mapSpecialistSummary({ known: true, destroyed: true, specialists: leaked }).total, 0);
  assert.equal(mapSpecialistSummary({ specialists: 'queen' } as never).total, 0);
  assert.deepEqual(mapSpecialistSummary({ specialists: [null, { kind: 'wizard', owner: 'you' }, { kind: 'queen', owner: 'nobody' }, unit('ok', 'elder')] } as never).groups.map(g => g.kind), ['elder']);
  assert.equal(specialistManifestDescription(mapSpecialistSummary({ known: false })), '');
});

test('markers sit above the anchor, fall below at the top edge, and clamp horizontally', () => {
  const two = mapSpecialistSummary({ specialists: [unit('a', 'queen'), unit('b', 'elder')] });
  assert.deepEqual(specialistMarkerPlacement({ x: 100, y: 100 }, 18, viewport, two), { left: 75, top: 44, width: 50, height: 24, side: 'above' });
  assert.equal(specialistMarkerPlacement({ x: 100, y: 30 }, 18, viewport, two)?.side, 'below');
  assert.equal(specialistMarkerPlacement({ x: 100, y: 30 }, 18, viewport, two)?.top, 62);
  assert.equal(specialistMarkerPlacement({ x: 2, y: 100 }, 18, viewport, two)?.left, 10);
  assert.equal(specialistMarkerPlacement({ x: 299, y: 100 }, 18, viewport, two)?.left, 240);
  const overflow = mapSpecialistSummary({ specialists: ['queen', 'diplomat', 'elder', 'foreman'].map((k, i) => unit(`${i}`, k as Specialist['kind'])) });
  assert.equal(specialistMarkerPlacement({ x: 100, y: 100 }, 18, viewport, overflow)?.width, 4 * 24 + 3 * 2);
});

test('markers are omitted when empty, off-screen, or without vertical room', () => {
  const one = mapSpecialistSummary({ specialists: [unit('a', 'queen')] });
  assert.equal(specialistMarkerPlacement({ x: 100, y: 100 }, 18, viewport, mapSpecialistSummary({})), undefined);
  assert.equal(specialistMarkerPlacement({ x: -5, y: 100 }, 18, viewport, one), undefined);
  assert.equal(specialistMarkerPlacement({ x: 100, y: 301 }, 18, viewport, one), undefined);
  assert.equal(specialistMarkerPlacement({ x: 30, y: 30 }, 18, { width: 60, height: 60 }, one), undefined);
  const four = mapSpecialistSummary({ specialists: ['queen', 'diplomat', 'elder', 'foreman'].map((k, i) => unit(`${i}`, k as Specialist['kind'])) });
  assert.equal(specialistMarkerPlacement({ x: 30, y: 100 }, 18, { width: 60, height: 300 }, four), undefined, 'A row must not overflow a narrow viewport');
});

test('names avoid their own and neighboring specialist markers', () => {
  const one = mapSpecialistSummary({ specialists: [unit('a', 'queen')] });
  const site = { key: 'a', x: 100, y: 30, priority: 0 };
  const own = specialistMarkerPlacement(site, 18, viewport, one)!;
  assert.equal(own.side, 'below');
  const rect = (p: typeof own) => ({ x: p.left, y: p.top, width: p.width, height: p.height });
  assert.equal(layoutSiteNames([site], viewport).get('a'), 'below');
  assert.equal(layoutSiteNames([site], viewport, [rect(own)]).has('a'), false, 'No room above, own marker below');
  const dense = [{ key: 'top', x: 100, y: 100, priority: 1 }, { key: 'low', x: 100, y: 170, priority: 0 }];
  const neighbor = rect(specialistMarkerPlacement(dense[1]!, 18, viewport, one)!);
  assert.equal(layoutSiteNames(dense, viewport, [neighbor]).get('top'), 'above', 'Neighbor marker above the lower site blocks the name below');
  assert.deepEqual([...layoutSiteNames(dense, viewport, [neighbor])], [...layoutSiteNames([...dense].reverse(), viewport, [neighbor])]);
});

test('a preparing hauler can place its crew below an outpost with badges above', () => {
  const summary = mapSpecialistSummary({ specialists: [unit('a', 'queen')] });
  const point = { x: 100, y: 100 };
  const site = specialistMarkerPlacement(point, 22, viewport, summary)!;
  const obstacle = { x: site.left, y: site.top, width: site.width, height: site.height };
  const hauler = specialistMarkerPlacement(point, 22, viewport, summary, [obstacle])!;
  assert.equal(site.side, 'above');
  assert.equal(hauler.side, 'below');
  assert.ok(hauler.top >= site.top + site.height);
});

test('a specialist hauler badge fits throughout the retained band above its inspector', () => {
  const summary = mapSpecialistSummary({ specialists: [unit('a', 'helmsman')] });
  for (let y = 22; y <= 128; y++) {
    const row = specialistMarkerPlacement({ x: 190, y }, 22, { width: 393, height: 150 }, summary);
    assert.ok(row, `Selected hauler at y=${y} retains a crew marker`);
    assert.ok(row.top >= 10 && row.top + row.height + 10 <= 150, 'The full 44px touch height remains in the clear band');
  }
});

test('crowded specialist rows prioritize inspection and remain stable when asset order changes', () => {
  const specialists = mapSpecialistSummary({ specialists: [unit('a', 'queen')] });
  const anchors = [{ key: 'other', x: 100, y: 100, radius: 22, priority: 1, specialists },
    { key: 'selected', x: 100, y: 100, radius: 22, priority: 100, specialists },
    { key: 'third', x: 100, y: 100, radius: 22, priority: 0, specialists }];
  const placed = layoutSpecialistMarkers(anchors, viewport);
  assert.equal(placed.get('selected')!.side, 'above');
  assert.equal(placed.get('other')!.side, 'below');
  assert.equal(placed.has('third'), false, 'The extra manifest remains inspectable without overlapping crew rows');
  assert.deepEqual([...placed], [...layoutSpecialistMarkers([...anchors].reverse(), viewport)]);
});

test('specialist rows avoid neighboring base and drone-count bounds even when those assets have no specialists', () => {
  const specialists = mapSpecialistSummary({ specialists: [unit('a', 'queen')] });
  const placed = layoutSpecialistMarkers([
    { key: 'crew', x: 100, y: 100, radius: 18, priority: 10, specialists },
    { key: 'neighbor', x: 100, y: 60, radius: 18, priority: 0, specialists: mapSpecialistSummary({}) },
  ], viewport);
  assert.equal(placed.get('crew')!.side, 'below', 'An empty neighboring base still blocks the row above');
});

test('badge touch padding clears neighboring site controls and long drone inventories', () => {
  const specialists = mapSpecialistSummary({ specialists: [unit('a', 'pirate')] });
  for (const x of [160, 265]) {
    const placed = layoutSpecialistMarkers([
      { key: 'neighbor', x: 200, y: 100, radius: 18, priority: 0, specialists: mapSpecialistSummary({}), drones: 9999 },
      { key: 'crew', x, y: 136, radius: 18, priority: 10, specialists },
    ], { width: 400, height: 400 });
    assert.equal(placed.get('crew')!.side, 'below', `Row at ${x} must not steal the neighbor's tap or cover its count`);
  }
});
