import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPreCargoGame as createConfiguredGame } from './test-world';
import { advance, dispatch, type Game } from './simulation';
import { commandPulse } from './pulse';

function arena(): Game {
  const game = createConfiguredGame({ playerCount: 2, mode: 'pulse' }, 0, 42);
  game.cargo.you = 150;
  const source = game.rocks.find(r => r.coreOf === 'you')!;
  source.specialists!.push({ id: 'disruptor-you', owner: 'you', kind: 'disruptor' });
  return game;
}
const charge = (game: Game, id = 'disruptor-command-0001', resourceCost = 20) => commandPulse(game, 'you', { id, action: 'CHARGE_DISRUPTOR', specialistId: 'disruptor-you', resourceCost });

test('Disruptor commits shared material once and automatically launches after half a game hour', () => {
  const original = arena(), charging = charge(original);
  assert.equal(charging.cargo.you, 130);
  assert.equal(original.cargo.you, 150);
  assert.equal(charge(charging), charging);
  assert.throws(() => charge(charging, 'disruptor-command-0001', 25), /different content/);
  assert.equal(advance(charging, .499, { rivals: false }).pulse!.tactical!.waves.length, 0);
  const fired = advance(charging, .5, { rivals: false });
  assert.equal(fired.pulse!.tactical!.charges.length, 0);
  assert.equal(fired.pulse!.tactical!.waves[0]!.firedAt, .5);
  assert.equal(fired.pulse!.tactical!.waves[0]!.radius, 0);
});

function positioned(): Game {
  const game = arena();
  // Keep the configured torus valid while placing all other assets away from the wave.
  for (const rock of game.rocks) { rock.x = 70; rock.y = 70; }
  const source = game.rocks.find(r => r.coreOf === 'you')!, enemy = game.rocks.find(r => r.coreOf === 'vesper')!;
  source.x = 10; source.y = 10; enemy.x = 26; enemy.y = 10;
  return game;
}
test('a finite pulse interrupts at exact arrival, grants resistance, and survives source movement', () => {
  let game = positioned(); game.cargo.vesper = 150;
  game = commandPulse(game, 'vesper', { id: 'enemy-charge-000001', action: 'START_CHARGE' });
  game = advance(charge(game), .5, { rivals: false });
  const source = game.rocks.find(r => r.coreOf === 'you')!, target = game.rocks.find(r => r.owner === 'you' && r !== source)!;
  game = dispatch(game, source.id, target.id, 0, 'you', false, ['disruptor-you']);
  assert.equal(game.pulse!.tactical!.waves.length, 1);
  assert.equal(advance(game, 2.499, { rivals: false }).pulse!.kings[1]!.state, 'charging');
  const hit = advance(game, 2.5, { rivals: false });
  assert.equal(hit.pulse!.kings[1]!.state, 'idle');
  assert.equal(hit.pulse!.tactical!.resistance['core-vesper'], 8.5);
  assert.equal(hit.eliminated.length, 0);
  assert.equal(hit.winner, null);
  const enemy = hit.rocks.find(r => r.coreOf === 'vesper')!;
  assert.equal(hit.pulse!.shields[enemy.id]!.energy, 75);
});
test('moving a charging Disruptor cancels without refund; launched pulses fade out', () => {
  let game = charge(positioned());
  const source = game.rocks.find(r => r.coreOf === 'you')!, target = game.rocks.find(r => r.owner === 'you' && r !== source)!;
  game = dispatch(game, source.id, target.id, 0, 'you', false, ['disruptor-you']);
  assert.equal(game.pulse!.tactical!.charges.length, 0);
  assert.equal(game.cargo.you, 130);
  assert.equal(advance(game, 1, { rivals: false }).pulse!.tactical!.waves.length, 0);
  const end = advance(charge(positioned()), 20, { rivals: false });
  assert.equal(end.pulse!.tactical!.waves.length, 0);
});

