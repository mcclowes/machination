import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createGame } from '../src/game/simulation';
import { createConfiguredGame } from '../src/game/world';
import { isActionPlan } from '../src/game/future-actions';
import { promotion } from '../src/game/specialist-catalog';
import { GameService } from './service';
import { createApi } from './http';
import type { ScheduleOrder } from '../src/online/protocol';

async function setup(t: TestContext, initialGame: typeof createGame = epoch => createGame(epoch, { you: 42, vesper: 43, null: 44 })) {
  const directory = await mkdtemp(join(tmpdir(), 'machination-future-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'world.json'); let now = 0;
  const service = await GameService.open(file, () => now, initialGame);
  const tokens = Array.from({ length: 4 }, () => randomBytes(32).toString('hex'));
  const created = await service.create(tokens[0]!);
  await service.join(created.invite, tokens[1]!); await service.join(created.invite, tokens[2]!);
  const start = await service.start(created.id, tokens[0]!);
  return { service, tokens, file, start, id: created.id, clock: () => now, hour: (hour: number) => { now = hour * 3_600_000; } };
}

test('private future actions authenticate, deduplicate, cancel, replay, and survive restart', async t => {
  const s = await setup(t); const { service, id, tokens } = s;
  const command: ScheduleOrder = { requestId: randomUUID(), revision: s.start.revision, executeAt: 2, action: { type: 'shields', rock: 'c', disabled: true } };
  await assert.rejects(service.schedule(id, tokens[3]!, command), { status: 401 });
  const queued = await service.schedule(id, tokens[0]!, command);
  const reordered = { ...command, action: { disabled: true, rock: 'c', type: 'shields' as const } };
  assert.equal((await service.schedule(id, tokens[0]!, reordered)).revision, queued.revision);
  assert.equal(queued.game.scheduled.length, 1);
  assert.equal((await service.schedule(id, tokens[0]!, command)).revision, queued.revision);
  await assert.rejects(service.schedule(id, tokens[0]!, { ...command, executeAt: 3 }), { status: 409 });
  await assert.rejects(service.schedule(id, tokens[0]!, { ...command, requestId: randomUUID() }), { status: 409 });
  const rival = await service.snapshot(id, tokens[1]!);
  assert.equal(rival.game.scheduled.length, 0);
  await assert.rejects(service.cancelSchedule(id, tokens[1]!, { requestId: randomUUID(), revision: rival.revision, planId: command.requestId }));
  assert.equal((await service.history(id, tokens[0]!, 0)).game.scheduled.length, 1);
  assert.equal((await service.history(id, tokens[1]!, 0)).game.scheduled.length, 0);
  const reopened = await GameService.open(s.file, s.clock, createGame);
  const restored = await reopened.schedule(id, tokens[0]!, command);
  assert.deepEqual(restored.game.scheduled, queued.game.scheduled);
  assert.equal(restored.revision, queued.revision);
  const cancel = { requestId: randomUUID(), revision: queued.revision, planId: command.requestId };
  assert.equal((await reopened.cancelSchedule(id, tokens[0]!, cancel)).game.scheduled.length, 0);
  assert.equal((await reopened.cancelSchedule(id, tokens[0]!, cancel)).game.scheduled.length, 0);
  const archive = JSON.parse(await readFile(s.file, 'utf8')).rooms[0].replay;
  assert.equal(archive.entries.filter((entry: any) => entry.command.type === 'schedule-action').length, 1);
});

test('HTTP refuses unknown nested fields and owner injection without consuming request IDs', async t => {
  const s = await setup(t); const server = createApi(s.service);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const command = { requestId: randomUUID(), revision: s.start.revision, executeAt: 2, action: { type: 'shields', rock: 'c', disabled: true } };
  const port = address.port;
  async function send(body: unknown, token = s.tokens[0]!) {
    const response = await fetch(`http://127.0.0.1:${port}/v1/games/${s.id}/schedules`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  for (const body of [
    { ...command, owner: 'vesper' }, { ...command, action: { ...command.action, owner: 'vesper' } },
    { ...command, action: { ...command.action, disabled: 'false' } }, { ...command, action: { type: 'unknown' } },
    { ...command, action: null }, { ...command, action: [] }, { ...command, action: { type: 'funding', to: 'you', enabled: 1 } },
    { ...command, action: { type: 'promote', id: 'x', nested: {} } }, { ...command, from: 'a' },
    { ...command, fleetId: 1 },
    { ...command, action: { type: 'gift', from: 'c', to: 'f', drones: 1, recipient: 'vesper', fleetId: 1 } },
    { ...command, action: { type: 'intercept', from: 'c', target: 1, drones: 1, fleetId: 2 } },
    { ...command, action: { type: 'hauler', change: { action: 'cancel-launch', fleet: 1, fleetId: 2 } } },
    { ...command, action: { type: 'hauler', change: { action: 'edit-launch', fleet: 1, drones: 1, specialists: ['x', 'x'] } } },
    { ...command, action: { type: 'hauler', change: { action: 'course', fleet: 1, to: 'a', requireContact: false } } },
  ]) {
    const result = await send(body); assert.equal(result.status, 400);
    assert.equal(result.body.issues[0].issue, 'schedule.validation.payload');
    assert.ok(result.body.issues[0].correlationId);
  }
  assert.equal((await send(command, s.tokens[3]!)).status, 401);
  assert.equal((await send(command)).status, 200);
});

test('unit plans accept only current seat aliases and queued own hires', async t => {
  const s = await setup(t); const { service, id, tokens } = s;
  let current = s.start;
  const core = current.game.rocks.flatMap(r => r.specialists ?? []).find(u => u.kind === 'queen')!;
  for (const unit of ['core-you', 'core-vesper', 'unobserved-unit']) {
    await assert.rejects(service.schedule(id, tokens[0]!, { requestId: randomUUID(), revision: current.revision, executeAt: 1, action: { type: 'promote', id: unit } }), { code: 'schedule.conflict.invalid' });
  }
  current = await service.schedule(id, tokens[0]!, { requestId: randomUUID(), revision: current.revision, executeAt: 1, action: { type: 'promote', id: core.id } });
  const stored = JSON.parse(await readFile(s.file, 'utf8')).rooms[0];
  const hiddenAlias = String(createHmac('sha256', stored.seats[0].identityHash ?? stored.seats[0].hash).update('unit:core-null').digest().readUIntBE(0, 6));
  await assert.rejects(service.schedule(id, tokens[0]!, { requestId: randomUUID(), revision: current.revision, executeAt: 1, action: { type: 'release', id: hiddenAlias } }), { code: 'schedule.conflict.invalid' });
  const rival = await service.snapshot(id, tokens[1]!);
  await assert.rejects(service.schedule(id, tokens[1]!, { requestId: randomUUID(), revision: rival.revision, executeAt: 1, action: { type: 'release', id: core.id } }));
  // A core cannot promote, but queueing must not probe execution-time eligibility.
  s.hour(1); current = await service.snapshot(id, tokens[0]!);
  assert.equal(current.game.scheduled.length, 0);
  assert.ok(current.game.rocks.flatMap(r => r.specialists ?? []).some(u => u.id === core.id));
});

test('queued hire identity remains stable through chained promotion and transfer', async t => {
  const s = await setup(t); const { service, id, tokens } = s;
  const kind = s.start.game.recruitment!.you!.offers.find(kind => promotion(kind));
  assert.ok(kind, 'fixture offers a promotable recruit');
  const hireCommand: ScheduleOrder = { requestId: randomUUID(), revision: s.start.revision, executeAt: 4, action: { type: 'hire', kind } };
  let current = await service.schedule(id, tokens[0]!, hireCommand);
  const hire = current.game.scheduled.find(isActionPlan)!; const unit = hire.hireUnits![0]!;
  assert.ok(!unit.startsWith('hire:'));
  const rival = await service.snapshot(id, tokens[1]!);
  await assert.rejects(service.schedule(id, tokens[1]!, { requestId: randomUUID(), revision: rival.revision, executeAt: 5, action: { type: 'promote', id: unit } }));
  await assert.rejects(service.schedule(id, tokens[0]!, { requestId: randomUUID(), revision: current.revision, executeAt: 5, action: { type: 'promote', id: `hire:you:${hire.id}:0` } }));
  current = await service.schedule(id, tokens[0]!, { requestId: randomUUID(), revision: current.revision, executeAt: 22, action: { type: 'promote', id: unit } });
  current = await service.schedule(id, tokens[0]!, { requestId: randomUUID(), revision: current.revision, executeAt: 23, from: 'a', to: 'c', drones: 0, specialists: [unit] });
  const reopened = await GameService.open(s.file, s.clock, createGame);
  s.hour(23); current = await reopened.snapshot(id, tokens[0]!);
  const recruited = [...current.game.rocks, ...current.game.fleets].flatMap(r => r.specialists ?? []).find(u => u.id === unit);
  assert.ok(recruited); assert.equal(recruited.kind, promotion(kind));
  const retried = await reopened.schedule(id, tokens[0]!, hireCommand);
  assert.equal(retried.revision, current.revision);
  assert.equal(retried.game.scheduled.length, 0);
  assert.ok(current.game.fleets.some(f => f.specialists?.some(u => u.id === unit)));
  assert.equal((await reopened.history(id, tokens[0]!, 4)).game.rocks.flatMap(r => r.specialists ?? []).find(u => u.id === unit)?.kind, kind);
});

test('changed recruitment offers fail at execution without reserving credits', async t => {
  const s = await setup(t); const { service, id, tokens } = s;
  const kind = s.start.game.recruitment!.you!.offers[0]!;
  const queued = await service.schedule(id, tokens[0]!, { requestId: randomUUID(), revision: s.start.revision, executeAt: 5, action: { type: 'hire', kind } });
  assert.deepEqual(queued.game.recruitment, s.start.game.recruitment);
  s.hour(4);
  await service.specialist(id, tokens[0]!, { requestId: randomUUID(), revision: queued.revision, action: 'hire', kind });
  s.hour(5); const after = await service.snapshot(id, tokens[0]!);
  assert.equal(after.game.recruitment!.you!.used, 1);
  assert.equal(after.game.scheduled.length, 0);
});

test('scheduled transfer permits an owned module elsewhere and checks departure at execution', async t => {
  const s = await setup(t); const { service, id, tokens } = s;
  const core = s.start.game.rocks.find(r => r.id === 'a')!.specialists![0]!;
  let current = await service.schedule(id, tokens[0]!, { requestId: randomUUID(), revision: s.start.revision, executeAt: 4, from: 'c', to: 'b', drones: 0, specialists: [core.id] });
  current = await service.order(id, tokens[0]!, { requestId: randomUUID(), revision: current.revision, from: 'a', to: 'c', drones: 0, specialists: [core.id] });
  s.hour(4); current = await service.snapshot(id, tokens[0]!);
  assert.ok(current.game.fleets.some(f => f.from === 'c' && f.to === 'b' && f.specialists?.some(u => u.id === core.id)));
  assert.equal(current.game.scheduled.length, 0);
});

test('future action bodies are copied before waiting on the transaction queue', async t => {
  const s = await setup(t); const { service, id, tokens } = s;
  const body: ScheduleOrder = { requestId: randomUUID(), revision: s.start.revision, executeAt: 2, action: { type: 'shields', rock: 'c', disabled: true } };
  const pending = service.schedule(id, tokens[0]!, body);
  assert.equal(body.action.type, 'shields');
  if (body.action.type === 'shields') body.action.disabled = false;
  const result = await pending;
  const plan = result.game.scheduled.find(isActionPlan)!;
  assert.deepEqual(plan.action, { type: 'shields', rock: 'c', disabled: true });
});

test('future site and funding requirements are deferred until execution', async t => {
  const s = await setup(t); const { service, id, tokens } = s;
  let current = s.start;
  for (const action of [
    { type: 'drill-mine', rock: 'f' } as const,
    { type: 'shields', rock: 'f', disabled: true } as const,
    { type: 'funding', to: 'vesper', enabled: true } as const,
  ]) current = await service.schedule(id, tokens[0]!, { requestId: randomUUID(), revision: current.revision, executeAt: 1, action });
  assert.equal(current.game.scheduled.length, 3);
  assert.deepEqual(current.game.cargo, s.start.game.cargo);
  s.hour(1); current = await service.snapshot(id, tokens[0]!);
  assert.equal(current.game.scheduled.length, 0);
  const rival = await service.snapshot(id, tokens[1]!);
  assert.equal(rival.game.rocks.find(r => r.id === 'f')!.owner, 'vesper');
});


test('own queued launch aliases support private future edits, cancellation, and restart receipts', async t => {
  const s = await setup(t, epoch => createConfiguredGame({ playerCount: 3, mode: 'mining' }, epoch ?? 0, 42));
  const { service, id, tokens } = s;
  const [from, to] = s.start.game.rocks.filter(r => r.owner === 'you');
  const launch: ScheduleOrder = { requestId: randomUUID(), revision: s.start.revision, executeAt: 1, from: from!.id, to: to!.id, drones: 5 };
  let current = await service.schedule(id, tokens[0]!, launch);
  const fleet = current.game.scheduled[0]!.fleetId!;
  assert.ok(Number.isSafeInteger(fleet));
  const stored = JSON.parse(await readFile(s.file, 'utf8')).rooms[0];
  const raw = stored.game.scheduled[0].fleetId;
  assert.notEqual(fleet, raw);
  const foreign = createHmac('sha256', stored.seats[1].identityHash ?? stored.seats[1].hash).update(`hauler:${raw}`).digest().readUIntBE(0, 6);
  const edit: ScheduleOrder = { requestId: randomUUID(), revision: current.revision, executeAt: 1.05, action: { type: 'hauler', change: { action: 'edit-launch', fleet, drones: 3 } } };
  for (const invalid of [raw, foreign, fleet + 1]) {
    await assert.rejects(service.schedule(id, tokens[0]!, { ...edit, requestId: randomUUID(), action: { type: 'hauler', change: { action: 'edit-launch', fleet: invalid, drones: 3 } } }), { code: 'schedule.conflict.invalid' });
  }
  current = await service.schedule(id, tokens[0]!, edit);
  assert.deepEqual(current.game.scheduled.find(isActionPlan)!.action, edit.action);
  assert.equal((await service.snapshot(id, tokens[1]!)).game.scheduled.length, 0);
  const reopened = await GameService.open(s.file, s.clock, createGame);
  assert.deepEqual((await reopened.schedule(id, tokens[0]!, edit)).game.scheduled, current.game.scheduled);
  assert.deepEqual((await reopened.history(id, tokens[0]!, 0)).game.scheduled, current.game.scheduled);
  const cancellation = { requestId: randomUUID(), revision: current.revision, planId: edit.requestId };
  current = await reopened.cancelSchedule(id, tokens[0]!, cancellation);
  assert.equal((await reopened.cancelSchedule(id, tokens[0]!, cancellation)).revision, current.revision);
  await reopened.cancelSchedule(id, tokens[0]!, { requestId: randomUUID(), revision: current.revision, planId: launch.requestId });
  current = await reopened.snapshot(id, tokens[0]!);
  await assert.rejects(reopened.schedule(id, tokens[0]!, { ...edit, requestId: randomUUID(), revision: current.revision }), { code: 'schedule.conflict.invalid' });
  assert.equal((await reopened.schedule(id, tokens[0]!, edit)).game.scheduled.length, 0);
});

test('future gift manifests use own known units and planned hires without probing future site ownership', async t => {
  const s = await setup(t); const { service, id, tokens } = s;
  const core = s.start.game.rocks.find(r => r.id === 'a')!.specialists![0]!;
  let current = await service.schedule(id, tokens[0]!, { requestId: randomUUID(), revision: s.start.revision, executeAt: 4, action: { type: 'hire', kind: s.start.game.recruitment!.you!.offers[0]! } });
  const hire = current.game.scheduled.find(isActionPlan)!;
  const unit = hire.hireUnits![0]!;
  const command: ScheduleOrder = { requestId: randomUUID(), revision: current.revision, executeAt: 5, action: { type: 'gift', from: 'f', to: 'a', drones: 0, recipient: 'vesper', specialists: [core.id, unit] } };
  assert.equal(command.action.type, 'gift');
  if (command.action.type !== 'gift') throw new Error('Expected gift');
  for (const invalid of ['core-you', `hire:you:${hire.id}:0`, 'unobserved']) {
    await assert.rejects(service.schedule(id, tokens[0]!, { ...command, requestId: randomUUID(), action: { ...command.action, specialists: [invalid] } }), { code: 'schedule.conflict.invalid' });
  }
  current = await service.schedule(id, tokens[0]!, command);
  assert.deepEqual(current.game.scheduled.filter(isActionPlan).find(p => p.id === command.requestId)!.action, command.action);
  const reordered = { ...command, action: { specialists: [core.id, unit], recipient: 'vesper' as const, drones: 0, to: 'a', from: 'f', type: 'gift' as const } };
  assert.equal((await service.schedule(id, tokens[0]!, reordered)).revision, current.revision);
  assert.equal((await service.snapshot(id, tokens[1]!)).game.scheduled.length, 0);
  const reopened = await GameService.open(s.file, s.clock, createGame);
  assert.equal((await reopened.schedule(id, tokens[0]!, command)).revision, current.revision);
});

test('future interception accepts only currently observed enemy aliases and haulers only own identities', async t => {
  const s = await setup(t); const { service, id, tokens } = s;
  const rival = await service.snapshot(id, tokens[1]!);
  const launched = await service.order(id, tokens[1]!, { requestId: randomUUID(), revision: rival.revision, from: 'f', to: 'a', drones: 5 });
  let current = await service.snapshot(id, tokens[0]!);
  const command = (target: number) => ({ requestId: randomUUID(), revision: current.revision, executeAt: 2, action: { type: 'intercept' as const, from: 'a', target, drones: 1 } });
  const stored = JSON.parse(await readFile(s.file, 'utf8')).rooms[0];
  const raw = stored.game.fleets[0].id;
  const ownHiddenAlias = createHmac('sha256', stored.seats[0].identityHash ?? stored.seats[0].hash).update(`hauler:${raw}`).digest().readUIntBE(0, 6);
  assert.equal(current.game.fleets.length, 0, 'preparing enemy launch is hidden');
  await assert.rejects(service.schedule(id, tokens[0]!, command(ownHiddenAlias)), { code: 'schedule.conflict.invalid' });
  await assert.rejects(service.schedule(id, tokens[0]!, command(launched.game.fleets[0]!.id)), { code: 'schedule.conflict.invalid' });
  await assert.rejects(service.schedule(id, tokens[0]!, command(raw)), { code: 'schedule.conflict.invalid' });
  s.hour(0.2); current = await service.snapshot(id, tokens[0]!);
  const target = current.game.fleets.find(f => f.owner === 'vesper')!.id;
  await assert.rejects(service.schedule(id, tokens[0]!, { requestId: randomUUID(), revision: current.revision, executeAt: 2, action: { type: 'hauler', change: { action: 'cancel-launch', fleet: target } } }), { code: 'schedule.conflict.invalid' });
  const accepted = command(target);
  current = await service.schedule(id, tokens[0]!, accepted);
  assert.deepEqual(current.game.scheduled.find(isActionPlan)!.action, accepted.action);
  const own = await service.order(id, tokens[0]!, { requestId: randomUUID(), revision: current.revision, from: 'c', to: 'b', drones: 1 });
  const fleet = own.game.fleets.find(f => f.owner === 'you')!.id;
  await assert.rejects(service.schedule(id, tokens[0]!, { ...command(fleet), revision: own.revision }), { code: 'schedule.conflict.invalid' });
  current = await service.schedule(id, tokens[0]!, { requestId: randomUUID(), revision: own.revision, executeAt: 1, action: { type: 'hauler', change: { action: 'gift', fleet } } });
  assert.equal(current.game.scheduled.length, 2);
});

test('nested fleet manifests and changes are snapshotted before asynchronous transactions', async t => {
  const s = await setup(t); const { service, id, tokens } = s;
  const core = s.start.game.rocks.find(r => r.id === 'a')!.specialists![0]!;
  const launched = await service.order(id, tokens[0]!, { requestId: randomUUID(), revision: s.start.revision, from: 'c', to: 'b', drones: 1 });
  const body: ScheduleOrder = { requestId: randomUUID(), revision: launched.revision, executeAt: 0.1, action: { type: 'hauler', change: { action: 'edit-launch', fleet: launched.game.fleets[0]!.id, drones: 2, specialists: [core.id] } } };
  const expected = structuredClone(body.action);
  const pending = service.schedule(id, tokens[0]!, body);
  if (body.action.type !== 'hauler' || body.action.change.action !== 'edit-launch') throw new Error('Expected launch edit');
  body.action.change.fleet = 1;
  body.action.change.drones = 999;
  body.action.change.specialists![0] = 'forged';
  const current = await pending;
  assert.deepEqual(current.game.scheduled.find(isActionPlan)!.action, expected);
});

test('HTTP queued gift launch and planned hire aliases survive execution, replay, and receipt restart', async t => {
  const s = await setup(t, epoch => createConfiguredGame({ playerCount: 3, mode: 'mining' }, epoch ?? 0, 42));
  const { service, id, tokens } = s;
  const server = createApi(service); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const port = address.port;
  async function send(body: ScheduleOrder) {
    const response = await fetch(`http://127.0.0.1:${port}/v1/games/${id}/schedules`, { method: 'POST', headers: { Authorization: `Bearer ${tokens[0]}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    return await response.json() as typeof s.start;
  }
  const [from, to] = s.start.game.rocks.filter(r => r.owner === 'you');
  const launch: ScheduleOrder = { requestId: randomUUID(), revision: s.start.revision, executeAt: 1, action: { type: 'gift', from: from!.id, to: to!.id, drones: 5, recipient: 'vesper' } };
  let current = await send(launch);
  const fleet = current.game.scheduled[0]!.fleetId!;
  current = await send({ requestId: randomUUID(), revision: current.revision, executeAt: 4, action: { type: 'hire', kind: current.game.recruitment!.you!.offers[0]! } });
  const unit = current.game.scheduled.filter(isActionPlan).find(p => p.action.type === 'hire')!.hireUnits![0]!;
  const manifest: ScheduleOrder = { requestId: randomUUID(), revision: current.revision, executeAt: 4.1, action: { type: 'hauler', change: { action: 'edit-launch', fleet, drones: 2, specialists: [unit] } } };
  current = await send(manifest);
  assert.deepEqual(current.game.scheduled.filter(isActionPlan).find(p => p.id === manifest.requestId)!.action, manifest.action);
  const edit: ScheduleOrder = { requestId: randomUUID(), revision: current.revision, executeAt: 1.05, action: { type: 'hauler', change: { action: 'edit-launch', fleet, drones: 3 } } };
  current = await send(edit);
  const reordered: ScheduleOrder = { ...edit, action: { type: 'hauler', change: { drones: 3, fleet, action: 'edit-launch' } } };
  assert.equal((await send(reordered)).revision, current.revision);
  const reopened = await GameService.open(s.file, s.clock, createGame);
  s.hour(1.05); current = await reopened.snapshot(id, tokens[0]!);
  assert.equal(current.game.fleets.find(f => f.id === fleet)!.drones, 3);
  assert.equal((await reopened.schedule(id, tokens[0]!, edit)).revision, current.revision);
  assert.equal((await reopened.history(id, tokens[0]!, 1.05)).game.fleets.find(f => f.id === fleet)!.drones, 3);
  const again = await GameService.open(s.file, s.clock, createGame);
  assert.equal((await again.schedule(id, tokens[0]!, launch)).game.fleets.filter(f => f.id === fleet).length, 1);
});
