import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, advance } from './simulation';
import { createConfiguredGame } from './world';
import { scheduleTransfer } from './orders';
import { scheduleAction } from './future-actions';

test('mechanics 4 reserves a pending launch identity for later manifest edits', () => {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 123);
  const [from, to] = game.rocks.filter(r => r.owner === 'you');
  const queued = scheduleTransfer(game, { id: 'future-fleet-launch01', owner: 'you', from: from!.id, to: to!.id, drones: 5, executeAt: 1 });
  assert.equal(queued.scheduled![0]!.fleetId, game.nextId);
  assert.equal(queued.nextId, game.nextId + 1);
  const edited = scheduleAction(queued, { id: 'future-fleet-edit001', owner: 'you', executeAt: 1.05, action: { type: 'hauler', change: { action: 'edit-launch', fleet: game.nextId, drones: 3 } } });
  const result = advance(edited, 1.05, { rivals: false });
  assert.equal(result.fleets[0]!.id, game.nextId);
  assert.equal(result.fleets[0]!.drones, 3);
  assert.equal(result.nextId, queued.nextId);
});

test('observations and forecasts preserve aliases for current and pending fleet references', async () => {
  const { observe, forecastObservation } = await import('./visibility');
  const { plannedFleetIds } = await import('./future-actions');
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 123);
  const [from, to] = game.rocks.filter(r => r.owner === 'you');
  let queued = scheduleTransfer(game, { id: 'future-alias-launch1', owner: 'you', from: from!.id, to: to!.id, drones: 5, executeAt: 1 });
  queued = scheduleAction(queued, { id: 'future-alias-edit001', owner: 'you', executeAt: 1.05, action: { type: 'hauler', change: { action: 'edit-launch', fleet: game.nextId, drones: 3 } } });
  const view = observe(queued, 'you', id => id + 1000);
  assert.deepEqual(plannedFleetIds(view, 'you'), [1001]);
  assert.equal(observe(queued, 'vesper').scheduled.length, 0);
  const projected = forecastObservation(view, 'you', 1.02);
  assert.equal(projected.fleets[0]!.id, 1001);
  const edit = projected.scheduled[0]!;
  assert.ok('action' in edit && edit.action.type === 'hauler');
  assert.equal(edit.action.change.fleet, 1001);
  assert.equal(forecastObservation(projected, 'you', 1.05).fleets[0]!.drones, 3);
});

test('saves reject duplicate reservations and forged future references but retain canceled dependencies', async () => {
  const { decodeSave } = await import('./save-format');
  const { cancelTransfer } = await import('./orders');
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 123);
  const [from, to] = game.rocks.filter(r => r.owner === 'you');
  const launch = { id: 'future-save-launch01', owner: 'you' as const, from: from!.id, to: to!.id, drones: 5, executeAt: 1 };
  const queued = scheduleTransfer(game, launch);
  const chained = scheduleAction(queued, { id: 'future-save-cancel01', owner: 'you', executeAt: 1.05, action: { type: 'hauler', change: { action: 'cancel-launch', fleet: game.nextId } } });
  const decode = (value: typeof game) => decodeSave(JSON.stringify({ savedAt: 0, game: value })).game;
  assert.deepEqual(decode(chained), chained);
  assert.doesNotThrow(() => decode(cancelTransfer(chained, launch.id, 'you')));
  const duplicate = scheduleTransfer(chained, { ...launch, id: 'future-save-launch02' });
  duplicate.scheduled![2]!.fleetId = game.nextId;
  assert.throws(() => decode(duplicate));
  const forged = structuredClone(chained);
  const plan = forged.scheduled![1]!; assert.ok('action' in plan && plan.action.type === 'hauler');
  plan.action.change.fleet = forged.nextId;
  assert.throws(() => decode(forged));
});

test('canceled or failed launch dependencies abort privately and never reuse reserved ids', async () => {
  const { cancelTransfer } = await import('./orders');
  const { observe } = await import('./visibility');
  for (const canceled of [false, true]) {
    const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 123);
    const [from, to] = game.rocks.filter(r => r.owner === 'you');
    let queued = scheduleTransfer(game, { id: 'future-failure-plan1', owner: 'you', from: from!.id, to: to!.id, drones: 99999, executeAt: 1 });
    queued = scheduleAction(queued, { id: 'future-failure-edit1', owner: 'you', executeAt: 1.05, action: { type: 'hauler', change: { action: 'cancel-launch', fleet: game.nextId } } });
    if (canceled) queued = cancelTransfer(queued, 'future-failure-plan1', 'you');
    const result = advance(queued, 1.05, { rivals: false });
    assert.equal(result.fleets.length, 0);
    assert.equal(result.nextId, game.nextId + 1);
    assert.equal(result.scheduled!.length, 0);
    assert.ok(observe(result, 'you').events.some(e => e.message.includes('aborted')));
    assert.ok(!observe(result, 'vesper').events.some(e => e.message.includes('aborted')));
  }
});

