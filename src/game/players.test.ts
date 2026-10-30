import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHARACTERS, DEFAULT_PORTRAITS } from './characters';
import { ALL_PLAYERS, playerAppearance } from './players';

test('the default player has a chromatic identity distinct from the default rivals', () => {
  for (const portraits of [undefined, DEFAULT_PORTRAITS]) {
    const appearance = playerAppearance('you', portraits);
    const channels = appearance.color.slice(1).match(/../g)!.map((hex) => parseInt(hex, 16));
    const saturation = (Math.max(...channels) - Math.min(...channels)) / Math.max(...channels);
    assert.ok(saturation > 0.5, 'Player territory must have a clear hue instead of neutral gray');
    for (const rival of ALL_PLAYERS.slice(1)) {
      assert.notEqual(appearance.color, playerAppearance(rival, portraits).color);
    }
  }
});

test('chosen portraits retain their colors and insignia', () => {
  const appearance = playerAppearance('you', ['pilot']);
  assert.equal(appearance.color, CHARACTERS.pilot.color);
  assert.equal(appearance.background, CHARACTERS.pilot.background);
  assert.equal(appearance.emblem, CHARACTERS.pilot.emblem);
});
