import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignPlayerColor, PLAYER_COLORS, validPlayerColors } from './player-colors';
import { playerAppearance } from './players';
import { DEFAULT_PORTRAITS } from './characters';
import { createConfiguredGame } from './world';
import { DEFAULT_GAME_OPTIONS } from './rules';
import { encodeOperation, decodeOperation } from './operation-save';
import { createArchive } from './replay';
import { observe, forecastObservation } from './visibility';
import { presentObservation } from '../replay/presentation';

test('a preferred color changes livery without changing the portrait or emblem', () => {
  const rules = { players: ['you', 'vesper', 'null'] as const, portraits: DEFAULT_PORTRAITS.slice(0, 3) };
  const colors = assignPlayerColor(rules, [], 'you', 'gold');
  assert.equal(colors[0], 'gold');
  assert.equal(new Set(colors).size, 3);
  const appearance = playerAppearance('you', rules.portraits, colors);
  assert.equal(appearance.color, PLAYER_COLORS.gold.color);
  assert.deepEqual(appearance.portrait, playerAppearance('you').portrait);
  assert.equal(appearance.emblem, playerAppearance('you').emblem);
});

test('joined seats keep their colors while free seats yield to preferences', () => {
  const rules = { players: ['you', 'vesper', 'null'] as const };
  const colors = assignPlayerColor(rules, [], 'you', 'gold');
  const guest = assignPlayerColor({ ...rules, colors }, ['you'], 'vesper', 'gold');
  assert.equal(guest[0], 'gold');
  assert.notEqual(guest[1], 'gold');
  assert.equal(new Set(guest).size, 3);
  const third = assignPlayerColor({ ...rules, colors: guest }, ['you', 'vesper'], 'null', 'rust');
  assert.deepEqual(third.slice(0, 2), guest.slice(0, 2));
});

test('all ten seats can have distinct colors and assignments are validated', () => {
  const rules = { players: ['you', 'vesper', 'null', 'aether', 'umbra', 'orbit', 'prism', 'echo', 'nadir', 'zenith'] as const };
  const colors = assignPlayerColor(rules, [], 'you');
  assert.equal(colors[0], 'teal');
  assert.equal(new Set(colors).size, 10);
  assert.equal(validPlayerColors(colors, 10), true);
  for (const invalid of [['gold', 'gold'], ['gold', 'invalid'], {}, ['gold']]) {
    assert.equal(validPlayerColors(invalid, 2), false);
  }
});

test('assignments survive solo saves and observed forecasts', () => {
  const game = createConfiguredGame(DEFAULT_GAME_OPTIONS, 1000, 32);
  game.rules!.colors = assignPlayerColor(game.rules!, [], 'you', 'violet');
  const raw = encodeOperation({ game, archive: createArchive(game, { rivals: true }) }, 1000);
  const restored = decodeOperation(raw, 1000);
  assert.deepEqual(restored.game.rules!.colors, game.rules!.colors);
  const view = observe(restored.game, 'you');
  assert.deepEqual(presentObservation(view).rules!.colors, game.rules!.colors);
  assert.deepEqual(view.rules!.colors, game.rules!.colors);
  assert.deepEqual(forecastObservation(view, 'you', 1).rules!.colors, game.rules!.colors);
});
