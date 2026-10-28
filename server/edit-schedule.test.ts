import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createGame } from '../src/game/simulation';
import { createConfiguredGame } from '../src/game/world';
import { isActionPlan } from '../src/game/future-actions';
import { GameService } from './service';
import { createApi } from './http';

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

test('queued manifest edits preserve launch identity, copy input, and persist receipts', async t => {
  const s = await setup(t); const { service, id, tokens } = s;
  const core = s.start.game.rocks.find(r => r.id === 'a')!.specialists![0]!;
  let current = await service.schedule(id, tokens[0]!, { requestId: randomUUID(), revision: s.start.revision, executeAt: 3, from: 'a', to: 'c', drones: 5 });
  const original = structuredClone(current.game.scheduled[0]!);
  const resources = current.game.rocks.map(r => ({ id: r.id, drones: r.drones, specialists: r.specialists }));
  const body = { requestId: randomUUID(), revision: current.revision, planId: original.id, drones: 9, specialists: [core.id] };
  const retry = structuredClone(body);
  const pending = service.editSchedule(id, tokens[0]!, body);
  body.drones = 999; body.specialists[0] = 'forged';
  current = await pending;
  assert.deepEqual(current.game.scheduled[0], { ...original, drones: 9, specialists: [core.id] });
  assert.deepEqual(current.game.rocks.map(r => ({ id: r.id, drones: r.drones, specialists: r.specialists })), resources);
  const reopened = await GameService.open(s.file, s.clock, createGame);
  assert.equal((await reopened.editSchedule(id, tokens[0]!, retry)).revision, current.revision);
  await assert.rejects(reopened.editSchedule(id, tokens[0]!, { ...retry, specialists: [] }), { code: 'command.conflict.reused_id' });
});

