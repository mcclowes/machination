import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame } from './simulation';
import { applyCommand, createArchive, replayTo } from './replay';
import { decodeOperation, encodeOperation, summarizeOperation } from './operation-save';
import { createConfiguredGame } from './world';

test('operation summaries report live hour and standing without advancing the simulation', () => {
  const game = advance(createConfiguredGame({ playerCount: 4, mode: 'mining' }, 0, 1), 3);
  const encoded = encodeOperation({ game, archive: createArchive(game, { rivals: true }) }, 3 * 3_600_000);
  assert.deepEqual(summarizeOperation(encoded, 13 * 3_600_000), { hour: 13, rivals: 3, mode: 'mining', status: 'active' });
  assert.equal(summarizeOperation(encoded, 0).hour, 3, 'a device clock rollback never rewinds the hour');
  assert.equal(summarizeOperation(JSON.stringify({ savedAt: 0, game: { ...game, winner: 'you' } }), 0).status, 'victory');
  assert.throws(() => summarizeOperation('{}', 0), /damaged/);
});

test('local operations preserve command history and advance deterministic rivals only after validating the saved frontier', () => {
  const initial = createGame(0);
  const submitted = applyCommand(createArchive(initial, { rivals: true }), { type: 'dispatch', owner: 'you', from: 'm', to: 'b', drones: 10 }, { rivals: true, knownThrough: 1 });
  const operation = { ...submitted, game: advance(submitted.game, 2) };
  const encoded = encodeOperation(operation, 2 * 3_600_000);
  const loaded = decodeOperation(encoded, 12 * 3_600_000);
  assert.deepEqual(loaded.game, advance(operation.game, 12));
  assert.deepEqual(replayTo(loaded.archive, 1, { rivals: true, knownThrough: 12 }), submitted.game);
  assert.equal(JSON.parse(encoded).replay.baseline.hour, 0);
  assert.equal(JSON.parse(encoded).replay.entries.length, 1);
  const damaged = JSON.parse(encoded); damaged.replay.entries[0].command.drones = 20;
  assert.throws(() => decodeOperation(JSON.stringify(damaged), 12 * 3_600_000), /history/);
});

test('legacy saves establish an honest baseline and device clock rollback never rewinds live time', () => {
  const game = advance(createGame(0), 7);
  const raw = JSON.stringify({ savedAt: 10 * 3_600_000, game });
  const loaded = decodeOperation(raw, 9 * 3_600_000);
  assert.deepEqual(loaded.game, game);
  assert.throws(() => replayTo(loaded.archive, 6, { rivals: true, knownThrough: 7 }), /outside/);
  assert.deepEqual(replayTo(loaded.archive, 7, { rivals: true, knownThrough: 7 }), game);
});
