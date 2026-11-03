import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advance, advanceSteps } from './simulation';
import { createConfiguredGame } from './world';

test('resumable advancement exposes work before finishing and preserves exact game state', () => {
  const initial = createConfiguredGame({ playerCount: 3, mode: 'pulse' }, 0, 0);
  const input = structuredClone(initial);
  const expected = advance(initial, 6, { rivals: true });
  const work = advanceSteps(initial, 6, { rivals: true });
  let result = work.next(), checkpoints = 0;
  while (!result.done) {
    checkpoints++;
    assert.deepEqual(initial, input);
    result = work.next();
  }
  assert.ok(checkpoints > 10);
  assert.deepEqual(result.value, expected);
});

test('canceling restoration leaves the saved game and its bytes intact', async () => {
  const { decodeOperationSteps, encodeOperation } = await import('./operation-save');
  const { createArchive } = await import('./replay');
  const { runSteps } = await import('../solo/execution');
  const initial = createConfiguredGame({ playerCount: 3, mode: 'pulse' }, 0, 0);
  const raw = encodeOperation({ game: initial, archive: createArchive(initial, { rivals: true }) }, 0);
  const abort = new AbortController();
  const restoring = runSteps(decodeOperationSteps(raw, 6 * 3_600_000), abort.signal);
  setTimeout(() => abort.abort(), 0);
  await assert.rejects(restoring, /canceled/);
  assert.equal(encodeOperation({ game: initial, archive: createArchive(initial, { rivals: true }) }, 0), raw);
});

test('cooperative catch-up retains the complete captured ten-player native result', async () => {
  const { createHash } = await import('node:crypto');
  const { createSoloGame } = await import('./depletion');
  const { assignPlayerColor } = await import('./player-colors');
  const { runSteps } = await import('../solo/execution');
  const initial = createSoloGame({ playerCount: 10, mode: 'mining', driftingBases: false, gravity: true,
    portraits: ['admiral', 'pilot', 'engineer', 'ranger', 'diplomat', 'navigator', 'hotshot', 'envoy', 'veteran', 'enforcer'],
  }, 1793660260770, 0);
  initial.rules!.colors = assignPlayerColor(initial.rules!, [], 'you');
  const game = advance(initial, 0.0026247222222222223, { rivals: true });
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  assert.equal(hash(game), 'a5a298ea8ebb8d71a13064af166aafb8effd9ec7516d6f516ae2e6baf9c1935d');
  let opportunities = 0;
  const timer = setInterval(() => { opportunities++; }, 0);
  try {
    const result = await runSteps(advanceSteps(game, 6.002624722222222, { rivals: true }));
    assert.equal(hash(result), '7843c07eb42bfb58d952bd553dfde5d3b6a4f41799edf8ca3c943f4aa27047e6');
    assert.ok(opportunities > 1);
    assert.equal(hash(game), 'a5a298ea8ebb8d71a13064af166aafb8effd9ec7516d6f516ae2e6baf9c1935d');
  } finally { clearInterval(timer); }
});
