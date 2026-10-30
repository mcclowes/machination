/**
 * ---
 * purpose: King's Pulse state, balancing, commands, and the trusted specialist effect contract. All times are game hours.
 * related:
 *   - ./pulse-simulation.ts - chronological propagation and shield damage
 * ---
 */
import { requireUnfrozen } from './temporal-facilities';
import { cloneTacticalPulse, commandTacticalPulse, reconcileTacticalCharges, type TacticalPulseSystem, type TacticalPulseCommand } from './tactical-pulse';
import { reconcileFunding } from './funding';
import type { Faction, Game } from './simulation';
import type { Point } from './geometry';
import { fleetPosition } from './flight';
import { playersIn } from './players';

export type KingPulseState = 'idle' | 'charging' | 'ready' | 'firing' | 'moving' | 'destroyed';
export type PulseConfig = {
  chargeDuration: number; activationResourceCost: number; propagationSpeed: number;
  shieldMaxEnergy: number; shieldDrainPerHour: number; shieldRechargePerHour: number;
  miningDamage: 'destroy' | 'disable';
};
export const DEFAULT_PULSE_CONFIG: Readonly<PulseConfig> = Object.freeze({ chargeDuration: 6, activationResourceCost: 100, propagationSpeed: 8, shieldMaxEnergy: 100, shieldDrainPerHour: 20, shieldRechargePerHour: 5, miningDamage: 'destroy' });
export type KingPulse = { kingId: string; factionId: Faction; state: KingPulseState; position: Point; chargeProgress: number; resourceCommitted: number };
export type ActivePulse = { id: string; kingId: string; factionId: Faction; origin: Point; firedAt: number; radius: number };
export type PlanetaryShield = { energy: number; exposed: number };
export type PulseSpecialistEffect =
  | { type: 'charge_rate' | 'pulse_speed' | 'shield_drain'; multiplier: number; expiresAt: number }
  | { type: 'interrupt_charge' | 'terminate_pulse' };
