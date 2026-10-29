import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfiguredGame } from './world';
import { advance } from './simulation';
import { decodeSave } from './save-format';
import { createArchive, replayTo } from './replay';
import { driftingBasesEnabled } from './rules';
import { generateSharedReplay } from '../replay/generate';
import { decodeSharedReplay, encodeSharedReplay } from '../replay/codec';
import { maximumShield } from './economy';

for (const [revision, drift] of [[5, false], [6, true], [7, false], [7, true], [8, false], [8, true], [9, false], [9, true]] as const) {
  test(`revision ${revision} ${drift ? 'drifting' : 'stationary'} games retain rules through saves and both replay formats`, () => {
    const start = createConfiguredGame({ playerCount: 2, mode: 'mining', driftingBases: drift }, 0, 73);
    start.rules!.mechanicsVersion = revision;
    if (revision < 9) for (const rock of start.rocks) { rock.productionAt = 8; rock.shieldAt = 48 / maximumShield(rock); }
    if (revision < 7) delete start.rules!.driftingBases;
    assert.equal(driftingBasesEnabled(start), drift);
    const archive = createArchive(start);
    const game = advance(start, 5, { rivals: false });
    assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game })).game, game);
    assert.deepEqual(replayTo(archive, 5, { knownThrough: 5, rivals: false }), game);
    const replay = decodeSharedReplay(encodeSharedReplay(generateSharedReplay({ game, archive }, 'you', 0, 5)));
    for (const scene of [...replay.groups.flatMap(g => g.states), ...replay.spans.map(s => s.scene)]) {
      assert.equal(scene.rules!.mechanicsVersion, revision);
      assert.equal(driftingBasesEnabled(scene), drift);
      assert.equal(Object.hasOwn(scene.rules!, 'driftingBases'), revision >= 7);
    }
  });
}

test('new saves require an explicit boolean variant and old saves reject the new field', () => {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining', driftingBases: true }, 0, 73);
  for (const variant of [undefined, null, 0, 'true']) {
    const corrupt = structuredClone(game);
    Object.assign(corrupt.rules!, { driftingBases: variant });
    assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game: corrupt })));
  }
  game.rules!.driftingBases = false;
  assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game })), 'stationary rules cannot carry drifting sites');
  game.rules!.mechanicsVersion = 6; game.rules!.driftingBases = true;
  assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game })), 'old rules cannot silently acquire new variant metadata');
});

test('shared replays reject missing, contradictory, or unversioned variant metadata', () => {
  const start = createConfiguredGame({ playerCount: 2, mode: 'mining', driftingBases: true }, 0, 73);
  const replay = generateSharedReplay({ game: start, archive: createArchive(start) }, 'you', 0, 0);
  for (const variant of [undefined, false, 'true']) {
    const corrupt = structuredClone(replay);
    Object.assign(corrupt.groups[0]!.states[0]!.rules!, { driftingBases: variant });
    assert.throws(() => decodeSharedReplay(JSON.stringify(corrupt)));
  }
  const corrupt = structuredClone(replay);
  corrupt.groups[0]!.states[0]!.rules!.mechanicsVersion = 6;
  assert.throws(() => decodeSharedReplay(JSON.stringify(corrupt)));
});
