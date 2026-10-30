import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutSiteNames, mapMarkerBounds, MAP_DRONE_COUNT_OFFSET, MAP_DRONE_COUNT_SIZE } from './map-labels';

test('crowded names give the selected site priority and never cover another marker', () => {
  const sites = [{ key: 'neighbor', x: 110, y: 100, priority: 0 }, { key: 'other', x: 115, y: 100, priority: 0 }, { key: 'selected', x: 100, y: 100, priority: 10 }];
  const labels = layoutSiteNames(sites, { width: 300, height: 300 });
  assert.ok(labels.has('selected'));
  assert.ok(labels.size < sites.length, 'Overlapping names are suppressed');
  assert.deepEqual([...labels], [...layoutSiteNames([...sites].reverse(), { width: 300, height: 300 })]);
  const obstructed = layoutSiteNames([{ key: 'a', x: 100, y: 100, priority: 1, flexible: true }, { key: 'b', x: 100, y: 140, priority: 0 }], { width: 300, height: 300 });
  assert.equal(obstructed.get('a'), 'above', 'Move the selected name above its site when another marker is below it');
});

test('unselected names stay below their site and hide rather than flip', () => {
  const labels = layoutSiteNames([{ key: 'a', x: 100, y: 100, priority: 1 }, { key: 'b', x: 100, y: 140, priority: 0 }], { width: 300, height: 300 });
  assert.equal(labels.has('a'), false);
  assert.equal(labels.get('b'), 'below');
});

test('separated sites keep names, while edge labels stay inside the phone viewport', () => {
  const labels = layoutSiteNames([{ key: 'a', x: 70, y: 70, priority: 0 }, { key: 'b', x: 220, y: 190, priority: 0 }, { key: 'edge', x: 3, y: 20, priority: 0 }], { width: 300, height: 300 });
  assert.equal(labels.get('a'), 'below');
  assert.equal(labels.get('b'), 'below');
  assert.equal(labels.has('edge'), false);
});

test('names clear shield arcs on their own and neighboring bases', () => {
  const sites = [{ key: 'shielded', x: 100, y: 100, priority: 1, radius: 34, flexible: true }];
  assert.equal(layoutSiteNames(sites, { width: 300, height: 300 }).get('shielded'), 'below');
  assert.equal(layoutSiteNames(sites, { width: 300, height: 145 }).get('shielded'), 'above', 'The lower name must clear the outer arc and viewport edge');
  assert.equal(layoutSiteNames([
    { key: 'a', x: 100, y: 100, priority: 1, flexible: true },
    { key: 'b', x: 100, y: 150, priority: 0, radius: 34 },
  ], { width: 300, height: 300 }).get('a'), 'above', 'Neighboring shields also obstruct names');
});

test('drone count badges reserve their full pill beside the marker', () => {
  const single = mapMarkerBounds({ x: 100, y: 100, drones: 4 });
  const triple = mapMarkerBounds({ x: 100, y: 100, drones: 400 });
  assert.ok(triple.width > single.width);
  assert.ok(triple.x + triple.width >= 100 + MAP_DRONE_COUNT_OFFSET + 3 * Math.ceil(MAP_DRONE_COUNT_SIZE * 0.7));
  assert.equal(mapMarkerBounds({ x: 100, y: 100, drones: 0 }).width, 36, 'Empty sites reserve only their marker');
});
