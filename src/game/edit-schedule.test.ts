import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfiguredGame } from './world';
import { advance, dispatch, installModule } from './simulation';
import { scheduleTransfer, editScheduledLaunch, cancelTransfer, validateLaunchEdit } from './orders';
import { scheduleAction } from './future-actions';
import { observe, forecastObservation } from './visibility';
import { applyCommand, createArchive, exportArchive, replayTo } from './replay';
import { decodeReplay } from './replay-save';
import { decodeSave } from './save-format';
import { createLegacyGame } from './legacy';

test('editing a queued launch keeps its identity, timing, queue position, resources, and dependent gift', () => {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 123);
  const [from, to] = game.rocks.filter(r => r.owner === 'you' && r.drones > 0);
  let queued = scheduleTransfer(game, { id: 'editable-launch-0001', owner: 'you', from: from!.id, to: to!.id, drones: 5, executeAt: 1 });
  queued = scheduleAction(queued, { id: 'dependent-gift-0001', owner: 'you', executeAt: 1.05, action: { type: 'hauler', change: { action: 'gift', fleet: game.nextId } } });
  const original = structuredClone(queued);
  const edited = editScheduledLaunch(queued, 'you', { planId: 'editable-launch-0001', drones: 7 });
  assert.deepEqual(queued, original);
  assert.deepEqual(edited.scheduled, [{ ...original.scheduled![0]!, drones: 7 }, original.scheduled![1]!]);
  assert.deepEqual(edited.rocks, queued.rocks);
  assert.deepEqual(edited.fleets, queued.fleets);
  assert.equal(edited.nextId, queued.nextId);
  assert.equal(observe(edited, 'vesper').scheduled.length, 0);
  const projected = forecastObservation(observe(edited, 'you', id => id + 1000), 'you', 1.05);
  const executed = advance(edited, 1.05, { rivals: false });
  assert.equal(executed.fleets[0]!.id, game.nextId);
  assert.equal(executed.fleets[0]!.drones, 7);
  assert.ok(executed.fleets[0]!.giftAt! > executed.hour);
  assert.equal(projected.fleets[0]!.id, game.nextId + 1000);
  assert.equal(projected.fleets[0]!.drones, 7);
});

test('gift and interception edits retain mission details and their reserved fleet identities', () => {
  for (const type of ['gift', 'intercept'] as const) {
    let game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 123);
    const from = game.rocks.find(r => r.owner === 'you' && r.drones > 0)!;
    const enemy = game.rocks.find(r => r.owner === 'vesper' && r.drones > 0)!;
    enemy.x = (from.x + 10) % game.rules!.map.width; enemy.y = from.y;
    from.specialists!.push({ id: 'editable-pirate', owner: 'you', kind: 'pirate' });
    game = advance(dispatch(game, enemy.id, from.id, 10, 'vesper'), 0.2, { rivals: false });
    const reserved = game.nextId;
    const action = type === 'gift' ? { type, from: from.id, to: enemy.id, drones: 2, recipient: 'vesper' as const }
      : { type, from: from.id, target: game.fleets[0]!.id, drones: 2, specialists: ['editable-pirate'] };
    const queued = scheduleAction(game, { id: 'editable-mission-01', owner: 'you', executeAt: 0.3, action });
    const edited = editScheduledLaunch(queued, 'you', { planId: 'editable-mission-01', drones: 8 });
    assert.deepEqual(edited.scheduled, [{ ...queued.scheduled![0]!, action: { ...action, drones: 8 } }]);
    const result = advance(edited, 0.3, { rivals: false });
    const fleet = result.fleets.find(f => f.id === reserved)!;
    assert.equal(fleet.drones, 8);
    assert.equal(fleet.preparing, true);
    assert.equal(result.nextId, queued.nextId);
    if (type === 'gift') assert.ok(fleet.giftAt !== undefined);
    else assert.equal(fleet.intercept!.target, game.fleets[0]!.id);
  }
});

test('edits can select a planned hire, retain its canceled dependency, and clear it explicitly', () => {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 123);
  const from = game.rocks.find(r => r.coreOf === 'you')!;
  const to = game.rocks.find(r => r.owner === 'you' && r.id !== from.id)!;
  const hired = scheduleAction(game, { id: 'editable-hire-00001', owner: 'you', executeAt: 4, action: { type: 'hire', kind: game.recruitment!.you!.offers[0]! } });
  const unit = (hired.scheduled![0]! as { hireUnits: string[] }).hireUnits[0]!;
  const queued = scheduleTransfer(hired, { id: 'editable-recruit-001', owner: 'you', from: from.id, to: to.id, drones: 1, executeAt: 4.1 });
  const selected = editScheduledLaunch(queued, 'you', { planId: 'editable-recruit-001', drones: 0, specialists: [unit] });
  const executed = advance(selected, 4.1, { rivals: false });
  assert.equal(executed.fleets[0]!.specialists![0]!.id, unit);
  const canceled = cancelTransfer(selected, 'editable-hire-00001', 'you');
  assert.doesNotThrow(() => editScheduledLaunch(canceled, 'you', { planId: 'editable-recruit-001', drones: 0, specialists: [unit] }));
  assert.equal(advance(canceled, 4.1, { rivals: false }).fleets.length, 0);
  assert.throws(() => editScheduledLaunch(selected, 'you', { planId: 'editable-recruit-001', drones: 0, specialists: [] }));
  const cleared = editScheduledLaunch(selected, 'you', { planId: 'editable-recruit-001', drones: 1, specialists: [] });
  assert.deepEqual((cleared.scheduled![1]! as { specialists: string[] }).specialists, []);
});

