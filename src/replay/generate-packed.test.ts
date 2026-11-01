import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfiguredGame } from '../game/world';
import { advance } from '../game/simulation';
import { createArchive, applyCommand, exportArchive, restoreArchive, executeCommand, type ReplayEntry } from '../game/replay';
import { observe } from '../game/visibility';
import { generateSharedReplay, SharedReplayCapacityError } from './generate';
import { generatePackedReplay } from './generate-packed';
import { encodePackedReplay, decodePackedReplay, seekPackedReplay } from './packed';
import { seekReplay } from './playback';
import { inspectReplayData } from './codec';

test('incremental generation matches legacy causal states, span anchors, and interior evaluations', () => {
  for (const driftingBases of [false, true]) {
    const baseline = createConfiguredGame({ playerCount: 3, mode: 'mining', driftingBases }, 0, 73);
    const operation = { game: advance(baseline, 16, { rivals: false }), archive: createArchive(baseline) };
    const legacy = generateSharedReplay(operation, 'you', 0, 16);
    const packed = decodePackedReplay(encodePackedReplay(generatePackedReplay(operation, 'you', 0, 16)));
    assert.deepEqual(packed.groups.map(g => [g.hour, g.states.length]), legacy.groups.map(g => [g.hour, g.states.length]));
    assert.equal(packed.spans.length, legacy.spans.length);
    for (let i = 0; i < legacy.spans.length; i++) {
      const span = packed.spans[i]!;
      assert.equal(span.from, legacy.spans[i]!.from); assert.equal(span.through, legacy.spans[i]!.through);
      assert.deepEqual({ ...span.scene, rules: packed.rules, rocks: span.scene.rocks.map(id => packed.siteDictionary[id]!) }, legacy.spans[i]!.scene);
    }
    for (const group of legacy.groups) for (let ordinal = 0; ordinal < group.states.length; ordinal++)
      assert.deepEqual(seekPackedReplay(packed, group.hour, ordinal), seekReplay(legacy, group.hour, ordinal));
    for (const span of legacy.spans) for (const fraction of [0.1, 0.5, 0.9]) {
      const hour = span.from + (span.through - span.from) * fraction;
      assert.deepEqual(seekPackedReplay(packed, hour), seekReplay(legacy, hour));
    }
  }
});

test('a naturally completed ten-seat pulse operation exports the entire formerly failing final eight hours', () => {
  const baseline = createConfiguredGame({ playerCount: 10, mode: 'pulse' }, 0, 2026);
  let operation = { game: baseline, archive: createArchive(baseline) };
  for (const owner of baseline.rules!.players) {
    assert.ok(observe(advance(operation.game, 384, { rivals: false }), owner).cargo[owner]! >= 100);
    operation = applyCommand(operation.archive, { type: 'pulse', owner, command: { id: `packing-charge-${owner}-2026`, action: 'START_CHARGE' } }, { rivals: false, knownThrough: 384 });
  }
  for (const owner of baseline.rules!.players)
    operation = applyCommand(operation.archive, { type: 'pulse', owner, command: { id: `packing-fire-${owner}-2026`, action: 'FIRE_PULSE' } }, { rivals: false, knownThrough: 392 });
  operation = { ...operation, game: advance(operation.game, 416, { rivals: false }) };
  assert.equal(operation.game.winner, 'prism'); assert.equal(operation.game.eliminated.length, 9);
  const before = structuredClone(operation.game), archive = exportArchive(operation.archive);
  const through = operation.game.hour, from = through - 8;
  assert.throws(() => generateSharedReplay(operation, 'you', from, through), SharedReplayCapacityError);
  const replay = decodePackedReplay(encodePackedReplay(generatePackedReplay(operation, 'you', from, through)));
  assert.equal(replay.from, from); assert.equal(replay.through, through);
  assert.equal(replay.groups.length, 165);
  assert.equal(replay.groups.reduce((n, group) => n + group.states.length, 0), 216);
  assert.equal(replay.spans.length, 164);
  assert.ok(inspectReplayData(replay) <= 250000);
  const final = seekPackedReplay(replay, through);
  assert.equal(final.winner, 'prism'); assert.equal(final.eliminated.length, 9);
  assert.deepEqual(operation.game, before); assert.deepEqual(exportArchive(operation.archive), archive);
});

test('private/no-change boundaries do not add dictionary entries, identities, or public timing', () => {
  const baseline = createConfiguredGame({ playerCount: 3, mode: 'mining' }, 0, 73);
  const clean = { game: advance(baseline, 2, { rivals: false }), archive: createArchive(baseline) };
  const privateBaseline = structuredClone(baseline);
  privateBaseline.events.push({ hour: 0, audience: ['vesper'], message: 'PRIVATE_PACKING_SENTINEL' });
  const sites = baseline.rocks.filter(r => r.owner === 'vesper');
  const changed = applyCommand(createArchive(privateBaseline), { type: 'schedule', owner: 'vesper', plan: {
    id: 'private-packing-plan', from: sites[0]!.id, to: sites[1]!.id, drones: 5, executeAt: 20,
  } }, { rivals: false, knownThrough: 0.371 });
  const dirty = { ...changed, game: advance(changed.game, 2, { rivals: false }) };
  assert.equal(encodePackedReplay(generatePackedReplay(clean, 'you', 0, 2)), encodePackedReplay(generatePackedReplay(dirty, 'you', 0, 2)));
});

test('packed capacity refusal preserves the authoritative game and archive', () => {
  const baseline = createConfiguredGame({ playerCount: 10, mode: 'pulse' }, 0, 2026);
  const site = baseline.rocks.find(r => r.owner === 'you')!;
  const entries: ReplayEntry[] = Array.from({ length: 2000 }, (_, i) => ({ hour: 0, command: { type: 'shields', owner: 'you', rock: site.id, disabled: i % 2 === 0 } }));
  const operation = { game: entries.reduce((game, entry) => executeCommand(game, entry.command), baseline),
    archive: restoreArchive({ version: 1, rules: 1, baseline, entries, rivals: false }) };
  const before = structuredClone(operation.game), archive = exportArchive(operation.archive);
  assert.throws(() => generatePackedReplay(operation, 'you', 0, 0), SharedReplayCapacityError);
  assert.deepEqual(operation.game, before); assert.deepEqual(exportArchive(operation.archive), archive);
});
