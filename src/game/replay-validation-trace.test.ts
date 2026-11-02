import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, createArchive, exportArchive, traceReplayTo } from './replay';
import { decodeReplay, traceValidatedReplay } from './replay-save';
import { advance } from './simulation';
import type { SimulationTrace } from './simulation-trace';
import { temporalWorld } from './temporal-test-world';

function operation() {
  const game = temporalWorld();
  const submitted = applyCommand(createArchive(game), { type: 'dispatch', owner: 'you',
    from: game.rocks[0]!.id, to: game.rocks[1]!.id, drones: 10 }, { rivals: false, knownThrough: 24 });
  return { data: exportArchive(submitted.archive), live: advance(submitted.game, 26, { rivals: false }) };
}

test('one validating replay retains every original bounded trace record and the exact frontier', () => {
  const { data, live } = operation(), before = structuredClone({ data, live });
  const expected: SimulationTrace[] = [], actual: SimulationTrace[] = [];
  const archive = decodeReplay(data, live, false), window = { from: 24.5, through: 26 };
  traceReplayTo(archive, live.hour, { rivals: false, knownThrough: live.hour, traceWindow: window }, record => expected.push(record));
  const validated = traceValidatedReplay(data, live, false, window, record => actual.push(record));
  assert.deepEqual(actual, expected);
  assert.deepEqual(exportArchive(validated), exportArchive(archive));
  assert.deepEqual({ data, live }, before);
});

test('a validating trace still refuses a mismatched saved frontier', () => {
  const { data, live } = operation();
  live.cargo.you! += 1;
  assert.throws(() => traceValidatedReplay(data, live, false, { from: 24, through: 26 }, () => {}), /damaged or does not match/);
});

test('provisional trace callback errors retain their original identity', () => {
  const { data, live } = operation(), failure = new Error('recorder capacity sentinel');
  assert.throws(() => traceValidatedReplay(data, live, false, { from: 24, through: 26 }, () => { throw failure; }), error => error === failure);
  assert.throws(() => traceValidatedReplay(data, live, false, { from: 24, through: 26 }, () => { throw undefined; }), error => error === undefined);
});

test('a provisional recorder cannot mutate the reconstructed frontier or private archive', () => {
  const { data, live } = operation(), before = structuredClone(data);
  const archive = traceValidatedReplay(data, live, false, { from: 24, through: 26 }, record => {
    const game = record.type === 'point' ? record.game : record.to;
    game.rocks.length = 0; game.cargo.you = -1;
  });
  assert.deepEqual(exportArchive(archive), before);
  assert.deepEqual(data, before);
});
