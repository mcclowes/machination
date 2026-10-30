import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, dispatch } from './simulation';
import { fleetPosition } from './flight';
import { activateTemporal } from './temporal-facilities';
import { decodeSave } from './save-format';
import { scheduleTransfer } from './orders';
import { observe } from './visibility';
import { executeCommand } from './replay';
import { hireSpecialist, promoteSpecialist } from './specialists';
import { createConfiguredGame } from './world';
import { isTemporalKind } from './temporal';

import { temporalWorld } from './temporal-test-world';

test('Dilation slows both sides only within the field and crossing times do not depend on polling', () => {
  let game = temporalWorld();
  const field = game.rocks[2]!;
  Object.assign(field, { x: 50, y: 0 });
  field.specialists!.push({ id: 'dilation-test', kind: 'dilation', owner: 'you' });
  game = dispatch(game, game.rocks[0]!.id, game.rocks[1]!.id, 1, 'you');
  const atDeparture = advance(game, 24 + 1 / 6, { rivals: false });
  const beforeField = advance(atDeparture, 26, { rivals: false });
  assert.equal(beforeField.fleets[0]!.speed, 8);
  const inside = advance(beforeField, 30, { rivals: false });
  assert.equal(inside.fleets[0]!.speed, 4);
  assert.ok(Math.abs(fleetPosition(inside, inside.fleets[0]!).x - (18 + (30 - (24 + 1 / 6 + 18 / 8)) * 4)) < 1e-7);
  const end = advance(game, 45, { rivals: false });
  assert.equal(end.fleets.length, 0);
  let polled = game;
  for (let h = 24.137; h < 45; h += 0.137) polled = advance(polled, h, { rivals: false });
  assert.deepEqual(advance(polled, 45, { rivals: false }), end);
  const hostile = temporalWorld();
  Object.assign(hostile.rocks[2]!, { x: 50, y: 80 });
  hostile.rocks[2]!.specialists!.push({ id: 'hostile-dilation', kind: 'dilation', owner: 'you' });
  const slowed = advance(dispatch(hostile, hostile.rocks[10]!.id, hostile.rocks[0]!.id, 1, 'vesper'), 24.5, { rivals: false });
  assert.equal(slowed.fleets[0]!.speed, 4);
});

test('Anchor freezes local clocks and holds both sides until expiry without erasing incoming attacks', () => {
  let game = temporalWorld();
  const site = game.rocks[1]!;
  Object.assign(site, { x: 8, kind: 'factory', productionAt: 25, productionInterval: 8 });
  site.specialists!.push({ id: 'anchor-test', kind: 'anchor', owner: 'you' });
  game.rocks[10]!.x = 8; game.rocks[10]!.y = 8;
  game = dispatch(game, game.rocks[0]!.id, site.id, 2, 'you');
  game = dispatch(game, game.rocks[10]!.id, site.id, 1, 'vesper');
  game = activateTemporal(game, 'you', 'anchor-test');
  assert.throws(() => dispatch(game, site.id, game.rocks[0]!.id, 1, 'you'), /stasis/i);
  assert.throws(() => activateTemporal(game, 'you', 'anchor-test'), /stasis|cooldown/i);
  const frozen = advance(game, 25.5, { rivals: false });
  assert.equal(frozen.rocks[1]!.drones, 40);
  assert.equal(frozen.fleets.filter(f => f.heldAt === site.id).length, 2);
  const thawed = advance(frozen, 26, { rivals: false });
  assert.equal(thawed.fleets.length, 0);
  assert.equal(thawed.rocks[1]!.drones, 41);
  assert.equal(thawed.rocks[1]!.productionAt, 27);
  assert.equal(advance(thawed, 27, { rivals: false }).rocks[1]!.drones, 47);
  assert.deepEqual(advance(game, 27, { rivals: false }), advance(thawed, 27, { rivals: false }));
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: frozen })).game, frozen);
});