test('tactical charges and waves round-trip through saves and private replay', async () => {
  const { decodeSave } = await import('./save-format');
  const { applyCommand, createArchive, exportArchive } = await import('./replay');
  const { decodeReplay } = await import('./replay-save');
  const { generateSharedReplay } = await import('../replay/generate');
  const { encodeSharedReplay, decodeSharedReplay } = await import('../replay/codec');
  const base = arena();
  const result = applyCommand(createArchive(base), { type: 'pulse', owner: 'you', command: { id: 'saved-disruptor-0001', action: 'CHARGE_DISRUPTOR', specialistId: 'disruptor-you', resourceCost: 20 } }, { rivals: false, knownThrough: 0 });
  for (const hour of [0, .5, 2]) {
    const live = advance(result.game, hour, { rivals: false });
    assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: live })).game, JSON.parse(JSON.stringify(live)));
    assert.doesNotThrow(() => decodeReplay(exportArchive(result.archive), live, false));
    assert.doesNotThrow(() => decodeSharedReplay(encodeSharedReplay(generateSharedReplay({ game: live, archive: result.archive }, 'you', 0, hour))));
  }
});

test('attenuation produces a weak jam at 50 units without resetting a King', async () => {
  const { rockSensorRange } = await import('./sensors');
  const { tacticalStrength, tacticalConfig } = await import('./tactical-pulse');
  let game = positioned(); game.rules!.map.width = 300; game.rules!.map.height = 300;
  game.rocks.find(r => r.coreOf === 'vesper')!.x = 60;
  game.cargo.vesper = 150;
  game = commandPulse(game, 'vesper', { id: 'weak-enemy-charge-001', action: 'START_CHARGE' });
  game = advance(charge(game), 6.75, { rivals: false });
  assert.equal(game.pulse!.kings[1]!.state, 'ready');
  assert.equal(tacticalStrength(game.pulse!.tactical!.waves[0]!, tacticalConfig(game)), 55);
  const enemy = game.rocks.find(r => r.coreOf === 'vesper')!;
  assert.equal(rockSensorRange(game, enemy), 16);
  assert.equal(game.pulse!.shields[enemy.id]!.energy, 100);
  assert.equal(rockSensorRange(advance(game, 7.75, { rivals: false }), enemy), 32);
});
test('resistance protects a restarted six-hour charge from repeat hits', () => {
  let game = positioned(); game.cargo.you = 300; game.cargo.vesper = 300;
  game = commandPulse(game, 'vesper', { id: 'resist-first-charge-01', action: 'START_CHARGE' });
  game = advance(charge(game), 2.5, { rivals: false });
  game = commandPulse(game, 'vesper', { id: 'resist-next-charge-001', action: 'START_CHARGE' });
  game = advance(charge(game, 'resist-tactical-00001'), 5, { rivals: false });
  assert.equal(game.pulse!.kings[1]!.state, 'charging');
  assert.equal(game.pulse!.tactical!.resistance['core-vesper'], 8.5);
  assert.equal(advance(game, 8.5, { rivals: false }).pulse!.kings[1]!.state, 'ready');
});
test('a firing King slows temporarily without terminating its strategic wave', () => {
  let game = positioned(); game.cargo.vesper = 100;
  game = commandPulse(game, 'vesper', { id: 'firing-enemy-charge-01', action: 'START_CHARGE' });
  game = advance(game, 6, { rivals: false });
  game = commandPulse(game, 'vesper', { id: 'firing-enemy-pulse-001', action: 'FIRE_PULSE' });
  game = advance(charge(game), 8.5, { rivals: false });
  const radius = game.pulse!.pulses[0]!.radius;
  const slowed = advance(game, 9.5, { rivals: false });
  assert.equal(slowed.pulse!.kings[1]!.state, 'firing');
  assert.equal(slowed.pulse!.pulses[0]!.radius - radius, 4);
  const normal = advance(slowed, 10.5, { rivals: false });
  assert.equal(normal.pulse!.pulses[0]!.radius - slowed.pulse!.pulses[0]!.radius, 8);
});
test('a tactical wave freezes a moving hauler and resumes it after an hour, independently of polling', async () => {
  const { fleetPosition } = await import('./flight');
  const { decodeSave } = await import('./save-format');
  let game = positioned();
  game = advance(game, 12, { rivals: false });
  const enemy = game.rocks.find(r => r.coreOf === 'vesper')!, target = game.rocks.find(r => r.owner === 'vesper' && r !== enemy)!;
  enemy.x = 34; target.x = 18; target.y = 10;
  enemy.drones = 10;
  game = dispatch(game, enemy.id, target.id, 1, 'vesper');
  game = charge(game);
  const hitHour = (12.5 + 12 + 1 / 6 + 3) / 2;
  const hit = advance(game, hitHour, { rivals: false });
  assert.ok(hit.fleets[0]!.enginesDisabledUntil);
  const point = fleetPosition(hit, hit.fleets[0]!);
  const { observe, forecastObservation } = await import('./visibility');
  const future = forecastObservation(observe(hit, 'vesper', id => id + 100), 'vesper', hitHour + .2);
  assert.ok(future.pulse!.tactical!.waves[0]!.hitFleets.includes(future.fleets[0]!.id), 'forecasts preserve opaque hit identities');
  const paused = advance(hit, hitHour + .7, { rivals: false });
  assert.deepEqual(fleetPosition(paused, paused.fleets[0]!), point);
  assert.doesNotThrow(() => decodeSave(JSON.stringify({ game: paused, savedAt: 0 })));
  const { createArchive } = await import('./replay');
  const { generateSharedReplay } = await import('../replay/generate');
  const { encodeSharedReplay, decodeSharedReplay } = await import('../replay/codec');
  assert.doesNotThrow(() => decodeSharedReplay(encodeSharedReplay(generateSharedReplay({ game: paused, archive: createArchive(hit, { rivals: false }) }, 'vesper', hitHour, paused.hour))));
  const endHour = hitHour + 1.1;
  const whole = advance(game, endHour, { rivals: false });
  const stepped = advance(paused, endHour, { rivals: false });
  assert.deepEqual(whole.pulse!.tactical!.waves[0]!.hitFleets, stepped.pulse!.tactical!.waves[0]!.hitFleets);
  assert.ok(Math.abs(fleetPosition(whole, whole.fleets[0]!).x - fleetPosition(stepped, stepped.fleets[0]!).x) < 1e-9);
  assert.ok(fleetPosition(whole, whole.fleets[0]!).x < point.x);
});
test('strong hits pause extraction without catch-up production or asset destruction', async () => {
  const { decodeSave } = await import('./save-format');
  let game = positioned();
  const enemy = game.rocks.find(r => r.coreOf === 'vesper')!;
  enemy.kind = 'mine'; enemy.miningInterval = 24 / 5; enemy.miningAt = 2.75;
  game = advance(charge(game), 2.5, { rivals: false });
  assert.equal(game.rocks.find(r => r.id === enemy.id)!.miningDisabledUntil, 3.5);
  assert.doesNotThrow(() => decodeSave(JSON.stringify({ game, savedAt: 0 })));
  assert.equal(advance(game, 3.74, { rivals: false }).cargo.vesper, 0);
  assert.equal(advance(game, 3.75, { rivals: false }).cargo.vesper, 1);
  assert.equal(game.rocks.find(r => r.id === enemy.id)!.destroyed, undefined);
});

