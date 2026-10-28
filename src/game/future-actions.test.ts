import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, advance } from './simulation';
import { scheduleAction } from './future-actions';
import { hireAmount } from './specialist-catalog';

test('a private future hire spends its credit at the scheduled hour and never reserves it early', () => {
  const game = createGame(0);
  const kind = game.recruitment!.you!.offers[0]!;
  const queued = scheduleAction(game, { id: 'future-hire-000001', owner: 'you', executeAt: 4, action: { type: 'hire', kind } });
  assert.equal(queued.recruitment!.you!.used, 0);
  assert.equal(advance(queued, 3.99, { rivals: false }).rocks[0]!.specialists!.length, 1);
  const executed = advance(queued, 4, { rivals: false });
  assert.equal(executed.recruitment!.you!.used, 1);
  assert.equal(executed.rocks[0]!.specialists!.length, 1 + hireAmount(kind));
  assert.equal(executed.scheduled!.length, 0);
  assert.equal(game.scheduled!.length, 0);
});

test('future hire identities stay scoped in observations and unknown later offers are not invented', async () => {
  const { observe, forecastObservation } = await import('./visibility');
  const game = createGame(0); const kind = game.recruitment!.you!.offers[0]!;
  const queued = scheduleAction(game, { id: 'future-hire-000002', owner: 'you', executeAt: 4, action: { type: 'hire', kind } });
  const view = observe(queued, 'you', id => id + 1000, id => `alias:${id}`);
  const plan = view.scheduled[0]!;
  assert.ok('action' in plan);
  assert.ok(plan.hireUnits!.every(id => id.startsWith('alias:')));
  assert.equal(observe(queued, 'vesper').scheduled.length, 0);
  const projected = forecastObservation(view, 'you', 4);
  assert.ok(projected.rocks[0]!.specialists!.some(unit => plan.hireUnits!.includes(unit.id)));
  assert.deepEqual(projected.recruitment!.you!.offers, []);
  assert.equal(projected.recruitmentUncertain, true);
});

test('future mine construction uses production earned before its execution time', () => {
  const game = createGame(0); const site = game.rocks.find(r => r.id === 'c')!; site.drones = 44;
  const queued = scheduleAction(game, { id: 'future-mine-000001', owner: 'you', executeAt: 8, action: { type: 'drill-mine', rock: site.id } });
  assert.equal(queued.rocks.find(r => r.id === site.id)!.kind, 'factory');
  const mined = advance(queued, 8, { rivals: false });
  assert.equal(mined.rocks.find(r => r.id === site.id)!.kind, 'mine');
  assert.equal(mined.rocks.find(r => r.id === site.id)!.drones, 0);
  assert.equal(mined.minesDrilled!.you, 1);
});

test('future actions and their stable hire identities survive private saves and replay reconstruction', async () => {
  const { decodeSave } = await import('./save-format');
  const { applyCommand, createArchive, exportArchive } = await import('./replay');
  const { decodeReplay } = await import('./replay-save');
  const game = createGame(0); const kind = game.recruitment!.you!.offers[0]!;
  const result = applyCommand(createArchive(game), { type: 'schedule-action', owner: 'you', plan: { id: 'future-replay-00001', executeAt: 4, action: { type: 'hire', kind } } }, { knownThrough: 0, rivals: false });
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: result.game })).game, result.game);
  const executed = advance(result.game, 4, { rivals: false });
  assert.doesNotThrow(() => decodeReplay(exportArchive(result.archive), executed, false));
});

test('a queued hire can supply a stable specialist identity to a later transfer', async () => {
  const { scheduleTransfer } = await import('./orders');
  const { isActionPlan } = await import('./future-actions');
  const game = createGame(0); const kind = game.recruitment!.you!.offers[0]!;
  const hired = scheduleAction(game, { id: 'future-hire-chain-01', owner: 'you', executeAt: 4, action: { type: 'hire', kind } });
  const hire = hired.scheduled![0]!; assert.ok(isActionPlan(hire));
  const unit = hire.hireUnits![0]!;
  const queued = scheduleTransfer(hired, { id: 'future-unit-route-01', owner: 'you', executeAt: 5, from: 'a', to: 'c', drones: 0, specialists: [unit] });
  const launched = advance(queued, 5, { rivals: false });
  assert.equal(launched.fleets[0]!.specialists![0]!.id, unit);
  assert.equal(launched.fleets[0]!.preparing, true);
});