test('Overclock borrows production and retains repayment after its specialist leaves', () => {
  let game = temporalWorld();
  const factory = game.rocks[1]!;
  Object.assign(factory, { kind: 'factory', productionAt: 32, productionInterval: 8 });
  factory.specialists!.push({ id: 'overclock-test', kind: 'overclock', owner: 'you' });
  game = activateTemporal(game, 'you', 'overclock-test');
  assert.equal(game.rocks[1]!.productionAt, 28);
  game = dispatch(game, factory.id, game.rocks[0]!.id, 0, 'you', false, ['overclock-test']);
  const boosted = advance(game, 28, { rivals: false });
  assert.equal(boosted.rocks[1]!.drones, 46);
  assert.equal(boosted.rocks[1]!.overclock?.repaying, true);
  assert.equal(advance(boosted, 32, { rivals: false }).rocks[1]!.drones, 46);
  assert.equal(advance(boosted, 40, { rivals: false }).rocks[1]!.drones, 52);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: boosted })).game, boosted);
});

test('Hastener pulls executable outbound orders forward after combat and consumes early failures once', () => {
  let game = temporalWorld();
  game.rocks[0]!.specialists!.push({ id: 'hastener-test', kind: 'hastener', owner: 'you' });
  Object.assign(game.rocks[10]!, { x: 8, y: 0 });
  Object.assign(game.rocks[11]!, { owner: 'vesper', x: 50, y: 0 });
  const from = game.rocks[10]!.id, to = game.rocks[11]!.id;
  game = scheduleTransfer(game, { id: 'hastener-success-0001', owner: 'vesper', from, to, drones: 30, executeAt: 40 });
  game = scheduleTransfer(game, { id: 'hastener-failure-0001', owner: 'vesper', from, to, drones: 100, executeAt: 41 });
  game = dispatch(game, game.rocks[0]!.id, from, 0, 'you', false, ['hastener-test']);
  const triggered = advance(game, 25 + 1 / 6, { rivals: false });
  assert.equal(triggered.scheduled!.length, 0);
  assert.equal(triggered.rocks[10]!.drones, 10);
  assert.equal(triggered.fleets.filter(f => f.from === from && f.preparing).length, 1);
  assert.ok(triggered.events.some(e => e.audience?.includes('vesper') && /aborted/i.test(e.message)));
  assert.equal(advance(triggered, 26, { rivals: false }).fleets[0]!.preparing, undefined);
});

test('Hindsight reveals a nearby hidden launch after two hours and keeps occurrence and discovery separate', () => {
  let game = temporalWorld();
  game.rocks[0]!.specialists!.push({ id: 'hindsight-test', kind: 'hindsight', owner: 'you' });
  Object.assign(game.rocks[10]!, { x: 50, y: 0 });
  game = dispatch(game, game.rocks[10]!.id, game.rocks[11]!.id, 1, 'vesper');
  assert.equal(observe(game, 'you').events.some(e => /Hindsight/.test(e.message)), false);
  const before = advance(game, 25.9, { rivals: false });
  assert.equal(observe(before, 'you').events.some(e => /Hindsight/.test(e.message)), false);
  const after = advance(before, 26, { rivals: false });
  const discovery = observe(after, 'you').events.find(e => /Hindsight/.test(e.message))!;
  assert.ok(discovery);
  assert.equal(discovery.hour, 24);
  assert.equal(discovery.discoveredAt, 26);
  assert.equal(observe(after, 'vesper').events.some(e => /Hindsight/.test(e.message)), false);
  assert.equal(JSON.stringify(observe(before, 'you')).includes('pending'), false);
});

