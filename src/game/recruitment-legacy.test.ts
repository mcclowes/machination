/**
 * ---
 * purpose: Preserve pre-preview revision-13 recruitment saves and command histories against frozen results.
 * ---
 */
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, exportArchive, replayTo, restoreArchive, type GameCommand, type ReplayData } from './replay';
import { decodeReplay } from './replay-save';
import { decodeSave } from './save-format';
import { advance, type Game } from './simulation';

type Scenario = {
  name: string;
  hour: number;
  replay: ReplayData;
  recruitment: Game['recruitment'];
  branches: { command: GameCommand; game: Game; checkpoints?: { hour: number; game: Game }[] }[];
};
// Generated from 8d83a53 with map seed 17, recruitment seeds 4/0, and no rival orders.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/recruitment-r13-8d83a53.json', import.meta.url), 'utf8')) as {
  sourceCommit: string;
  mechanicsVersion: number;
  scenarios: Scenario[];
};
const persisted = <T>(value: T): T => JSON.parse(JSON.stringify(value));

for (const scenario of fixture.scenarios) {
  const options = { rivals: false, knownThrough: scenario.hour };
  test(`revision-13 recruitment fixture restores ${scenario.name}`, () => {
    assert.equal(fixture.sourceCommit, '8d83a53cbec81cafbf0ced338eb071f0d644ac48');
    assert.equal(fixture.mechanicsVersion, 13);
    const baseline = decodeSave(JSON.stringify({ savedAt: 0, game: scenario.replay.baseline })).game;
    assert.equal(baseline.rules!.mechanicsVersion, 13);
    const restored = restoreArchive({ ...scenario.replay, baseline });
    const game = replayTo(restored, scenario.hour, options);
    assert.deepEqual(persisted(game.recruitment), scenario.recruitment);
    assert.deepEqual(exportArchive(decodeReplay(scenario.replay, game, false)), scenario.replay);
  });

  for (const branch of scenario.branches) {
    const action = branch.command.type === 'hire' ? branch.command.kind : branch.command.type;
    test(`revision-13 recruitment preserves ${scenario.name} ${action}`, () => {
      const expected = decodeSave(JSON.stringify({ savedAt: 0, game: branch.game })).game;
      const result = applyCommand(restoreArchive(scenario.replay), branch.command, options);
      assert.equal(expected.rules!.mechanicsVersion, 13);
      assert.deepEqual(persisted(result.game), expected);

      const history: ReplayData = { ...scenario.replay, entries: [...scenario.replay.entries, { hour: scenario.hour, command: branch.command }] };
      const restored = decodeReplay(history, expected, false);
      assert.deepEqual(persisted(replayTo(restored, scenario.hour, options)), expected);
      assert.deepEqual(exportArchive(restored), history);
      assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: result.game })).game, expected);

      for (const checkpoint of branch.checkpoints ?? []) {
        const expectedLater = decodeSave(JSON.stringify({ savedAt: 0, game: checkpoint.game })).game;
        assert.deepEqual(persisted(advance(result.game, checkpoint.hour, { rivals: false })), expectedLater);
        const resumed = decodeReplay(history, expectedLater, false);
        assert.deepEqual(persisted(replayTo(resumed, checkpoint.hour, { rivals: false, knownThrough: checkpoint.hour })), expectedLater);
        assert.deepEqual(exportArchive(resumed), history);
      }
    });
  }
}
