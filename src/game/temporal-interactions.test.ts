import { test } from 'node:test';
import assert from 'node:assert/strict';
import { temporalWorld } from './temporal-test-world';
import { advance, dispatch } from './simulation';
import { activateTemporal } from './temporal-facilities';
import { createPulseSystem, commandPulse, DEFAULT_PULSE_CONFIG } from './pulse';
import { commandTacticalPulse, DEFAULT_TACTICAL_PULSE_CONFIG } from './tactical-pulse';
import { decodeSave } from './save-format';
import { commandHauler } from './transport';
import { fleetPosition } from './flight';
import { actStrategicPlayer } from './rival-ai';

test('Anchor pauses King and Disruptor charging without refunding or producing an early wave', () => {
  let game = temporalWorld();
  Object.assign(game.rules!, { mode: 'pulse', victoryTarget: 1, pulse: { ...DEFAULT_PULSE_CONFIG }, tacticalPulse: { ...DEFAULT_TACTICAL_PULSE_CONFIG } });
  game.pulse = createPulseSystem(game);
  game.cargo.you = 200;
  game.rocks[0]!.specialists!.push({ id: 'pulse-anchor', kind: 'anchor', owner: 'you' }, { id: 'pulse-disruptor', kind: 'disruptor', owner: 'you' });
  game = commandPulse(game, 'you', { id: 'temporal-king-charge-0001', action: 'START_CHARGE' });
  game = commandTacticalPulse(game, 'you', { id: 'temporal-disruptor-0001', action: 'CHARGE_DISRUPTOR', specialistId: 'pulse-disruptor', resourceCost: 10 });
  game = activateTemporal(game, 'you', 'pulse-anchor');
  assert.equal(game.cargo.you, 90);
  assert.throws(() => commandPulse(game, 'you', { id: 'temporal-king-fire-0001', action: 'FIRE_PULSE' }), /stasis/);
  const frozen = advance(game, 25, { rivals: false });
  assert.equal(frozen.pulse!.kings.find(k => k.factionId === 'you')!.chargeProgress, 0);
  assert.equal(frozen.pulse!.tactical!.waves.length, 0);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: frozen })).game, frozen);
  const fired = advance(frozen, 26.5, { rivals: false });
  assert.equal(fired.pulse!.tactical!.waves[0]!.firedAt, 26.5);
  assert.equal(fired.pulse!.kings.find(k => k.factionId === 'you')!.chargeProgress, 0.5);
  assert.equal(advance(fired, 32, { rivals: false }).pulse!.kings.find(k => k.factionId === 'you')!.state, 'ready');
});

test('a Navigator cannot escape an Anchor hold and its pending reroute is canceled', () => {
  let game = temporalWorld();
  game.rocks[0]!.specialists!.push({ id: 'held-navigator', kind: 'navigator', owner: 'you' });
  Object.assign(game.rocks[1]!, { x: 8, y: 0 });
  game.rocks[1]!.specialists!.push({ id: 'holding-anchor', kind: 'anchor', owner: 'you' });
  game = dispatch(game, game.rocks[0]!.id, game.rocks[1]!.id, 0, 'you', false, ['held-navigator']);
  game = activateTemporal(game, 'you', 'holding-anchor');
  const traveling = advance(game, 25.1, { rivals: false });
  const rerouting = commandHauler(traveling, 'you', { action: 'course', fleet: traveling.fleets[0]!.id, to: traveling.rocks[2]!.id });
  const held = advance(rerouting, 25.5, { rivals: false });
  assert.ok(held.fleets[0]!.heldAt);
  assert.equal(held.fleets[0]!.pendingCourse, undefined);
  assert.throws(() => commandHauler(held, 'you', { action: 'course', fleet: held.fleets[0]!.id, to: held.rocks[2]!.id }), /stasis/);
  assert.equal(advance(held, 26, { rivals: false }).fleets.length, 0);
});

test('overlapping Dilation fields keep one half-speed multiplier across a torus seam', () => {
  let game = temporalWorld();
  game.rules!.map = { generator: 'balanced.v2', topology: 'torus', seed: 19, width: 100, height: 100 };
  for (const site of game.rocks) { site.x %= 100; site.y %= 100; }
  Object.assign(game.rocks[0]!, { x: 95, y: 0 });
  Object.assign(game.rocks[1]!, { x: 35, y: 0 });
  Object.assign(game.rocks[2]!, { x: 0, y: 0 });
  game.rocks[2]!.specialists!.push({ id: 'wrapped-dilation-one', kind: 'dilation', owner: 'you' }, { id: 'wrapped-dilation-two', kind: 'dilation', owner: 'you' });
  game = dispatch(game, game.rocks[0]!.id, game.rocks[1]!.id, 1, 'you');
  const slowed = advance(game, 30, { rivals: false });
  assert.equal(slowed.fleets[0]!.speed, 4);
  assert.ok(fleetPosition(slowed, slowed.fleets[0]!).x < 32);
  assert.equal(advance(game, 38, { rivals: false }).fleets.length, 0);
});

