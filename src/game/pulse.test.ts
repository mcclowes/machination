import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfiguredGame } from './world';
import { advance, dispatch } from './simulation';
import { applyPulseSpecialistEffect as applyEffect, commandPulse, type PulseSpecialistEffect } from './pulse';
import { decodeSave } from './save-format';
import { observe, forecastObservation } from './visibility';
import { applyCommand, createArchive, executeCommand, exportArchive } from './replay';
import { decodeReplay } from './replay-save';
import { generateSharedReplay } from '../replay/generate';
import { encodeSharedReplay, decodeSharedReplay } from '../replay/codec';
import { scheduleTransfer } from './orders';
import { setFunding } from './funding';

let effectSequence = 0;
const applyPulseSpecialistEffect = (game: import('./simulation').Game, owner: import('./players').Faction, effect: PulseSpecialistEffect) => applyEffect(game, owner, effect, `specialist-effect-${++effectSequence}`);
function operation() {
  const game = createConfiguredGame({ playerCount: 2, mode: 'pulse' }, 0, 42);
  game.cargo.you = 150;
  return game;
}
test('P01/P04: commit material once, charge for six real hours, and wait for manual firing', () => {
  const input = operation();
  const command = { id: 'charge-command-0001', action: 'START_CHARGE' as const };
  const charging = commandPulse(input, 'you', command);
  assert.equal(charging.cargo.you, 50);
  assert.equal(commandPulse(charging, 'you', command).cargo.you, 50);
  assert.equal(input.cargo.you, 150);
  assert.equal(advance(charging, 5.99, { rivals: false }).pulse!.kings[0]!.state, 'charging');
  const ready = advance(charging, 6, { rivals: false });
  assert.equal(ready.pulse!.kings[0]!.state, 'ready');
  assert.equal(ready.pulse!.pulses.length, 0);
});
test('P02/P03: reject insufficient material and cancel charging when a movement order executes', () => {
  const input = operation(); input.cargo.you = 99;
  assert.throws(() => commandPulse(input, 'you', { id: 'charge-command-0002', action: 'START_CHARGE' }), /Pulse Material/);
  input.cargo.you = 100;
  const charging = advance(commandPulse(input, 'you', { id: 'charge-command-0003', action: 'START_CHARGE' }), 5, { rivals: false });
  const source = charging.rocks.find(r => r.coreOf === 'you')!;
  const to = charging.rocks.find(r => r.owner === 'you' && r !== source)!;
  const moved = dispatch(charging, source.id, to.id, 0, 'you', false, ['core-you']);
  assert.equal(moved.pulse!.kings[0]!.state, 'moving');
  assert.equal(moved.pulse!.kings[0]!.chargeProgress, 0);
  assert.equal(moved.cargo.you, 0);
  assert.equal(charging.pulse!.kings[0]!.state, 'charging');
  assert.throws(() => commandPulse(moved, 'you', { id: 'charge-command-0004', action: 'START_CHARGE' }), /stationed/);
});
function firing() {
  const game = operation();
  const yours = game.rocks.find(r => r.coreOf === 'you')!;
  const enemy = game.rocks.find(r => r.coreOf === 'vesper')!;
  yours.x = 10; yours.y = 10; enemy.x = 26; enemy.y = 10;
  // Use a planar arena to make arrival times explicit.
  delete game.rules!.map.topology;
  for (const r of game.rocks) if (r !== yours && r !== enemy) { r.x = 80; r.y = 80; }
  enemy.shieldsDisabled = true;
  return commandPulse(advance(commandPulse(game, 'you', { id: 'charge-command-0010', action: 'START_CHARGE' }), 6, { rivals: false }), 'you', { id: 'fire-command-000001', action: 'FIRE_PULSE' });
}
test('P05: pulse arrival eliminates a King at the exact event time and ends its pulse', () => {
  const game = firing();
  const justBefore = advance(game, 7.999, { rivals: false });
  assert.equal(justBefore.winner, null);
  const end = advance(game, 20, { rivals: false });
  assert.equal(end.winner, 'you');
  assert.ok(Math.abs(end.hour - 8) < 1e-9);
  assert.equal(end.pulse!.kings.find(k => k.factionId === 'vesper')!.state, 'destroyed');
});
test('a full planetary shield absorbs five hours of exposure without stopping propagation', () => {
  const game = firing(), enemy = game.rocks.find(r => r.coreOf === 'vesper')!;
  enemy.shieldsDisabled = false;
  const exposed = advance(game, 10, { rivals: false });
  assert.ok(Math.abs(exposed.pulse!.shields[enemy.id]!.energy - 60) < 1e-8);
  assert.equal(exposed.pulse!.shields[enemy.id]!.exposed, 1);
  assert.equal(exposed.winner, null);
  const end = advance(game, 20, { rivals: false });
  assert.ok(Math.abs(end.hour - 13) < 1e-8);
  assert.equal(end.winner, 'you');
});
function retaliation() {
  const game = firing();
  game.rocks.find(r => r.coreOf === 'you')!.shieldsDisabled = true;
  const enemy = game.pulse!.kings.find(k => k.factionId === 'vesper')!;
  enemy.state = 'ready'; enemy.chargeProgress = 6; enemy.resourceCommitted = 100;
  return commandPulse(game, 'vesper', { id: 'retaliation-000001', action: 'FIRE_PULSE' });
}
test('equal-time lethal arrivals eliminate both Kings as a batch, independently of faction order', () => {
  for (const reverse of [false, true]) {
    const game = retaliation();
    if (reverse) { game.pulse!.kings.reverse(); game.pulse!.pulses.reverse(); game.rocks.reverse(); }
    const end = advance(game, 20, { rivals: false });
    assert.equal(end.draw, true);
    assert.equal(end.winner, null);
    assert.equal(end.pulse!.pulses.length, 0);
    assert.ok(Math.abs(end.hour - 8) < 1e-8);
  }
});
test('the first lethal arrival extinguishes a slower retaliation immediately', () => {
  const game = applyPulseSpecialistEffect(retaliation(), 'vesper', { type: 'pulse_speed', multiplier: 0.5, expiresAt: 20 });
  const end = advance(game, 20, { rivals: false });
  assert.equal(end.winner, 'you');
  assert.ok(!end.pulse!.pulses.some(p => p.factionId === 'vesper'));
  assert.equal(end.pulse!.kings[0]!.state, 'firing');
});
test('temporal modifiers accumulate effective time and expire without recalculating the past', () => {
  let game = commandPulse(operation(), 'you', { id: 'charge-modifier-001', action: 'START_CHARGE' });
  game = applyPulseSpecialistEffect(game, 'you', { type: 'charge_rate', multiplier: 2, expiresAt: 2 });
  game = advance(game, 2, { rivals: false });
  assert.equal(game.pulse!.kings[0]!.chargeProgress, 4);
  game = applyPulseSpecialistEffect(game, 'you', { type: 'charge_rate', multiplier: 0, expiresAt: 3 });
  game = advance(game, 4, { rivals: false });
  assert.equal(game.pulse!.kings[0]!.chargeProgress, 5);
  assert.equal(advance(game, 5, { rivals: false }).pulse!.kings[0]!.state, 'ready');
});
test('pulse saves and private replays reconstruct charging and firing without changing older rules', () => {
  const baseline = operation();
  const charged = applyCommand(createArchive(baseline), { type: 'pulse', owner: 'you', command: { id: 'persistent-charge-01', action: 'START_CHARGE' } }, { rivals: false, knownThrough: 0 });
  const ready = advance(charged.game, 6, { rivals: false });
  assert.deepEqual(decodeSave(JSON.stringify({ game: ready, savedAt: 0 })).game.pulse, ready.pulse);
  const fired = applyCommand(charged.archive, { type: 'pulse', owner: 'you', command: { id: 'persistent-fire-001', action: 'FIRE_PULSE' } }, { rivals: false, knownThrough: 6 });
  const live = advance(fired.game, 7, { rivals: false });
  assert.doesNotThrow(() => decodeReplay(exportArchive(fired.archive), live, false));
  const shared = generateSharedReplay({ game: live, archive: fired.archive }, 'you', 0, 7);
  assert.doesNotThrow(() => decodeSharedReplay(encodeSharedReplay(shared)));
  const corrupt = JSON.parse(JSON.stringify(ready)); corrupt.pulse.pulses.push({ radius: -1 });
  assert.throws(() => decodeSave(JSON.stringify({ game: corrupt, savedAt: 0 })), /damaged/);
});
test('charge intelligence is private outside sensors, and observations never include command receipts or enemy shield reserves', () => {
  const baseline = operation();
  baseline.cargo.vesper = 100;
  const enemy = baseline.rocks.find(r => r.coreOf === 'vesper')!;
  // Force the enemy core outside all friendly sensor coverage.
  for (const rock of baseline.rocks) if (rock.owner === 'you') { rock.x = 0; rock.y = 0; }
  enemy.x = baseline.rules!.map.width / 2; enemy.y = baseline.rules!.map.height / 2;
  const hidden = commandPulse(baseline, 'vesper', { id: 'secret-charge-00001', action: 'START_CHARGE' });
  const view = observe(hidden, 'you');
  assert.ok(!view.pulse!.kings.some(k => k.factionId === 'vesper'));
  assert.ok(!JSON.stringify(view).includes('secret-charge'));
  assert.equal(view.pulse!.shields[enemy.id], undefined);
  assert.equal(forecastObservation(view, 'you', 6).eliminated.includes('vesper'), false);
});
test('termination removes the hazard immediately and shield energy recharges only after exposure ends', () => {
  const game = firing(), enemy = game.rocks.find(r => r.coreOf === 'vesper')!;
  enemy.shieldsDisabled = false;
  const exposed = advance(game, 9, { rivals: false });
  const stopped = executeCommand(exposed, { type: 'pulse', owner: 'you', command: { id: 'terminate-pulse-001', action: 'TERMINATE_PULSE' } });
  assert.equal(stopped.pulse!.pulses.length, 0);
  assert.equal(stopped.pulse!.kings[0]!.state, 'idle');
  assert.equal(stopped.pulse!.shields[enemy.id]!.exposed, 0);
  const end = advance(stopped, 10, { rivals: false });
  assert.ok(Math.abs(end.pulse!.shields[enemy.id]!.energy - 85) < 1e-8);
  assert.equal(end.winner, null);
});
test('pulse speed stasis expires at its own boundary and is independent of polling frequency', () => {
  const frozen = applyPulseSpecialistEffect(firing(), 'you', { type: 'pulse_speed', multiplier: 0, expiresAt: 7 });
  const single = advance(frozen, 20, { rivals: false });
  let stepped = frozen;
  for (const hour of [6.2, 6.9, 7, 7.6, 8.1, 8.9, 20]) stepped = advance(stepped, hour, { rivals: false });
  assert.equal(single.winner, 'you');
  assert.ok(Math.abs(single.hour - 9) < 1e-8);
  assert.ok(Math.abs(stepped.hour - single.hour) < 1e-8);
});
test('scheduled King movement at lethal arrival time cancels both emitters before damage', () => {
  let game = retaliation();
  for (const owner of ['you', 'vesper'] as const) {
    const from = game.rocks.find(r => r.coreOf === owner)!;
    const to = game.rocks.find(r => r.owner === owner && r !== from)!;
    game = scheduleTransfer(game, { id: `scheduled-king-${owner}`, from: from.id, to: to.id, owner, drones: 0, specialists: [`core-${owner}`], executeAt: 8 });
  }
  const end = advance(game, 8.01, { rivals: false });
  assert.equal(end.pulse!.pulses.length, 0);
  assert.equal(end.eliminated.length, 0);
  assert.equal(end.winner, null);
  assert.ok(end.pulse!.kings.every(k => k.state === 'moving'));
});
test('a ship inside a hostile pulse is destroyed despite a nearby shield, while a preparing manifest is protected', () => {
  const game = firing(), enemy = game.rocks.find(r => r.coreOf === 'vesper')!;
  enemy.shieldsDisabled = false; enemy.drones = 1;
  let exposed = advance(game, 9, { rivals: false });
  const to = exposed.rocks.find(r => r.owner === 'vesper' && r.id !== enemy.id)!;
  exposed = executeCommand(exposed, { type: 'dispatch', owner: 'vesper', from: enemy.id, to: to.id, drones: 1 });
  assert.equal(exposed.fleets.length, 1, 'preparing ships stay under the station shield');
  const departure = exposed.fleets[0]!.departed;
  exposed = advance(exposed, departure, { rivals: false });
  assert.equal(exposed.fleets.length, 0, 'the persistent hazard hits at departure');
  assert.equal(exposed.eliminated.length, 0, 'stationed King remains protected');
});
test('multiple hostile pulses add shield drain and leave emitting-faction assets immune', () => {
  let game = createConfiguredGame({ playerCount: 3, mode: 'pulse' }, 0, 42);
  for (const owner of ['you', 'vesper'] as const) {
    game.cargo[owner] = 100;
    game = commandPulse(game, owner, { id: `charge-multiple-${owner}`, action: 'START_CHARGE' });
  }
  game = advance(game, 6, { rivals: false });
  for (const owner of ['you', 'vesper'] as const) game = commandPulse(game, owner, { id: `fire-multiple-${owner}`, action: 'FIRE_PULSE' });
  const target = game.rocks.find(r => r.coreOf === 'null')!;
  // Both waves reach the target together. A third King keeps the match active until collapse.
  for (const pulse of game.pulse!.pulses) pulse.origin = { x: target.x, y: target.y };
  const exposed = advance(game, 7, { rivals: false });
  assert.equal(exposed.pulse!.shields[target.id]!.exposed, 2);
  assert.ok(Math.abs(exposed.pulse!.shields[target.id]!.energy - 60) < 1e-8);
  assert.equal(exposed.eliminated.length, 0);
  assert.ok(exposed.rocks.some(r => r.owner === 'you' && !r.destroyed));
});
test('a pulse killing a King bypasses fallback succession and movement while firing extinguishes the wave immediately', () => {
  const game = firing();
  const fallback = game.rocks.find(r => r.owner === 'vesper' && !r.coreOf)!;
  fallback.specialists!.push({ id: 'fallback-vesper', kind: 'princess', owner: 'vesper' });
  const end = advance(game, 8, { rivals: false });
  assert.equal(end.winner, 'you');
  assert.ok(end.eliminated.includes('vesper'));
  const source = game.rocks.find(r => r.coreOf === 'you')!;
  const to = game.rocks.find(r => r.owner === 'you' && r !== source)!;
  const moved = dispatch(game, source.id, to.id, 0, 'you', false, ['core-you']);
  assert.equal(moved.pulse!.pulses.length, 0);
  assert.equal(moved.pulse!.kings[0]!.state, 'moving');
});
test('trusted specialist commands are idempotent and survive private replay', () => {
  const game = operation();
  const command = { type: 'pulse-specialist-effect' as const, owner: 'you' as const, command: { id: 'ability-command-0001', target: 'you' as const, effect: { type: 'charge_rate' as const, multiplier: 2, expiresAt: 2 } } };
  const applied = applyCommand(createArchive(game), command, { rivals: false, knownThrough: 0 });
  const retried = executeCommand(applied.game, command);
  assert.equal(retried.pulse!.modifiers.length, 1);
  assert.doesNotThrow(() => decodeReplay(exportArchive(applied.archive), retried, false));
  assert.throws(() => executeCommand(applied.game, { ...command, command: { ...command.command, effect: { ...command.command.effect, multiplier: 3 } } }), /different content/);
});
test('committing Pulse Material withdraws funding when the material lead is lost', () => {
  const baseline = operation(); baseline.cargo.you = 100;
  const funded = setFunding(baseline, 'you', 'vesper', true);
  const charged = executeCommand(funded, { type: 'pulse', owner: 'you', command: { id: 'funded-charge-0001', action: 'START_CHARGE' } });
  assert.equal(charged.funding!.length, 0);
  assert.doesNotThrow(() => decodeSave(JSON.stringify({ savedAt: 0, game: charged })));
});
