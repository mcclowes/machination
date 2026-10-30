import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ART_ASPECT, CITY_LIGHTS, ENGINES, coverFrame, heroHeight } from './title-art';

test('title artwork covers tall viewports by cropping the sides evenly', () => {
  const frame = coverFrame(390, 330);
  assert.equal(frame.height, 330);
  assert.equal(frame.width, 330 * ART_ASPECT);
  assert.equal(frame.top, 0);
  assert.equal(frame.left, (390 - frame.width) / 2);
});

test('title artwork covers wide viewports by cropping more from the bottom than the top', () => {
  const frame = coverFrame(960, 520);
  assert.equal(frame.width, 960);
  assert.equal(frame.height, 640);
  assert.ok(frame.top < 0);
  assert.ok(-frame.top < 640 - 520 + frame.top, 'keeps the logo near the top in view');
});

test('hero height scales with width up to a cap', () => {
  assert.equal(heroHeight(390), 332);
  assert.equal(heroHeight(1400), 520);
});

test('effect anchors sit inside the artwork', () => {
  for (const { x, y } of [...ENGINES, ...CITY_LIGHTS]) assert.ok(x > 0 && x < 100 && y > 0 && y < 100);
});
