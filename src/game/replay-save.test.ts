import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame } from './simulation';
import { applyCommand, createArchive, exportArchive, replayTo } from './replay';
import { decodeReplay } from './replay-save';

test('private replay data round-trips, detaches arrays, and must reconstruct its saved live world', () => {
  const start = createGame(0);
  const applied = applyCommand(createArchive(start), { type: 'dispatch', owner: 'you', from: 'm', to: 'b', drones: 10 }, { rivals: false, knownThrough: 1 });
  const live = advance(applied.game, 8, { rivals: false });
  const data = JSON.parse(JSON.stringify(exportArchive(applied.archive)));
  const restored = decodeReplay(data, live, false);
  assert.deepEqual(replayTo(restored, 8, { rivals: false, knownThrough: 8 }), live);
  data.entries[0].command.drones = 30;
  assert.equal(replayTo(restored, 1, { rivals: false, knownThrough: 8 }).fleets[0]!.drones, 10);
  assert.throws(() => decodeReplay(data, live, false), /history/);
});

test('private replay loading rejects malformed versions, hours, payloads, rival mode, and semantic failures', () => {
  const start = createGame(0);
  const applied = applyCommand(createArchive(start), { type: 'shields', owner: 'you', rock: 'm', disabled: true }, { rivals: false, knownThrough: 1 });
  const clean = exportArchive(applied.archive);
  for (const mutate of [
    (d: any) => { d.version = 2; }, (d: any) => { d.rules = 99; },
    (d: any) => { d.rivals = 'false'; }, (d: any) => { d.baseline = {}; },
    (d: any) => { d.entries[0].hour = -1; }, (d: any) => { d.entries[0].hour = 2; },
    (d: any) => { d.entries[0].command.owner = 'intruder'; },
    (d: any) => { d.entries[0].command.disabled = 'yes'; },
    (d: any) => { d.entries[0].command.rock = 'unknown'; },
    (d: any) => { d.entries[0].command.type = 'unlogged-action'; },
    (d: any) => { d.entries[0].command.extra = 'unknown-field'; },
  ]) { const data = JSON.parse(JSON.stringify(clean)); mutate(data); assert.throws(() => decodeReplay(data, applied.game, false)); }
  assert.throws(() => decodeReplay(clean, applied.game, true));
});
