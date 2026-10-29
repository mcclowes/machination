import assert from 'node:assert/strict';
import { test } from 'node:test';
import { afterWork, workBetween, workClock, workHour, travelProgress, openingRate } from './opening-clock';

const current = { rules: { mechanicsVersion: 9 } };
test('opening work crosses hour twelve without changing actual game time', () => {
  assert.equal(afterWork(current, 11, 2), 12.5);
  assert.equal(workBetween(current, 11, 12), 1.5);
  assert.equal(travelProgress(current, 11, 12.5, 12), .75);
  assert.equal(workHour(current, 22), 16);
  assert.equal(workClock(current, 12), 18);
});

test('normal eight-hour factory work uses two-thirds time during the opening', () => {
  assert.equal(afterWork(current, 0, 8), 16 / 3);
  assert.equal(afterWork(current, 16 / 3, 8), 32 / 3);
  assert.equal(afterWork(current, 32 / 3, 8), 18);
  assert.equal(openingRate(current, 12 - 1e-9), 1.5);
  assert.equal(openingRate(current, 12), 1);
  assert.equal(afterWork(current, 12, 8), 20);
});

test('prior mechanics keep their recorded arithmetic', () => {
  for (const mechanicsVersion of [undefined, 2, 3, 4, 5, 6, 7, 8]) {
    const old = { rules: { mechanicsVersion } };
    for (const hour of [0, .13, 11.9, 12, 12.1, 1e6]) {
      assert.equal(workClock(old, hour), hour);
      assert.equal(workHour(old, hour), hour);
      assert.equal(afterWork(old, hour, .37), hour + .37);
      assert.equal(workBetween(old, .37, hour), hour - .37);
    }
  }
});

test('clock conversion and elapsed work agree across the boundary', () => {
  for (const from of [0, .37, 11, 12, 13, 1e6]) for (const work of [0, .1, 1.5, 2, 40]) {
    const through = afterWork(current, from, work);
    assert.ok(Math.abs(workBetween(current, from, through) - work) < 1e-9);
    assert.ok(Math.abs(workHour(current, workClock(current, through)) - through) < 1e-9);
  }
});