test('HTTP edit validates strict manifests and rejects missing, foreign, nonlaunch, and stale edits atomically', async t => {
  const s = await setup(t); const { service, id, tokens } = s;
  let current = await service.schedule(id, tokens[0]!, { requestId: randomUUID(), revision: s.start.revision, executeAt: 2, from: 'a', to: 'c', drones: 5 });
  const planId = current.game.scheduled[0]!.id;
  current = await service.schedule(id, tokens[0]!, { requestId: randomUUID(), revision: current.revision, executeAt: 2, action: { type: 'shields', rock: 'c', disabled: true } });
  const nonlaunch = current.game.scheduled[1]!.id;
  const server = createApi(service); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  async function send(body: unknown, token = tokens[0]!, method = 'POST') {
    const response = await fetch(`http://127.0.0.1:${address && typeof address !== 'string' ? address.port : 0}/v1/games/${id}/edit-schedule`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }
  current = await service.snapshot(id, tokens[0]!);
  const body = { requestId: randomUUID(), revision: current.revision, planId, drones: 7 };
  for (const extra of [{ owner: 'vesper' }, { fleetId: 3 }, { executeAt: 1 }, { from: 'f' }, { to: 'f' }, { route: [] }, { mission: 'gift' }, { specialists: ['x', 'x'] }, { specialists: null }, { drones: 1.5 }, { planId: null }]) {
    assert.equal((await send({ ...body, ...extra })).status, 400);
  }
  assert.equal((await send(body, tokens[3]!)).status, 401);
  assert.equal((await send(body, tokens[0]!, 'GET')).status, 405);
  const rival = await service.snapshot(id, tokens[1]!);
  const rivalUnit = rival.game.rocks.flatMap(r => r.specialists ?? []).find(u => u.owner === 'vesper')!;
  assert.equal((await send({ ...body, specialists: [rivalUnit.id] })).status, 409);
  const foreign = await send({ ...body, revision: rival.revision }, tokens[1]!);
  const missing = await send({ ...body, planId: randomUUID() });
  const wrongKind = await send({ ...body, planId: nonlaunch });
  for (const result of [foreign, missing, wrongKind]) {
    assert.equal(result.status, 409);
    assert.equal(result.body.issues[0].issue, 'schedule.conflict.missing');
    assert.equal(result.body.issues[0].message.detail, missing.body.issues[0].message.detail);
  }
  assert.equal((await send({ ...body, revision: current.revision - 1 })).status, 409);
  assert.equal((await send({ ...body, specialists: ['unknown'] })).status, 409);
  assert.deepEqual((await service.snapshot(id, tokens[0]!)).game, current.game);
  assert.equal((await send(body)).status, 200, 'failures do not consume receipts');
  assert.equal((await send({ ...body, specialists: [] })).status, 409, 'omitted and empty manifests have distinct receipts');
  current = await service.snapshot(id, tokens[0]!);
  s.hour(2); current = await service.snapshot(id, tokens[0]!);
  assert.equal((await send({ ...body, requestId: randomUUID(), revision: current.revision })).body.issues[0].issue, 'schedule.conflict.missing');
  assert.equal((await send(body)).status, 200, 'old retry cannot recreate executed launch');
});

test('edits preserve planned hire and fleet dependencies through restart and historical replay', async t => {
  const s = await setup(t, epoch => createConfiguredGame({ playerCount: 3, mode: 'mining' }, epoch ?? 0, 42)); const { service, id, tokens } = s;
  const from = s.start.game.rocks.find(r => r.owner === 'you' && r.specialists?.some(u => u.kind === 'queen'))!;
  const to = s.start.game.rocks.find(r => r.owner === 'you' && r.id !== from.id)!;
  let current = await service.schedule(id, tokens[0]!, { requestId: randomUUID(), revision: s.start.revision, executeAt: 4, action: { type: 'hire', kind: s.start.game.recruitment!.you!.offers[0]! } });
  const unit = current.game.scheduled.find(isActionPlan)!.hireUnits![0]!;
  const launchId = randomUUID();
  current = await service.schedule(id, tokens[0]!, { requestId: launchId, revision: current.revision, executeAt: 23, from: from!.id, to: to!.id, drones: 5 });
  const fleet = current.game.scheduled.find(p => p.id === launchId)!.fleetId!;
  current = await service.schedule(id, tokens[0]!, { requestId: randomUUID(), revision: current.revision, executeAt: 23.01, action: { type: 'hauler', change: { action: 'edit-launch', fleet, drones: 2 } } });
  s.hour(1); current = await service.snapshot(id, tokens[0]!);
  const before = structuredClone(current.game.scheduled);
  s.hour(2);
  const edit = { requestId: randomUUID(), revision: current.revision, planId: launchId, drones: 0, specialists: [unit] };
  current = await service.editSchedule(id, tokens[0]!, edit);
  assert.equal(current.game.scheduled.find(p => p.id === launchId)!.fleetId, fleet);
  assert.deepEqual((await service.history(id, tokens[0]!, 1)).game.scheduled, before);
  assert.deepEqual((await service.history(id, tokens[0]!, 2)).game.scheduled, current.game.scheduled);
  const reopened = await GameService.open(s.file, s.clock, createGame);
  assert.equal((await reopened.editSchedule(id, tokens[0]!, edit)).revision, current.revision);
  s.hour(23.01); current = await reopened.snapshot(id, tokens[0]!);
  assert.ok(current.game.fleets.some(f => f.id === fleet && f.drones === 2 && f.specialists?.some(u => u.id === unit)), JSON.stringify(current.game.events));
  assert.deepEqual((await reopened.history(id, tokens[0]!, 23.01)).game.fleets, current.game.fleets);
});

test('transfer, gift, and intercept edits preserve omitted manifests and explicitly clear selections', async t => {
  const s = await setup(t, epoch => createConfiguredGame({ playerCount: 3, mode: 'mining' }, epoch ?? 0, 42));
  const { service, id, tokens } = s;
  const [from, to] = s.start.game.rocks.filter(r => r.owner === 'you');
  const rival = await service.snapshot(id, tokens[1]!);
  const enemyFrom = rival.game.rocks.find(r => r.owner === 'vesper')!;
  await service.order(id, tokens[1]!, { requestId: randomUUID(), revision: rival.revision, from: enemyFrom.id, to: from!.id, drones: 1 });
  s.hour(0.2); let current = await service.snapshot(id, tokens[0]!);
  // A queued hire remains a valid manifest dependency before it exists at a site.
  current = await service.schedule(id, tokens[0]!, { requestId: randomUUID(), revision: current.revision, executeAt: 1, action: { type: 'hire', kind: current.game.recruitment!.you!.offers[0]! } });
  const unit = current.game.scheduled.find(isActionPlan)!.hireUnits![0]!;
  const target = current.game.fleets.find(f => f.owner === 'vesper')?.id;
  assert.ok(target, 'enemy launch is visible for interception');
  const plans = [
    { from: from!.id, to: to!.id, drones: 1 },
    { action: { type: 'gift' as const, from: from!.id, to: to!.id, drones: 1, recipient: 'vesper' as const } },
    { action: { type: 'intercept' as const, from: from!.id, target, drones: 1 } },
  ];
  for (const plan of plans) {
    const planId = randomUUID();
    current = await service.schedule(id, tokens[0]!, { requestId: planId, revision: current.revision, executeAt: 4, ...plan });
    current = await service.editSchedule(id, tokens[0]!, { requestId: randomUUID(), revision: current.revision, planId, drones: 0, specialists: [unit] });
    const selected = structuredClone(current.game.scheduled.find(p => p.id === planId)!);
    current = await service.editSchedule(id, tokens[0]!, { requestId: randomUUID(), revision: current.revision, planId, drones: 2 });
    const preserved = current.game.scheduled.find(p => p.id === planId)!;
    assert.deepEqual(isActionPlan(preserved) ? preserved.action : preserved, isActionPlan(selected) ? { ...selected.action, drones: 2 } : { ...selected, drones: 2 });
    current = await service.editSchedule(id, tokens[0]!, { requestId: randomUUID(), revision: current.revision, planId, drones: 1, specialists: [] });
    const cleared = current.game.scheduled.find(p => p.id === planId)!;
    const manifest = isActionPlan(cleared) && 'specialists' in cleared.action ? cleared.action.specialists : !isActionPlan(cleared) ? cleared.specialists : undefined;
    assert.equal(manifest?.length ?? 0, 0);
  }
});

test('an edited manifest can retain a previously selected recruit after its hire dependency is canceled', async t => {
  const s = await setup(t);
  let current = await s.service.schedule(s.id, s.tokens[0]!, { requestId: randomUUID(), revision: s.start.revision, executeAt: 4, action: { type: 'hire', kind: s.start.game.recruitment!.you!.offers[0]! } });
  const hire = current.game.scheduled.find(isActionPlan)!;
  const unit = hire.hireUnits![0]!;
  const launchId = randomUUID();
  current = await s.service.schedule(s.id, s.tokens[0]!, { requestId: launchId, revision: current.revision, executeAt: 5, from: 'a', to: 'b', drones: 1, specialists: [unit] });
  current = await s.service.cancelSchedule(s.id, s.tokens[0]!, { requestId: randomUUID(), revision: current.revision, planId: hire.id });
  current = await s.service.editSchedule(s.id, s.tokens[0]!, { requestId: randomUUID(), revision: current.revision, planId: launchId, drones: 2, specialists: [unit] });
  assert.deepEqual((current.game.scheduled[0]! as { specialists: string[] }).specialists, [unit]);
  const untouched = structuredClone(current.game.scheduled);
  await assert.rejects(s.service.editSchedule(s.id, s.tokens[0]!, { requestId: randomUUID(), revision: current.revision, planId: launchId, drones: 3, specialists: [unit, '123456789'] }), { code: 'schedule.conflict.invalid' });
  assert.deepEqual((await s.service.snapshot(s.id, s.tokens[0]!)).game.scheduled, untouched);
  s.hour(5);
  assert.equal((await s.service.snapshot(s.id, s.tokens[0]!)).game.fleets.length, 0);
});