test('ownership, captivity, costs, and material availability are validated before charging', () => {
  const game = arena();
  for (const cost of [9, 26, 20.5, NaN]) assert.throws(() => charge(game, 'invalid-cost-000001', cost), /Pulse Material|unique/);
  game.cargo.you = 19;
  assert.throws(() => charge(game), /Pulse Material/);
  game.cargo.you = 20;
  game.rocks.find(r => r.coreOf === 'you')!.specialists!.find(u => u.kind === 'disruptor')!.captive = true;
  assert.throws(() => charge(game), /stationed Disruptor/);
});
test('launched waves survive emitter loss, hit each target once, and spare friendly assets', () => {
  let game = advance(charge(positioned()), .5, { rivals: false });
  game.rocks.find(r => r.coreOf === 'you')!.specialists = game.rocks.find(r => r.coreOf === 'you')!.specialists!.filter(u => u.kind !== 'disruptor');
  game = advance(game, 2.5, { rivals: false });
  const enemy = game.rocks.find(r => r.coreOf === 'vesper')!, friendly = game.rocks.find(r => r.coreOf === 'you')!;
  assert.equal(game.pulse!.shields[enemy.id]!.energy, 75);
  assert.equal(game.pulse!.shields[friendly.id]!.energy, 100);
  const later = advance(game, 2.75, { rivals: false });
  assert.equal(later.pulse!.shields[enemy.id]!.energy, 76.25);
});
test('enemy charges, source identities, and hidden hit ledgers stay private', async () => {
  const { observe } = await import('./visibility');
  let game = positioned();
  const enemy = game.rocks.find(r => r.coreOf === 'vesper')!;
  enemy.specialists!.push({ id: 'secret-disruptor', kind: 'disruptor', owner: 'vesper' });
  game.cargo.vesper = 100;
  game = commandPulse(game, 'vesper', { id: 'secret-tactical-charge-01', action: 'CHARGE_DISRUPTOR', specialistId: 'secret-disruptor', resourceCost: 25 });
  const view = observe(game, 'you');
  assert.equal(view.pulse!.tactical!.charges.length, 0);
  assert.ok(!JSON.stringify(view.pulse).includes('secret'));
  game = advance(game, 1, { rivals: false });
  const fired = observe(game, 'you', id => id + 1000, id => `alias-${id}`);
  assert.equal(fired.pulse!.tactical!.waves.length, 1, 'launched pulses are public telemetry');
  assert.ok(!JSON.stringify(fired.pulse).includes('secret'));
  assert.equal(fired.pulse!.tactical!.waves[0]!.hitFleets.length, 0);
});
test('old pulse saves keep their recruitment deck and reject tactical state', async () => {
  const { newRecruitment } = await import('./specialists');
  const { decodeSave } = await import('./save-format');
  const game = createConfiguredGame({ playerCount: 2, mode: 'pulse' }, 0, 42);
  game.rules!.mechanicsVersion = 15;
  delete game.rules!.tacticalPulse; delete game.pulse!.tactical;
  game.recruitment = { you: newRecruitment(43), vesper: newRecruitment(44) };
  assert.doesNotThrow(() => decodeSave(JSON.stringify({ game, savedAt: 0 })));
  for (let seed = 0; seed < 1000; seed++) assert.ok(!newRecruitment(seed).offers.includes('disruptor'));
  assert.ok(Array.from({ length: 1000 }, (_, seed) => newRecruitment(Math.imul(seed, 987654319) >>> 0, true)).some(r => r.offers.includes('disruptor')));
  game.pulse!.tactical = { charges: [], waves: [], resistance: {} };
  assert.throws(() => decodeSave(JSON.stringify({ game, savedAt: 0 })), /damaged/);
});

