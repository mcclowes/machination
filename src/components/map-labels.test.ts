import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutSiteNames } from './map-labels';

test('crowded names give the selected site priority and never cover another marker', () => {
  const sites = [{ key: 'neighbor', x: 110, y: 100, priority: 0 }, { key: 'other', x: 115, y: 100, priority: 0 }, { key: 'selected', x: 100, y: 100, priority: 10 }];
  const labels = layoutSiteNames(sites, { width: 300, height: 300 });
  assert.ok(labels.has('selected'));
  assert.ok(labels.size < sites.length, 'Overlapping names are suppressed');
  assert.deepEqual([...labels], [...layoutSiteNames([...sites].reverse(), { width: 300, height: 300 })]);
  const obstructed = layoutSiteNames([{ key: 'a', x: 100, y: 100, priority: 1 }, { key: 'b', x: 100, y: 140, priority: 0 }], { width: 300, height: 300 });
  assert.equal(obstructed.get('a'), 'above', 'Move the name above a site when another marker is below it');
});

test('separated sites keep names, while edge labels stay inside the phone viewport', () => {
  const labels = layoutSiteNames([{ key: 'a', x: 70, y: 70, priority: 0 }, { key: 'b', x: 220, y: 190, priority: 0 }, { key: 'edge', x: 3, y: 20, priority: 0 }], { width: 300, height: 300 });
  assert.equal(labels.get('a'), 'below');
  assert.equal(labels.get('b'), 'below');
  assert.equal(labels.has('edge'), false);
});
