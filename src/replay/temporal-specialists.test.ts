import { test } from 'node:test';
import assert from 'node:assert/strict';
import { temporalWorld } from '../game/temporal-test-world';
import { advance } from '../game/simulation';
import { applyCommand, createArchive, exportArchive, replayTo } from '../game/replay';
import { decodeReplay } from '../game/replay-save';
import { generateSharedReplay } from './generate';
import { decodeSharedReplay, encodeSharedReplay } from './codec';

test('private and shared replays disclose Hindsight only at discovery, without retaining its hidden pending ledger', () => {
  const baseline = temporalWorld();
  baseline.rocks[0]!.specialists!.push({ id: 'replay-hindsight', kind: 'hindsight', owner: 'you' });
  Object.assign(baseline.rocks[10]!, { x: 50, y: 0 });
  const submitted = applyCommand(createArchive(baseline), { type: 'dispatch', owner: 'vesper', from: baseline.rocks[10]!.id, to: baseline.rocks[11]!.id, drones: 1 }, { rivals: false, knownThrough: 24 });
  const game = advance(submitted.game, 26, { rivals: false });
  const archive = decodeReplay(exportArchive(submitted.archive), game, false);
  assert.equal(replayTo(archive, 25, { rivals: false, knownThrough: 26 }).events.some(e => e.discoveredAt), false);
  assert.equal(replayTo(archive, 26, { rivals: false, knownThrough: 26 }).events.find(e => e.discoveredAt)?.hour, 24);
  const replay = decodeSharedReplay(encodeSharedReplay(generateSharedReplay({ game, archive }, 'you', 24, 26)));
  assert.ok(replay.groups.some(g => g.hour === 26 && g.states.some(s => s.discoveries?.some(d => d.hour === 24 && d.discoveredAt === 26))));
  assert.equal(replay.groups.filter(g => g.hour < 26).some(g => g.states.some(s => s.discoveries?.length)), false);
  assert.doesNotMatch(JSON.stringify(replay), /temporalIntel|pending|replay-hindsight/);
});

test('temporal activation and site debt reconstruct from the private archive and appear in shared history', () => {
  const baseline = temporalWorld();
  Object.assign(baseline.rocks[1]!, { kind: 'factory', productionAt: 32, productionInterval: 8 });
  baseline.rocks[1]!.specialists!.push({ id: 'replay-overclock', kind: 'overclock', owner: 'you' });
  const submitted = applyCommand(createArchive(baseline), { type: 'activate', owner: 'you', id: 'replay-overclock' }, { rivals: false, knownThrough: 24 });
  const game = advance(submitted.game, 29, { rivals: false });
  const archive = decodeReplay(exportArchive(submitted.archive), game, false);
  const replay = decodeSharedReplay(encodeSharedReplay(generateSharedReplay({ game, archive }, 'you', 24, 29)));
  assert.ok(replay.groups.some(g => g.states.some(s => s.rocks.some(r => r.overclock?.repaying))));
  assert.equal(replayTo(archive, 29, { rivals: false, knownThrough: 29 }).rocks[1]!.drones, 46);
});

test('shared Foresight history retains warnings before a death and never references a removed specialist afterward', () => {
  const baseline = temporalWorld();
  baseline.rocks[0]!.specialists!.push({ id: 'replay-foresight', kind: 'foresight', owner: 'you' });
  baseline.rocks[1]!.x = 16;
  baseline.rocks[1]!.specialists!.push({ id: 'replay-victim', kind: 'foreman', owner: 'you' });
  Object.assign(baseline.rocks[10]!, { x: 50, y: 0 });
  baseline.rocks[10]!.specialists!.push({ id: 'replay-assassin', kind: 'assassin', owner: 'vesper' });
  const submitted = applyCommand(createArchive(baseline), { type: 'schedule', owner: 'vesper', plan: {
    id: 'replay-lethal-transfer-0001', from: baseline.rocks[10]!.id, to: baseline.rocks[1]!.id, drones: 1, specialists: ['replay-assassin'], executeAt: 25,
  } }, { rivals: false, knownThrough: 24 });
  const game = advance(submitted.game, 30, { rivals: false });
  const replay = decodeSharedReplay(encodeSharedReplay(generateSharedReplay({ game, archive: submitted.archive }, 'you', 24, 30)));
  assert.ok(replay.groups.some(g => g.hour < 29 && g.states.some(s => s.foresight?.length)));
  for (const group of replay.groups) for (const scene of group.states) {
    const present = new Set([...scene.rocks, ...scene.fleets].flatMap(a => a.specialists ?? []).map(u => u.id));
    assert.ok((scene.foresight ?? []).every(w => present.has(w.specialistId)));
  }
});
