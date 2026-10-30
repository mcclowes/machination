import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyKey, requestHistoricalView } from './useHistoricalView';
import type { HistorySnapshot } from '../contracts/protocol';

const seat = { url: 'https://belt.example', token: 'secret', id: 'operation', faction: 'you' as const };
const frame = { id: seat.id, faction: seat.faction, visibility: 'sensors.v1', history: { from: 0, through: 5, at: 1 }, game: { hour: 1, scheduled: [] } } as unknown as HistorySnapshot;
const pause = () => new Promise(resolve => setTimeout(resolve, 170));
const flush = () => new Promise(resolve => setImmediate(resolve));

test('scrubbing debounces and canceled requests cannot publish late frames or errors', async () => {
  let calls = 0;
  const received: unknown[] = [];
  const cancelDebounce = requestHistoricalView(seat, 1, value => received.push(value), async () => { calls++; return frame; });
  cancelDebounce();
  await pause();
  assert.equal(calls, 0);
  let resolve!: (value: HistorySnapshot) => void;
  let signal: AbortSignal | undefined;
  const cancel = requestHistoricalView(seat, 1, value => received.push(value), async (_seat, _hour, abort) => {
    signal = abort;
    return new Promise(done => { resolve = done; });
  });
  await pause();
  cancel();
  assert.equal(signal?.aborted, true);
  resolve(frame);
  await flush();
  assert.equal(received.length, 0);
  let reject!: (error: Error) => void;
  const cancelError = requestHistoricalView(seat, 2, value => received.push(value), async () => new Promise((_done, fail) => { reject = fail; }));
  await pause();
  cancelError(); reject(new Error('Late failure'));
  await flush();
  assert.equal(received.length, 0);
});

test('history rejects another faction and keys frames to server, token, operation, seat, and hour', async () => {
  const key = historyKey(seat, 1);
  for (const changed of [{ ...seat, url: 'https://other.example' }, { ...seat, token: 'new' }, { ...seat, id: 'other' }, { ...seat, faction: 'vesper' as const }]) assert.notEqual(historyKey(changed, 1), key);
  assert.notEqual(historyKey(seat, 2), key);
  const received: { error?: string }[] = [];
  const cancel = requestHistoricalView(seat, 1, result => received.push(result), async () => ({ ...frame, faction: 'vesper' }));
  await pause();
  cancel();
  assert.match(received[0]!.error!, /another seat/);
});

test('a replacement request publishes its frame while a prior request remains in flight', async () => {
  const received: { key: string; frame?: HistorySnapshot }[] = [];
  let resolve!: (value: HistorySnapshot) => void;
  const cancelOld = requestHistoricalView(seat, 1, value => received.push(value), async () => new Promise(done => { resolve = done; }));
  await pause();
  cancelOld();
  const replacement = { ...frame, history: { ...frame.history, at: 2 } };
  const cancelNew = requestHistoricalView(seat, 2, value => received.push(value), async () => replacement);
  await pause();
  resolve(frame);
  await flush();
  cancelNew();
  assert.equal(received.length, 1);
  assert.equal(received[0]!.key, historyKey(seat, 2));
  assert.equal(received[0]!.frame, replacement);
});