test('a planned recruit can promote later and stale hiring offers abort without spending credits', () => {
  const game = createGame(0); game.recruitment!.you!.offers = ['lieutenant', 'smuggler', 'foreman'];
  const hired = scheduleAction(game, { id: 'future-promote-hire', owner: 'you', executeAt: 4, action: { type: 'hire', kind: 'foreman' } });
  const plan = hired.scheduled![0]!; assert.ok('action' in plan);
  const unit = plan.hireUnits![0]!;
  const promoted = scheduleAction(hired, { id: 'future-promote-unit', owner: 'you', executeAt: 22, action: { type: 'promote', id: unit } });
  const competing = scheduleAction(promoted, { id: 'future-stale-offer01', owner: 'you', executeAt: 23, action: { type: 'hire', kind: 'foreman' } });
  const result = advance(competing, 23, { rivals: false });
  assert.equal(result.rocks[0]!.specialists!.find(u => u.id === unit)!.kind, 'engineer');
  assert.equal(result.recruitment!.you!.used, 2);
  assert.ok(result.events.some(event => event.message.includes('offer has changed') && event.audience!.includes('you')));
});

test('a future transfer can depart from a site reached by an already ordered conquest', async () => {
  const { dispatch } = await import('./simulation');
  const { scheduleTransfer } = await import('./orders');
  const game = createGame(0); game.rocks.find(r => r.id === 'c')!.drones = 100;
  const incoming = dispatch(game, 'c', 'b', 30, 'you');
  const at = incoming.fleets[0]!.arrives + 1;
  const queued = scheduleTransfer(incoming, { id: 'future-colony-route1', owner: 'you', from: 'b', to: 'a', drones: 10, executeAt: at });
  const launched = advance(queued, at, { rivals: false });
  assert.equal(launched.fleets[0]!.from, 'b');
  assert.equal(launched.fleets[0]!.drones, 10);
  assert.equal(launched.rocks.find(r => r.id === 'b')!.owner, 'you');
});

test('a forecast keeps planned hire identities distinct from existing numbered specialists', async () => {
  const { hireSpecialist } = await import('./specialists');
  const { observe, forecastObservation } = await import('./visibility');
  let game = advance(createGame(0), 4, { rivals: false });
  game.recruitment!.you!.offers = ['lieutenant', 'smuggler', 'foreman'];
  game = hireSpecialist(game, 'you', 'lieutenant');
  const existing = game.rocks[0]!.specialists!.find(u => u.kind === 'lieutenant')!.id;
  const kind = game.recruitment!.you!.offers[0]!;
  const queued = scheduleAction(game, { id: 'future-known-unit-01', owner: 'you', executeAt: 22, action: { type: 'hire', kind } });
  const plan = queued.scheduled![0]!; assert.ok('action' in plan);
  const projected = forecastObservation(observe(queued, 'you'), 'you', 22);
  const ids = projected.rocks[0]!.specialists!.map(u => u.id);
  assert.ok(ids.includes(existing));
  assert.ok(ids.includes(plan.hireUnits![0]!));
  assert.equal(new Set(ids).size, ids.length);
});

test('future funding refuses self-funding and absent participants before saving an invalid plan', () => {
  const game = createGame(0);
  for (const to of ['you', 'zenith'] as const) assert.throws(() => scheduleAction(game, { id: 'future-invalid-fund', owner: 'you', executeAt: 2, action: { type: 'funding', to, enabled: true } }));
});

test('same-hour actions and transfers run in queue order without partial failure', async () => {
  const { scheduleTransfer } = await import('./orders');
  for (const mineFirst of [true, false]) {
    const game = createGame(0); game.rocks.find(r => r.id === 'c')!.drones = 50;
    const mine = (input: typeof game) => scheduleAction(input, { id: 'future-shared-mine01', owner: 'you', executeAt: 8, action: { type: 'drill-mine', rock: 'c' } });
    const transfer = (input: typeof game) => scheduleTransfer(input, { id: 'future-shared-route1', owner: 'you', executeAt: 8, from: 'c', to: 'a', drones: 10 });
    const result = advance(mineFirst ? transfer(mine(game)) : mine(transfer(game)), 8, { rivals: false });
    const site = result.rocks.find(r => r.id === 'c')!;
    assert.equal(site.kind, mineFirst ? 'mine' : 'factory');
    assert.equal(site.drones, mineFirst ? 6 : 46);
    assert.equal(result.fleets.length, mineFirst ? 0 : 1);
    assert.equal(result.scheduled!.length, 0);
    assert.ok(result.events.some(event => event.message.includes('aborted')));
  }
});

test('private action persistence rejects malformed commands and forged hire identities', async () => {
  const { decodeSave } = await import('./save-format');
  const game = createGame(0); const kind = game.recruitment!.you!.offers[0]!;
  const queued = scheduleAction(game, { id: 'future-valid-shape01', owner: 'you', executeAt: 4, action: { type: 'hire', kind } });
  for (const patch of [{ hireCycle: -1 }, { hireUnits: ['forged-unit'] }, { action: { type: 'hire', kind, owner: 'vesper' } }, { action: { type: 'resign' } }]) {
    const broken = structuredClone(queued); Object.assign(broken.scheduled![0]!, patch);
    assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game: broken })));
  }
});
