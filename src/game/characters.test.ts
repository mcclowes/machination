import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHARACTER_IDS, type CharacterId } from './characters';
import { validateOptions } from './rules';
import { createConfiguredGame } from './world';
import { decodeSave } from './save-format';
import { observe, forecastObservation } from './visibility';
import { createArchive, exportArchive } from './replay';
import { decodeReplay } from './replay-save';

test('every supplied portrait can be assigned and survives saves, sensor views, forecasts, and replay', () => {
  for (const portrait of CHARACTER_IDS) {
    const portraits: CharacterId[] = [portrait, portrait === 'ace' ? 'admiral' : 'ace'];
    const game = createConfiguredGame({ playerCount: 2, mode: 'mining', portraits }, 0, 1);
    assert.deepEqual(game.rules!.portraits, portraits);
    const saved = decodeSave(JSON.stringify({ savedAt: 0, game })).game;
    assert.deepEqual(saved.rules!.portraits, portraits);
    const view = observe(game, 'you');
    assert.deepEqual(view.rules!.portraits, portraits);
    assert.deepEqual(forecastObservation(view, 'you', 1).rules!.portraits, portraits);
    assert.doesNotThrow(() => decodeReplay(JSON.parse(JSON.stringify(exportArchive(createArchive(game)))), game, false));
    view.rules!.portraits![0] = 'ace';
    portraits[0] = 'ace';
    assert.equal(game.rules!.portraits![0], portrait, 'Caller arrays and observations cannot change the saved assignment');
  }
});

test('portrait setup rejects unknown, duplicate, incomplete, and malformed assignments', () => {
  for (const portraits of [['admiral'], ['admiral', 'admiral'], ['admiral', 'intruder'], { you: 'admiral' }, null]) {
    assert.throws(() => validateOptions({ playerCount: 2, mode: 'mining', portraits }));
  }
  assert.deepEqual(validateOptions({ playerCount: 2, mode: 'mining' }), { playerCount: 2, mode: 'mining' });
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 1);
  assert.doesNotThrow(() => decodeSave(JSON.stringify({ savedAt: 0, game })));
  for (const portraits of [['admiral'], ['admiral', 'intruder'], ['admiral', 'admiral']]) {
    assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game: { ...game, rules: { ...game.rules, portraits } } })));
  }
});