test('a drifting Dilation field produces the same remaining travel across split advances', () => {
  let game = temporalWorld();
  game.rules!.driftingBases = true;
  game.rules!.map = { generator: 'balanced.v2', topology: 'torus', seed: 19, width: 500, height: 500 };
  Object.assign(game.rocks[2]!, { x: 50, y: 0, drift: { origin: { x: 38, y: 0 }, velocity: { x: 0.5, y: 0 } } });
  game.rocks[2]!.specialists!.push({ id: 'drifting-dilation', kind: 'dilation', owner: 'you' });
  game = dispatch(game, game.rocks[0]!.id, game.rocks[1]!.id, 1, 'you');
  const whole = advance(game, 32, { rivals: false });
  let polled = game;
  for (let hour = 24.137; hour < 32; hour += 0.137) polled = advance(polled, hour, { rivals: false });
  const split = advance(polled, 32, { rivals: false });
  assert.equal(whole.fleets[0]!.speed, 4);
  assert.ok(Math.abs(whole.fleets[0]!.arrives - split.fleets[0]!.arrives) < 1e-8);
  assert.ok(Math.abs(fleetPosition(whole, whole.fleets[0]!).x - fleetPosition(split, split.fleets[0]!).x) < 1e-8);
});

test('a rival with three temporal offers still recruits instead of keeping an unusable deck forever', () => {
  const game = temporalWorld();
  game.recruitment!.vesper!.offers = ['hastener', 'dilation', 'overclock'];
  for (const policy of [1, 2] as const) {
    const recruited = actStrategicPlayer(game, 'vesper', policy);
    assert.ok([...recruited.rocks, ...recruited.fleets].some(a => a.specialists?.some(u => u.owner === 'vesper' && u.kind === 'hastener')));
    assert.equal(recruited.recruitment!.vesper!.used, 1);
  }
});

test('a held hauler returns from a destroyed drifting site without jumping back to its old arrival point', () => {
  let game = temporalWorld();
  game.rules!.driftingBases = true;
  game.rules!.map = { generator: 'balanced.v2', topology: 'torus', seed: 19, width: 500, height: 500 };
  game.rocks[0]!.x = 16;
  Object.assign(game.rocks[1]!, { x: 20, y: 0, drift: { origin: { x: 8, y: 0 }, velocity: { x: 0.5, y: 0 } } });
  game.rocks[1]!.specialists!.push({ id: 'drifting-anchor', kind: 'anchor', owner: 'you' });
  game = dispatch(game, game.rocks[0]!.id, game.rocks[1]!.id, 1, 'you');
  game = activateTemporal(game, 'you', 'drifting-anchor');
  const frozen = advance(game, 25.5, { rivals: false });
  assert.equal(frozen.fleets[0]!.heldAt, game.rocks[1]!.id);
  Object.assign(frozen.rocks[1]!, { destroyed: true, drones: 0, shield: 0, specialists: [] });
  const thawed = advance(frozen, 26, { rivals: false });
  assert.equal(thawed.fleets[0]!.returning, true);
  assert.ok(Math.abs(fleetPosition(thawed, thawed.fleets[0]!).x - 21) < 1e-8);
});

test('a remote Envoy waits for Anchor stasis to lift before extracting a captive', () => {
  let game = temporalWorld();
  Object.assign(game.rocks[1]!, { x: 8, y: 0 });
  Object.assign(game.rocks[10]!, { x: 8, y: 8 });
  game.rocks[1]!.specialists!.push({ id: 'prison-anchor', kind: 'anchor', owner: 'you' }, { id: 'frozen-captive', kind: 'foreman', owner: 'vesper', captive: true });
  game.rocks[10]!.specialists!.push({ id: 'remote-envoy', kind: 'diplomat', owner: 'vesper' });
  game = activateTemporal(game, 'you', 'prison-anchor');
  const frozen = advance(game, 25.5, { rivals: false });
  assert.ok(frozen.rocks[1]!.specialists!.some(u => u.id === 'frozen-captive' && u.captive));
  const thawed = advance(frozen, 26, { rivals: false });
  assert.equal(thawed.rocks[1]!.specialists!.some(u => u.id === 'frozen-captive'), false);
  assert.ok(thawed.fleets.some(f => f.specialists?.some(u => u.id === 'frozen-captive' && !u.captive)));
});
