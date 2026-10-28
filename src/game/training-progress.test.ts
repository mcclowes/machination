import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trainingProgressStore, TRAINING_PROGRESS_KEY } from './training-progress';

test('completion marks are serialized and never touch live operation or credential storage', async () => {
  const values = new Map([['machination.game.v1', 'private-game'], ['machination.online.v1', 'private-seat']]);
  const touched: string[] = [];
  const store = trainingProgressStore({
    getItem: async key => { touched.push(key); return values.get(key) ?? null; },
    setItem: async (key, value) => { touched.push(key); values.set(key, value); },
  });
  assert.deepEqual(await store.load(), []);
  await Promise.all([store.complete('first-launch'), store.complete('shield-combat'), store.complete('first-launch')]);
  assert.deepEqual(await store.load(), ['first-launch', 'shield-combat']);
  assert.ok(touched.every(key => key === TRAINING_PROGRESS_KEY));
  assert.equal(values.get('machination.game.v1'), 'private-game');
  assert.equal(values.get('machination.online.v1'), 'private-seat');
});

test('bad or failed progress writes cannot mark an exercise complete or erase other data', async () => {
  let value: string | null = '{bad';
  let writes = 0;
  const store = trainingProgressStore({ getItem: async () => value, setItem: async (_key, text) => { writes++; value = text; } });
  await assert.rejects(store.complete('first-launch'), /Practice progress/);
  assert.equal(value, '{bad');
  assert.equal(writes, 0);
  value = null;
  const failing = trainingProgressStore({ getItem: async () => value, setItem: async () => { throw new Error('Storage unavailable'); } });
  await assert.rejects(failing.complete('first-launch'), /Storage unavailable/);
  assert.equal(value, null);
  await store.complete('first-launch');
  assert.deepEqual(await store.load(), ['first-launch']);
  for (const raw of ['{}', '{"version":1,"contentVersion":1,"completed":["unknown"]}', '{"version":2,"contentVersion":1,"completed":[]}']) {
    value = raw;
    await assert.rejects(store.load(), /Practice progress/);
    assert.equal(value, raw);
  }
});
