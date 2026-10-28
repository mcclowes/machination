import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from './simulation';
import { createArchive } from './replay';
import { localLifecycle } from './local-lifecycle';

test('practice never touches solo persistence or advances with the wall clock', async () => {
  const fail = () => { throw new Error('Practice accessed the solo lifecycle.'); };
  const policy = localLifecycle({ load: fail, save: fail, create: fail, initial: fail }, 'first-launch');
  const first = policy.initial();
  assert.equal(policy.rivals, false);
  assert.equal(policy.automaticClock, false);
  await policy.save(first);
  assert.deepEqual(await policy.load(), first);
  assert.equal(policy.advance(first, first.game.hour + 20, 'clock'), first);
  const attempted = policy.submit(first, { type: 'dispatch', owner: 'you', from: 'works', to: 'relay', drones: 1 });
  assert.equal(first.game.fleets.length, 0);
  assert.equal(attempted.game.fleets.length, 1);
  assert.deepEqual(await policy.load(), first, 'Retry recreates the detached original baseline');
  const later = policy.advance(attempted, attempted.game.hour + 1, 'manual');
  assert.ok(later.game.hour > attempted.game.hour);
});

test('solo still restores and saves its operation and uses ordinary elapsed time', async () => {
  const game = createGame(0);
  const operation = { game, archive: createArchive(game, { rivals: true }) };
  let loads = 0; let saved: unknown;
  const policy = localLifecycle({ load: async () => { loads++; return operation; }, save: async value => { saved = value; }, create: () => assert.fail('Existing solo save was replaced'), initial: () => operation });
  assert.equal(policy.initial(), operation);
  assert.equal(await policy.load(), operation);
  assert.equal(loads, 1);
  assert.equal(policy.rivals, true);
  assert.equal(policy.automaticClock, true);
  await policy.save(operation);
  assert.equal(saved, operation);
  assert.equal(policy.advance(operation, 0.5, 'clock').game.hour, 0.5);
});

test('practice stops at the first assessed outcome even when a large step crosses a later core loss', () => {
  const fail = () => { throw new Error('Practice touched solo storage'); };
  const policy = localLifecycle({ load: fail, save: fail, create: fail, initial: fail }, 'first-launch');
  let operation = policy.initial();
  operation = policy.submit(operation, { type: 'dispatch', owner: 'you', from: 'works', to: 'relay', drones: 6 });
  operation = policy.submit(operation, { type: 'dispatch', owner: 'you', from: 'home', to: 'rival-home', drones: 0, specialists: ['core-you'] });
  const single = policy.advance(operation, 6, 'manual');
  assert.equal(policy.assess(single)?.status, 'passed');
  assert.equal(single.game.hour, 7 / 6);
  let split = operation;
  for (let hour = 0.25; hour <= 6; hour += 0.25) split = policy.advance(split, hour, 'manual');
  assert.deepEqual(split.game, single.game);
  assert.equal(policy.advance(single, 10, 'manual'), single);
  assert.throws(() => policy.submit(single, { type: 'resign', owner: 'you' }), /exercise has ended/);
});
