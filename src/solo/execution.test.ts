/** @format */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OperationExecution, runSteps } from './execution';
import { advance, advanceSteps } from '../game/simulation';
import { createConfiguredGame } from '../game/world';

test('replacement cancels old work without publishing it or clearing a newer transition', async () => {
  const states: boolean[] = [],
    published: string[] = [];
  const owner = new OperationExecution((busy) => states.push(busy));
  let finishOld!: (value: string) => void, finishNew!: (value: string) => void;
  let oldSignal!: AbortSignal;
  const old = owner.run(
    (signal) => {
      oldSignal = signal;
      return new Promise<string>((resolve) => {
        finishOld = resolve;
      });
    },
    (value) => published.push(value),
  );
  await assert.rejects(
    owner.run(
      async () => 'overlap',
      (value) => published.push(value),
    ),
    /Wait/,
  );
  owner.cancel();
  assert.equal(oldSignal.aborted, true);
  const next = owner.run(
    () =>
      new Promise<string>((resolve) => {
        finishNew = resolve;
      }),
    (value) => published.push(value),
  );
  finishOld('old');
  assert.equal(await old, false);
  assert.equal(owner.busy, true);
  assert.deepEqual(published, []);
  finishNew('new');
  assert.equal(await next, true);
  assert.deepEqual(published, ['new']);
  assert.deepEqual(states, [true, false, true, false]);
});

test('host timers run during six-hour advancement and only the complete game is published', async () => {
  const initial = createConfiguredGame({ playerCount: 3, mode: 'pulse' }, 0, 0);
  const expected = advance(initial, 6, { rivals: true });
  const owner = new OperationExecution(() => {});
  let beats = 0,
    published = 0;
  const timer = setInterval(() => {
    beats++;
    assert.equal(published, 0);
  }, 0);
  try {
    await owner.run(
      (signal) => runSteps(advanceSteps(initial, 6, { rivals: true }), signal),
      (game) => {
        assert.ok(beats > 1, 'The host must run before the completed state is available.');
        assert.deepEqual(game, expected);
        published++;
      },
    );
  } finally {
    clearInterval(timer);
  }
  assert.equal(published, 1);
});