test('future scheduling validates identity knowledge without testing hidden future feasibility', async () => {
  const { dispatch } = await import('./simulation');
  const { canObserveHauler } = await import('./sensors');
  const base = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 123);
  const enemy = base.rocks.filter(r => r.owner === 'vesper');
  const game = dispatch(base, enemy[0]!.id, enemy[1]!.id, 1, 'vesper');
  const fleet = game.fleets[0]!;
  assert.equal(canObserveHauler(game, 'you', fleet), false);
  for (const target of [fleet.id, game.nextId]) assert.throws(() => scheduleAction(game, { id: 'future-private-probe', owner: 'you', executeAt: 1, action: { type: 'intercept', from: base.rocks[0]!.id, target, drones: 99999 } }));
  const sites = base.rocks.filter(r => r.owner === 'you');
  const own = dispatch(game, sites[0]!.id, sites[1]!.id, 1, 'you');
  assert.doesNotThrow(() => scheduleAction(own, { id: 'future-owned-target1', owner: 'you', executeAt: 1, action: { type: 'intercept', from: enemy[0]!.id, target: own.fleets[1]!.id, drones: 99999 } }));
});

test('future gifts reserve identity and use live preparation and gift cancellation windows', async () => {
  const { giftTransfer } = await import('./gifts');
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 123);
  const from = game.rocks.find(r => r.owner === 'you')!;
  const to = game.rocks.find(r => r.owner === 'vesper')!;
  const queued = scheduleAction(game, { id: 'future-gift-launch01', owner: 'you', executeAt: 1, action: { type: 'gift', from: from.id, to: to.id, drones: 3, recipient: 'vesper' } });
  const cancel = scheduleAction(queued, { id: 'future-gift-cancel01', owner: 'you', executeAt: 1.05, action: { type: 'hauler', change: { action: 'cancel-gift', fleet: game.nextId } } });
  const launched = advance(cancel, 1, { rivals: false });
  const live = giftTransfer(advance(game, 1, { rivals: false }), from.id, to.id, 3, 'you', 'vesper');
  assert.deepEqual(launched.fleets, live.fleets);
  assert.equal(launched.fleets[0]!.preparing, true);
  assert.equal(advance(cancel, 1.05, { rivals: false }).fleets[0]!.giftAt, undefined);
});

test('future interceptions use reserved identities and the live interception path', async () => {
  const { dispatch } = await import('./simulation');
  const { dispatchIntercept } = await import('./interception');
  const game = createGame(0);
  // Keep the compact chart while enabling the new identity contract.
  game.rules = createConfiguredGame({ playerCount: 3, mode: 'mining' }, 0, 123).rules;
  const source = game.rocks.find(r => r.id === 'c')!;
  source.specialists!.push({ id: 'future-pirate', kind: 'pirate', owner: 'you' });
  const moving = advance(dispatch(game, 'f', 'c', 10, 'vesper'), 0.2, { rivals: false });
  const target = moving.fleets[0]!.id;
  const queued = scheduleAction(moving, { id: 'future-intercept-001', owner: 'you', executeAt: 0.3, action: { type: 'intercept', from: 'c', target, drones: 2, specialists: ['future-pirate'] } });
  const chained = scheduleAction(queued, { id: 'future-intercept-end', owner: 'you', executeAt: 0.35, action: { type: 'hauler', change: { action: 'cancel-launch', fleet: moving.nextId } } });
  const result = advance(chained, 0.3, { rivals: false });
  const live = dispatchIntercept(advance(moving, 0.3, { rivals: false }), 'c', target, 2, 'you', true, ['future-pirate']);
  assert.deepEqual(result.fleets, live.fleets);
  assert.equal(result.nextId, queued.nextId);
  assert.equal(advance(chained, 0.35, { rivals: false }).fleets.length, 1);
});

test('mechanics 3 retains launch-time allocation and new actions replay without reservations', async () => {
  const { applyCommand, createArchive, exportArchive } = await import('./replay');
  const { decodeReplay } = await import('./replay-save');
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 123);
  game.rules!.mechanicsVersion = 3;
  delete game.rules!.driftingBases;
  const [from, to] = game.rocks.filter(r => r.owner === 'you');
  const result = applyCommand(createArchive(game), { type: 'schedule-action', owner: 'you', plan: { id: 'future-legacy-gift01', executeAt: 1, action: { type: 'gift', from: from!.id, to: to!.id, drones: 3, recipient: 'vesper' } } }, { knownThrough: 0, rivals: false });
  assert.equal(result.game.nextId, game.nextId);
  assert.equal(result.game.scheduled![0]!.fleetId, undefined);
  const executed = advance(result.game, 1, { rivals: false });
  assert.equal(executed.nextId, game.nextId + 1);
  assert.doesNotThrow(() => decodeReplay(exportArchive(result.archive), executed, false));
  const transfer = scheduleTransfer(game, { id: 'future-legacy-route1', owner: 'you', executeAt: 1, from: from!.id, to: to!.id, drones: 3 });
  assert.equal(transfer.nextId, game.nextId);
  assert.equal(transfer.scheduled![0]!.fleetId, undefined);
});