test('Foresight privately reveals a committed lethal transfer and withdraws the prediction after cancellation', () => {
  let game = temporalWorld();
  game.rocks[0]!.specialists!.push({ id: 'foresight-test', kind: 'foresight', owner: 'you' });
  game.rocks[1]!.x = 16;
  game.rocks[1]!.specialists!.push({ id: 'threatened-test', kind: 'foreman', owner: 'you' });
  Object.assign(game.rocks[10]!, { x: 50, y: 0 });
  game.rocks[10]!.specialists!.push({ id: 'hidden-assassin', kind: 'assassin', owner: 'vesper' });
  game = executeCommand(game, { type: 'schedule', owner: 'vesper', plan: {
    id: 'foresight-lethal-0001', from: game.rocks[10]!.id, to: game.rocks[1]!.id, drones: 1, specialists: ['hidden-assassin'], executeAt: 25,
  } });
  const view = observe(game, 'you', id => id + 1000, id => `alias-${id}`);
  assert.equal(view.foresight!.length, 1);
  assert.equal(view.foresight![0]!.specialistId, 'alias-threatened-test');
  assert.match(view.foresight![0]!.source, /queued enemy transfer/);
  assert.ok(Math.abs(view.foresight![0]!.deathAt - (25 + 1 / 6 + 34 / 8)) < 1e-8);
  assert.equal(view.scheduled.length, 0);
  assert.equal(JSON.stringify(view).includes('hidden-assassin'), false);
  assert.equal(observe(game, 'vesper').foresight, undefined);
  const canceled = executeCommand(game, { type: 'cancel-schedule', owner: 'vesper', id: 'foresight-lethal-0001' });
  assert.equal(observe(canceled, 'you').foresight, undefined);
});

test('multiple Anchors cannot chain permanent stasis at the same site', () => {
  let game = temporalWorld();
  game.rocks[1]!.specialists!.push({ id: 'anchor-first', kind: 'anchor', owner: 'you' }, { id: 'anchor-second', kind: 'anchor', owner: 'you' });
  game = activateTemporal(game, 'you', 'anchor-first');
  const thawed = advance(game, 26, { rivals: false });
  assert.throws(() => activateTemporal(thawed, 'you', 'anchor-second'), /site.*cooldown/i);
  assert.equal(activateTemporal(advance(thawed, 36, { rivals: false }), 'you', 'anchor-second').rocks[1]!.stasisUntil, 38);
});

test('Overclock debt remains with a captured site and pauses without catch-up', () => {
  let game = temporalWorld();
  Object.assign(game.rocks[1]!, { kind: 'factory', productionAt: 32, productionInterval: 8, drones: 0, x: 8 });
  Object.assign(game.rocks[10]!, { x: 8, y: 8 });
  game.rocks[1]!.specialists!.push({ id: 'captured-overclock', kind: 'overclock', owner: 'you' });
  game = activateTemporal(game, 'you', 'captured-overclock');
  game = dispatch(game, game.rocks[10]!.id, game.rocks[1]!.id, 10, 'vesper');
  const captured = advance(game, 28, { rivals: false });
  assert.equal(captured.rocks[1]!.owner, 'vesper');
  assert.equal(captured.rocks[1]!.overclock?.repaying, true);
  assert.equal(captured.rocks[1]!.drones, 16);
  assert.equal(advance(captured, 32, { rivals: false }).rocks[1]!.drones, 16);
});

test('Anchor preserves mining and shield progress rather than paying missed work at thaw', () => {
  let game = temporalWorld();
  Object.assign(game.rocks[1]!, { kind: 'mine', miningAt: 25, miningInterval: 8, shieldAt: 25 });
  game.rocks[1]!.specialists!.push({ id: 'mining-anchor', kind: 'anchor', owner: 'you' });
  game = activateTemporal(game, 'you', 'mining-anchor');
  const thawed = advance(game, 26, { rivals: false });
  assert.equal(thawed.cargo.you, 5);
  assert.equal(thawed.rocks[1]!.shield, 0);
  const resumed = advance(thawed, 27, { rivals: false });
  assert.equal(resumed.cargo.you, 6);
  assert.equal(resumed.rocks[1]!.shield, 1);
});

test('revision 18 recruits temporal units and promotes Dilation while older decks stay unchanged', () => {
  const old = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 19, undefined, 17);
  assert.equal(Object.keys(old.recruitment!.you!.pool).some(isTemporalKind), false);
  let game = temporalWorld();
  game.recruitment!.you!.offers = ['hastener', 'dilation', 'overclock'];
  game = hireSpecialist(game, 'you', 'dilation');
  const hired = game.rocks[0]!.specialists!.find(u => u.kind === 'dilation')!;
  const promoted = promoteSpecialist(game, 'you', hired.id);
  assert.equal(promoted.rocks[0]!.specialists!.find(u => u.id === hired.id)!.kind, 'anchor');
  assert.equal(game.rocks[0]!.specialists!.find(u => u.id === hired.id)!.kind, 'dilation');
  old.hour = 24; old.recruitment!.you!.offers[1] = 'dilation';
  assert.throws(() => hireSpecialist(old, 'you', 'dilation'), /new operation/);
});