test('tactical saves reject corrupt wave geometry, missing Kings, and impossible engine outages', async () => {
  const { decodeSave } = await import('./save-format');
  const live = advance(charge(positioned()), 1, { rivals: false });
  for (const corrupt of [
    (g: Game) => { g.pulse!.tactical!.waves[0]!.radius = 999; },
    (g: Game) => { g.pulse!.tactical!.waves[0]!.attenuationPerDistance = -1; },
    (g: Game) => { (g.pulse as any).kings = null; g.pulse!.tactical!.resistance['missing-king'] = 2; },
    (g: Game) => { (g.rocks[0] as any).enginesDisabledUntil = 2; },
  ]) {
    const damaged = JSON.parse(JSON.stringify(live)); corrupt(damaged);
    assert.throws(() => decodeSave(JSON.stringify({ game: damaged, savedAt: 0 })), /damaged/);
  }
});
test('engine outage at a route encounter preserves the contact and its outcome at the same instant', () => {
  let game = advance(charge(advance(positioned(), 12, { rivals: false })), 12 + 1 / 3, { rivals: false });
  const source = game.rocks.find(r => r.coreOf === 'you')!, enemy = game.rocks.find(r => r.coreOf === 'vesper')!;
  source.drones = 20; enemy.drones = 20;
  game = dispatch(game, source.id, enemy.id, 10, 'you');
  game = dispatch(game, enemy.id, source.id, 5, 'vesper');
  for (const start of [game, advance(game, 13.49, { rivals: false })]) {
    const contacted = advance(start, 13.5, { rivals: false });
    assert.equal(contacted.fleets.length, 1);
    assert.equal(contacted.fleets[0]!.owner, 'you');
    assert.equal(contacted.fleets[0]!.drones, 5);
  }
});