test('mechanics 4 queued chains reconstruct from canonical replay and reject identity injection', async () => {
  const { applyCommand, createArchive, exportArchive } = await import('./replay');
  const { decodeReplay } = await import('./replay-save');
  const { validateFutureAction } = await import('./future-actions');
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 123);
  const [from, to] = game.rocks.filter(r => r.owner === 'you');
  const launch = { type: 'schedule' as const, owner: 'you' as const, plan: { id: 'future-replay-route1', executeAt: 1, from: from!.id, to: to!.id, drones: 3 } };
  const first = applyCommand(createArchive(game), launch, { knownThrough: 0, rivals: false });
  const second = applyCommand(first.archive, { type: 'schedule-action', owner: 'you', plan: { id: 'future-replay-edit01', executeAt: 1.05, action: { type: 'hauler', change: { action: 'edit-launch', fleet: game.nextId, drones: 2 } } } }, { knownThrough: 0, rivals: false });
  const executed = advance(second.game, 1.05, { rivals: false });
  assert.doesNotThrow(() => decodeReplay(exportArchive(second.archive), executed, false));
  const corrupt = exportArchive(first.archive);
  Object.assign((corrupt.entries[0]!.command as typeof launch).plan, { fleetId: 100 });
  assert.throws(() => decodeReplay(corrupt, first.game, false));
  for (const action of [
    { type: 'gift', from: from!.id, to: to!.id, drones: 1, recipient: 'vesper', fleetId: 4 },
    { type: 'intercept', from: from!.id, target: 1, drones: 1, requireContact: false },
    { type: 'hauler', change: { action: 'gift', fleet: 1, owner: 'vesper' } },
  ]) assert.throws(() => validateFutureAction(action));
});

test('planned hire manifests survive gift and fleet-edit alias mapping without leaking counter ids', async () => {
  const { observe, forecastObservation } = await import('./visibility');
  const { plannedUnitIds, mapActionUnits, mapActionFleets } = await import('./future-actions');
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 123);
  const core = game.rocks.find(r => r.coreOf === 'you')!;
  const to = game.rocks.find(r => r.owner === 'you' && r !== core)!;
  const kind = game.recruitment!.you!.offers[0]!;
  const hired = scheduleAction(game, { id: 'future-manifest-hire', owner: 'you', executeAt: 4, action: { type: 'hire', kind } });
  const units = plannedUnitIds(hired, 'you');
  const gifted = scheduleAction(hired, { id: 'future-manifest-gift', owner: 'you', executeAt: 5, action: { type: 'gift', from: core.id, to: to.id, drones: 0, recipient: 'vesper', specialists: units } });
  const edited = scheduleAction(gifted, { id: 'future-manifest-edit', owner: 'you', executeAt: 5.05, action: { type: 'hauler', change: { action: 'edit-launch', fleet: game.nextId, drones: 1, specialists: units } } });
  const view = observe(edited, 'you', id => id + 8000, id => `alias:${id}`);
  const prediction = forecastObservation(view, 'you', 5.05);
  assert.equal(prediction.fleets[0]!.id, game.nextId + 8000);
  assert.deepEqual(prediction.fleets[0]!.specialists!.map(u => u.id), units.map(id => `alias:${id}`));
  const edit = view.scheduled[2]!; assert.ok('action' in edit && edit.action.type === 'hauler');
  assert.deepEqual(mapActionFleets(mapActionUnits(edit.action, id => id.slice(6)), id => id - 8000), { type: 'hauler', change: { action: 'edit-launch', fleet: game.nextId, drones: 1, specialists: units } });
  const small = observe(edited, 'you', id => id + 1);
  assert.deepEqual(view.events, small.events);
});

test('current and queued fleet aliases remain distinct when launch order differs from reservation order', async () => {
  const { dispatch } = await import('./simulation');
  const { observe, forecastObservation } = await import('./visibility');
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 123);
  const [from, to] = game.rocks.filter(r => r.owner === 'you');
  let queued = scheduleTransfer(game, { id: 'future-order-later01', owner: 'you', from: from!.id, to: to!.id, drones: 2, executeAt: 2 });
  queued = scheduleTransfer(queued, { id: 'future-order-first01', owner: 'you', from: from!.id, to: to!.id, drones: 2, executeAt: 1 });
  queued = dispatch(queued, from!.id, to!.id, 2, 'you');
  const view = observe(queued, 'you', id => id * 71);
  const projection = forecastObservation(view, 'you', 2);
  assert.deepEqual(projection.fleets.map(f => f.id).sort((a, b) => a - b), [71, 142, 213]);
  assert.deepEqual(advance(queued, 2, { rivals: false }).fleets.map(f => f.id).sort((a, b) => a - b), [1, 2, 3]);
});