test('unavailable plans, unknown manifests, and injected fields fail without changing a queue', () => {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 123);
  const [from, to] = game.rocks.filter(r => r.owner === 'you' && r.drones > 0);
  const queued = scheduleTransfer(game, { id: 'editable-private-01', owner: 'you', from: from!.id, to: to!.id, drones: 1, executeAt: 1 });
  const original = structuredClone(queued);
  const edit = { planId: 'editable-private-01', drones: 4 };
  for (const drones of [-1, 0, 0.2, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => editScheduledLaunch(queued, 'you', { ...edit, drones }));
  for (const specialists of [['unobserved-module'], ['duplicate', 'duplicate']]) assert.throws(() => editScheduledLaunch(queued, 'you', { ...edit, specialists }));
  for (const field of ['owner', 'fleetId', 'executeAt', 'from', 'action']) assert.throws(() => validateLaunchEdit({ ...edit, [field]: 'forged' }));
  const error = (planId: string) => { try { editScheduledLaunch(queued, 'vesper', { ...edit, planId }); } catch (e) { return (e as Error).message; } };
  assert.equal(error(edit.planId), error('nonexistent-plan-01'));
  assert.throws(() => editScheduledLaunch(advance(queued, 1, { rivals: false }), 'you', edit));
  assert.deepEqual(queued, original);
});

test('legacy manifest edits keep the cargo module and remain valid saves when the unit selection is empty', () => {
  const game = installModule(createLegacyGame(0), 'a', 'scavenger', 'you');
  const queued = scheduleTransfer(game, { id: 'legacy-edit-module1', owner: 'you', from: 'a', to: 'b', drones: 3, carryModule: true, executeAt: 1 });
  const edited = editScheduledLaunch(queued, 'you', { planId: 'legacy-edit-module1', drones: 4, specialists: [] });
  const loaded = decodeSave(JSON.stringify({ savedAt: 0, game: edited })).game;
  assert.deepEqual(loaded.scheduled, [{ ...queued.scheduled![0]!, drones: 4 }]);
  assert.equal(advance(loaded, 1, { rivals: false }).fleets[0]!.module, 'scavenger');
});

test('save and replay retain the original manifest before an edit and its replacement afterward', () => {
  for (const mechanicsVersion of [3, 4] as const) {
    const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 123);
    game.rules!.mechanicsVersion = mechanicsVersion;
    const [from, to] = game.rocks.filter(r => r.owner === 'you' && r.drones > 0);
    const scheduled = applyCommand(createArchive(game), { type: 'schedule', owner: 'you', plan: { id: 'edited-replay-plan01', from: from!.id, to: to!.id, drones: 5, executeAt: 1 } }, { rivals: false, knownThrough: 0 });
    const edited = applyCommand(scheduled.archive, { type: 'edit-schedule', owner: 'you', change: { planId: 'edited-replay-plan01', drones: 9 } }, { rivals: false, knownThrough: 0.5 });
    const loaded = decodeSave(JSON.stringify({ savedAt: 0, game: edited.game })).game;
    const data = exportArchive(edited.archive);
    const archive = decodeReplay(data, loaded, false);
    assert.equal((replayTo(archive, 0.25, { rivals: false, knownThrough: 1 }).scheduled![0]! as { drones: number }).drones, 5);
    assert.equal((replayTo(archive, 0.5, { rivals: false, knownThrough: 1 }).scheduled![0]! as { drones: number }).drones, 9);
    assert.equal(replayTo(archive, 1, { rivals: false, knownThrough: 1 }).fleets[0]!.drones, 9);
    assert.equal(edited.game.nextId, scheduled.game.nextId);
    for (const field of ['owner', 'fleetId', 'executeAt', 'from', 'to']) {
      const forged = structuredClone(data);
      const entry = forged.entries[1]!.command; assert.ok(entry.type === 'edit-schedule');
      Object.assign(entry.change, { [field]: field === 'fleetId' ? 99 : 'forged' });
      assert.throws(() => decodeReplay(forged, loaded, false));
    }
  }
});
