import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfiguredGame } from './world';
import { decodeSave } from './save-format';
import { observe, forecastObservation } from './visibility';
import { applyCommand, createArchive, exportArchive } from './replay';
import { decodeReplay } from './replay-save';
import { advance } from './simulation';

test('configured worlds persist their selected rules, independent participants, generated map, and replay', () => {
  for (const playerCount of [2, 3, 10]) for (const mode of ['mining', 'domination'] as const) {
    const game = createConfiguredGame({ playerCount, mode }, 1000, 32 + playerCount);
    assert.equal(game.rules!.players.length, playerCount);
    assert.equal(game.rocks.length, playerCount * 10);
    assert.equal(Object.keys(game.cargo).length, playerCount);
    assert.equal(Object.keys(game.recruitment!).length, playerCount);
    assert.equal(game.rules!.victoryTarget, mode === 'mining' ? 300 : 5 * playerCount);
    assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game })).game, game);
    const view = observe(game, 'you');
    assert.equal(JSON.stringify(view).includes('"seed"'), false);
    assert.equal(view.rules!.map.width, game.rules!.map.width);
    assert.deepEqual(forecastObservation(view, 'you', 8).rules, view.rules);
    const submitted = applyCommand(createArchive(game), { type: 'shields', owner: game.rules!.players.at(-1)!, rock: game.rocks.find(r => r.owner === game.rules!.players.at(-1))!.id, disabled: true }, { rivals: false, knownThrough: 1 });
    const end = advance(submitted.game, 8, { rivals: false });
    assert.doesNotThrow(() => decodeReplay(JSON.parse(JSON.stringify(exportArchive(submitted.archive))), end, false));
  }
});
