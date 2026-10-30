import test from 'node:test';
import assert from 'node:assert/strict';
import { advance } from './simulation';
import { createConfiguredGame } from './world';
import { decodeSave } from './save-format';

for (let count = 2; count <= 10; count++) for (const mode of ['pulse', 'mining', 'domination'] as const) {
  test(`${count}-player ${mode} rivals preserve state and timing invariants on a generated drifting chart`, () => {
    const initial = createConfiguredGame({ playerCount: count, mode, driftingBases: true }, 0, count * 101);
    const original = structuredClone(initial);
    const game = advance(initial, 3);
    const split = advance(advance(initial, 1.37), 3);
    assert.deepEqual(split, game);
    assert.deepEqual(initial, original);
    assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game })).game, game);
    for (const asset of [...game.rocks, ...game.fleets]) assert.ok(Number.isFinite(asset.drones) && asset.drones >= 0);
    for (const cargo of Object.values(game.cargo)) assert.ok(Number.isFinite(cargo) && cargo! >= 0);
    for (const fleet of game.fleets) {
      assert.ok(Number.isSafeInteger(fleet.drones));
      assert.ok(fleet.arrives > fleet.departed);
      assert.ok(game.rules!.players.includes(fleet.owner));
    }
  });
}