export type PulseModifier = Extract<PulseSpecialistEffect, { multiplier: number }> & { factionId: Faction };
export type PulseSystem = { kings: KingPulse[]; pulses: ActivePulse[]; shields: Record<string, PlanetaryShield>; modifiers: PulseModifier[]; receipts: Record<string, string>; tactical?: TacticalPulseSystem };
export type PulseAction = 'START_CHARGE' | 'FIRE_PULSE' | 'CANCEL_CHARGE' | 'TERMINATE_PULSE';
export type PulseCommand = { id: string; action: PulseAction } | TacticalPulseCommand;
export type PulseEffectCommand = { id: string; target: Faction; effect: PulseSpecialistEffect };
export const pulseEnabled = (game: { rules?: { mode: string } }): boolean => game.rules?.mode === 'pulse';
export const pulseConfig = (game: { rules?: { pulse?: PulseConfig } }): PulseConfig => game.rules?.pulse ?? DEFAULT_PULSE_CONFIG;
export function validatePulseConfig(value: unknown): PulseConfig {
  const v = value as PulseConfig;
  if (!v || typeof v !== 'object' || Object.keys(v).sort().join() !== Object.keys(DEFAULT_PULSE_CONFIG).sort().join()
    || !['chargeDuration', 'activationResourceCost', 'propagationSpeed', 'shieldMaxEnergy', 'shieldDrainPerHour'].every(k => Number.isFinite(v[k as keyof PulseConfig]) && Number(v[k as keyof PulseConfig]) > 0)
    || !Number.isFinite(v.shieldRechargePerHour) || v.shieldRechargePerHour < 0 || !['destroy', 'disable'].includes(v.miningDamage)) throw new Error('Invalid pulse configuration.');
  return { ...v };
}
export function clonePulse(system: PulseSystem): PulseSystem {
  return { ...(system.tactical ? { tactical: cloneTacticalPulse(system.tactical) } : {}), kings: system.kings.map(k => ({ ...k, position: { ...k.position } })), pulses: system.pulses.map(p => ({ ...p, origin: { ...p.origin } })), shields: Object.fromEntries(Object.entries(system.shields).map(([id, s]) => [id, { ...s }])), modifiers: system.modifiers.map(m => ({ ...m })), receipts: { ...system.receipts } };
}
export function createPulseSystem(game: Game): PulseSystem {
  return { ...(game.rules?.tacticalPulse ? { tactical: { charges: [], waves: [], resistance: {} } } : {}), kings: game.rocks.flatMap(r => (r.specialists ?? []).filter(u => u.kind === 'queen' && !u.captive).map(u => ({ kingId: u.id, factionId: u.owner, state: 'idle' as const, position: { x: r.x, y: r.y }, chargeProgress: 0, resourceCommitted: 0 }))), pulses: [], shields: Object.fromEntries(game.rocks.filter(r => (r.shieldMax ?? 0) > 0).map(r => [r.id, { energy: pulseConfig(game).shieldMaxEnergy, exposed: 0 }])), modifiers: [], receipts: {} };
}
export function pulseRate(game: { hour: number; pulse?: Pick<PulseSystem, 'modifiers'> }, factionId: Faction, type: PulseModifier['type']): number {
  return (game.pulse?.modifiers ?? []).filter(m => m.factionId === factionId && m.type === type && m.expiresAt > game.hour).reduce((rate, m) => rate * m.multiplier, 1);
}
export function endPulse(game: Game, king: KingPulse, state: KingPulseState = 'idle'): void {
  if (!game.pulse) return;
  if (king.state === 'firing') game.events.unshift({ hour: game.hour, audience: [...playersIn(game)], message: `${king.factionId}: King's Pulse terminated.` });
  game.pulse.pulses = game.pulse.pulses.filter(p => p.kingId !== king.kingId);
  king.state = state; king.chargeProgress = 0; king.resourceCommitted = 0;
}
/** Reconcile after movement, capture, destruction, resignation, or manifest edits. No fallback King succession. */
export function reconcilePulseKings(game: Game): void {
  if (!game.pulse) return;
  for (const king of game.pulse.kings) {
    if (king.state === 'destroyed') continue;
    const hasKing = (a: { owner: Faction | null; specialists?: { id: string; captive?: boolean }[] }) => a.owner === king.factionId && a.specialists?.some(u => u.id === king.kingId && !u.captive);
    const rock = game.rocks.find(r => !r.destroyed && hasKing(r));
    const fleet = game.fleets.find(hasKing);
    if (game.eliminated.includes(king.factionId) || !rock && !fleet) {
      endPulse(game, king, 'destroyed');
      if (!game.eliminated.includes(king.factionId)) game.eliminated.push(king.factionId);
      game.scheduled = game.scheduled?.filter(p => p.owner !== king.factionId);
      for (const fleet of game.fleets) if (fleet.owner === king.factionId) delete fleet.pendingCourse;
      game.events.unshift({ hour: game.hour, audience: [...playersIn(game)], message: `${king.factionId}: King eliminated.` });
    } else if (fleet) { king.position = fleetPosition(game, fleet); if (king.state !== 'moving') endPulse(game, king, 'moving'); }
    else if (rock) { king.position = { x: rock.x, y: rock.y }; if (king.state === 'moving') king.state = 'idle'; }
  }
}
export function withPulseMovement(game: Game): Game {
  if (!game.pulse) return game;
  const result = { ...game, pulse: clonePulse(game.pulse), events: [...game.events], eliminated: [...game.eliminated] };
  reconcilePulseKings(result);
  reconcileTacticalCharges(result);
  return result;
}
export function completePulseCharges(game: Game): void {
  for (const king of game.pulse?.kings ?? []) if (king.state === 'charging' && king.chargeProgress >= pulseConfig(game).chargeDuration - 1e-9) {
    king.state = 'ready'; king.chargeProgress = pulseConfig(game).chargeDuration;
    game.events.unshift({ hour: game.hour, audience: [king.factionId], message: 'Your King is ready to fire.' });
  }
}
export function commandPulse(input: Game, owner: Faction, command: PulseCommand): Game {
  if (command?.action === 'CHARGE_DISRUPTOR' || command?.action === 'CANCEL_DISRUPTOR') return commandTacticalPulse(input, owner, command);
  if (!input.pulse || !pulseEnabled(input)) throw new Error("King's Pulse is unavailable in this operation.");
  if (!command || !/^[a-zA-Z0-9-]{16,80}$/.test(command.id)) throw new Error('Provide a unique pulse command ID.');
  const key = `${owner}:${command.id}`, payload = command.action;
  if (Object.hasOwn(input.pulse.receipts, key)) {
    if (input.pulse.receipts[key] !== payload) throw new Error('This command ID was used for different content.');
    return input;
  }
  const game = withPulseMovement(input);
  if (game.winner || game.draw || game.eliminated.includes(owner)) throw new Error('This King is no longer operational.');
  const king = game.pulse!.kings.find(k => k.factionId === owner);
  if (!king) throw new Error('Choose your living King.');
  const site = game.rocks.find(r => r.specialists?.some(u => u.id === king.kingId));
  if (site && ['START_CHARGE', 'FIRE_PULSE'].includes(command.action)) requireUnfrozen(game, site);
  const config = pulseConfig(game);
  switch (command.action) {
    case 'START_CHARGE':
      if (king.state !== 'idle') throw new Error('Your King must be idle and stationed to charge.');
      if ((game.cargo[owner] ?? 0) < config.activationResourceCost) throw new Error(`Charging requires ${config.activationResourceCost} Pulse Material.`);
      game.cargo = { ...game.cargo, [owner]: game.cargo[owner]! - config.activationResourceCost };
      king.state = 'charging'; king.chargeProgress = 0; king.resourceCommitted = config.activationResourceCost;
      game.events.unshift({ hour: game.hour, audience: [owner], message: 'Your King has begun charging. Movement cancels the charge without a refund.' });
      break;
    case 'CANCEL_CHARGE':
      if (!['charging', 'ready'].includes(king.state)) throw new Error('Your King has no charge to cancel.');
      endPulse(game, king);
      break;
    case 'FIRE_PULSE':
      if (king.state !== 'ready') throw new Error('Your King must finish charging before firing.');
      king.state = 'firing';
      game.pulse!.pulses.push({ id: command.id, kingId: king.kingId, factionId: owner, origin: { ...king.position }, firedAt: game.hour, radius: 0 });
      game.events.unshift({ hour: game.hour, audience: [...playersIn(game)], message: `${owner}: King's Pulse detected. Hostile to every opposing faction.` });
      game.events.unshift({ hour: game.hour, audience: playersIn(game).filter(f => f !== owner && !game.eliminated.includes(f)), message: 'A hostile pulse is approaching your King. Reposition or prepare your shields.' });
      break;
    case 'TERMINATE_PULSE':
      if (king.state !== 'firing') throw new Error('Your King is not sustaining a pulse.');
      endPulse(game, king);
      break;
    default: throw new Error('Unknown pulse command.');
  }
  if (Object.keys(game.pulse!.receipts).length >= 10000) throw new Error('Pulse command history is full.');
  game.pulse!.receipts[key] = payload;
  reconcileFunding(game);
  return game;
}
/** Trusted ability boundary. Ability ownership, range, costs, and cooldowns are validated by its caller. */
export function applyPulseSpecialistEffect(input: Game, target: Faction, effect: PulseSpecialistEffect, commandId: string): Game {
  if (!commandId || !/^[a-zA-Z0-9-]{16,80}$/.test(commandId)) throw new Error('Provide a unique specialist command ID.');
  const key = `${target}:${commandId}`, payload = `effect:${JSON.stringify(effect)}`;
  if (input.pulse && Object.hasOwn(input.pulse.receipts, key)) {
    if (input.pulse.receipts[key] !== payload) throw new Error('This command ID was used for different content.');
    return input;
  }
  if (!input.pulse || !playersIn(input).includes(target) || input.winner || input.draw || input.eliminated.includes(target)) throw new Error('Choose a living King in a pulse operation.');
  const game = withPulseMovement(input), king = game.pulse!.kings.find(k => k.factionId === target)!;
  if (!king) throw new Error('King unavailable.');
  switch (effect.type) {
    case 'interrupt_charge': if (['charging', 'ready'].includes(king.state)) endPulse(game, king); break;
    case 'terminate_pulse': if (king.state === 'firing') endPulse(game, king); break;
    case 'charge_rate': case 'pulse_speed': case 'shield_drain':
      if (!Number.isFinite(effect.multiplier) || effect.multiplier < 0 || effect.multiplier > 100 || !Number.isFinite(effect.expiresAt) || effect.expiresAt <= game.hour) throw new Error('Invalid pulse modifier.');
      if (game.pulse!.modifiers.length >= 10000) throw new Error('Too many pulse modifiers.');
      game.pulse!.modifiers.push({ ...effect, factionId: target }); break;
    default: throw new Error('Unknown pulse effect.');
  }
  if (Object.keys(game.pulse!.receipts).length >= 10000) throw new Error('Pulse command history is full.');
  game.pulse!.receipts[key] = payload;
  reconcileFunding(game);
  return game;
}