test('Foresight warning discovery is independent of observation polling cadence', () => {
  let game = temporalWorld();
  game.rocks[0]!.specialists!.push({ id: 'cadence-foresight', kind: 'foresight', owner: 'you' });
  game.rocks[1]!.x = 16;
  game.rocks[1]!.specialists!.push({ id: 'cadence-victim', kind: 'foreman', owner: 'you' });
  Object.assign(game.rocks[10]!, { x: 50, y: 0 });
  game.rocks[10]!.specialists!.push({ id: 'cadence-assassin', kind: 'assassin', owner: 'vesper' });
  game = executeCommand(game, { type: 'schedule', owner: 'vesper', plan: {
    id: 'foresight-cadence-0001', from: game.rocks[10]!.id, to: game.rocks[1]!.id, drones: 1, specialists: ['cadence-assassin'], executeAt: 49,
  } });
  const whole = advance(game, 32, { rivals: false });
  let polled = game;
  for (let hour = 24.137; hour < 32; hour += 0.137) polled = advance(polled, hour, { rivals: false });
  const split = advance(polled, 32, { rivals: false });
  assert.deepEqual(split.temporalIntel, whole.temporalIntel);
  assert.deepEqual(split.events, whole.events);
});

test('temporal save validation rejects malformed debt, cooldowns, and held arrivals', () => {
  const game = temporalWorld();
  game.rocks[1]!.specialists!.push({ id: 'save-anchor', kind: 'anchor', owner: 'you' });
  const frozen = activateTemporal(game, 'you', 'save-anchor');
  for (const mutate of [
    (g: any) => { g.rocks[1].stasisUntil = 'tomorrow'; },
    (g: any) => { g.rocks[1].overclock = { boostUntil: 30, debtUntil: 29 }; },
    (g: any) => { g.rocks[1].specialists[0].temporalReadyAt = -1; },
    (g: any) => { g.temporalIntel = { pending: [{ owner: 'you', occurredAt: 24, discoverAt: 99, message: 'leak' }], warnings: [] }; },
  ]) {
    const damaged = JSON.parse(JSON.stringify(frozen)); mutate(damaged);
    assert.throws(() => decodeSave(JSON.stringify({ savedAt: 0, game: damaged })), /damaged/);
  }
});

test('simultaneous Foresight warnings identify only the transfer responsible for each death', () => {
  let game = temporalWorld();
  game.rocks[0]!.specialists!.push({ id: 'simultaneous-foresight', kind: 'foresight', owner: 'you' });
  Object.assign(game.rocks[1]!, { x: 16, y: 0 });
  Object.assign(game.rocks[2]!, { x: 26, y: 0 });
  Object.assign(game.rocks[10]!, { x: 50, y: 0 });
  Object.assign(game.rocks[11]!, { x: 60, y: 0, owner: 'vesper', drones: 40 });
  for (const [source, target] of [[10, 1], [11, 2]] as const) {
    game.rocks[source]!.specialists!.push({ id: `assassin-${source}`, kind: 'assassin', owner: 'vesper' });
    game.rocks[target]!.specialists!.push({ id: `victim-${target}`, kind: 'foreman', owner: 'you' });
    game = executeCommand(game, { type: 'schedule', owner: 'vesper', plan: {
      id: `simultaneous-lethal-${source}`, from: game.rocks[source]!.id, to: game.rocks[target]!.id,
      executeAt: 25, drones: 1, specialists: [`assassin-${source}`],
    } });
  }
  const warnings = observe(game, 'you').foresight!;
  assert.equal(warnings.length, 2);
  assert.ok(warnings.find(w => w.specialistId === 'victim-1')!.source.includes(`from ${game.rocks[10]!.name} to `));
  assert.ok(warnings.find(w => w.specialistId === 'victim-2')!.source.includes(`from ${game.rocks[11]!.name} to `));
});
