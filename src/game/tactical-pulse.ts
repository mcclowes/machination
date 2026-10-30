/**
 * ---
 * purpose: Disruptor balance, material commitment, charging, and finite tactical wave state. Times are game hours.
 * related:
 *   - ./tactical-pulse-simulation.ts - wave contacts and temporary disruption
 *   - ./tactical-pulse-save.ts - persisted state validation
 * ---
 */
import type { Faction, Game } from './simulation';
import type { Point } from './geometry';
import { reconcileFunding } from './funding';
import { withPulseMovement } from './pulse';

export type TacticalPulseConfig = {
  minimumResourceCost: number; maximumResourceCost: number; chargeDuration: number;
  strengthPerResource: number; attenuationPerDistance: number; propagationSpeed: number;
  chargeInterruptThreshold: number; miningDisableThreshold: number; communicationsJamThreshold: number;
  disruptionDuration: number; resistanceDuration: number; shieldDamage: number; strategicSlowMultiplier: number;
};
export const DEFAULT_TACTICAL_PULSE_CONFIG: Readonly<TacticalPulseConfig> = Object.freeze({
  minimumResourceCost: 10, maximumResourceCost: 25, chargeDuration: .5,
  strengthPerResource: 5, attenuationPerDistance: .9, propagationSpeed: 8,
  chargeInterruptThreshold: 60, miningDisableThreshold: 60, communicationsJamThreshold: 20,
  disruptionDuration: 1, resistanceDuration: 6, shieldDamage: 25, strategicSlowMultiplier: .5,
});
export type TacticalCharge = { id: string; specialistId: string; factionId: Faction; siteId: string; readyAt: number; resourceCost: number };
export type TacticalPulse = { id: string; specialistId: string; factionId: Faction; origin: Point; firedAt: number; initialStrength: number; attenuationPerDistance: number; radius: number; hitSites: string[]; hitFleets: number[] };
export type TacticalPulseSystem = { charges: TacticalCharge[]; waves: TacticalPulse[]; resistance: Record<string, number> };
export type TacticalPulseCommand = { id: string; specialistId: string } & ({ action: 'CHARGE_DISRUPTOR'; resourceCost: number } | { action: 'CANCEL_DISRUPTOR' });
export type TacticalPulseRequest = Omit<Extract<TacticalPulseCommand, { action: 'CHARGE_DISRUPTOR' }>, 'id'> | Omit<Extract<TacticalPulseCommand, { action: 'CANCEL_DISRUPTOR' }>, 'id'>;
export function isTacticalPulseCommand(value: unknown): value is TacticalPulseCommand {
  const v = value as TacticalPulseCommand;
  if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(v.id) || typeof v.specialistId !== 'string' || !/^[a-zA-Z0-9:-]{1,80}$/.test(v.specialistId)) return false;
  const keys = v.action === 'CHARGE_DISRUPTOR' ? ['id', 'action', 'specialistId', 'resourceCost'] : ['id', 'action', 'specialistId'];
  return Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k)) && (v.action === 'CANCEL_DISRUPTOR' || v.action === 'CHARGE_DISRUPTOR' && Number.isSafeInteger(v.resourceCost));
}
export const tacticalConfig = (game: { rules?: { tacticalPulse?: TacticalPulseConfig } }): TacticalPulseConfig => game.rules?.tacticalPulse ?? DEFAULT_TACTICAL_PULSE_CONFIG;
export const tacticalStrength = (wave: Pick<TacticalPulse, 'initialStrength' | 'radius'>, config: TacticalPulseConfig): number => Math.max(0, wave.initialStrength - wave.radius * config.attenuationPerDistance);
export function validateTacticalPulseConfig(value: unknown): TacticalPulseConfig {
  const v = value as TacticalPulseConfig;
  if (!v || typeof v !== 'object' || Object.keys(v).sort().join() !== Object.keys(DEFAULT_TACTICAL_PULSE_CONFIG).sort().join()
    || !Object.values(v).every(n => typeof n === 'number' && Number.isFinite(n) && n > 0)
    || !Number.isSafeInteger(v.minimumResourceCost) || !Number.isSafeInteger(v.maximumResourceCost) || v.maximumResourceCost < v.minimumResourceCost || v.maximumResourceCost > 1000
    || v.strategicSlowMultiplier > 1 || v.communicationsJamThreshold > v.miningDisableThreshold || v.miningDisableThreshold > v.chargeInterruptThreshold) throw new Error('Invalid tactical pulse configuration.');
  return { ...v };
}
export function cloneTacticalPulse(s: TacticalPulseSystem): TacticalPulseSystem {
  return { charges: s.charges.map(c => ({ ...c })), waves: s.waves.map(w => ({ ...w, origin: { ...w.origin }, hitSites: [...w.hitSites], hitFleets: [...w.hitFleets] })), resistance: { ...s.resistance } };
}
export function commandTacticalPulse(input: Game, owner: Faction, command: TacticalPulseCommand): Game {
  if (!input.pulse?.tactical || input.rules?.mode !== 'pulse') throw new Error('Disruptors are unavailable in this operation.');
  if (!isTacticalPulseCommand(command)) throw new Error('Provide a unique pulse command ID.');
  const key = `${owner}:${command.id}`, payload = `tactical:${JSON.stringify([command.action, command.specialistId, command.action === 'CHARGE_DISRUPTOR' ? command.resourceCost : null])}`;
  if (Object.hasOwn(input.pulse.receipts, key)) {
    if (input.pulse.receipts[key] !== payload) throw new Error('This command ID was used for different content.');
    return input;
  }
  if (input.winner || input.draw || input.eliminated.includes(owner)) throw new Error('This intelligence is no longer operational.');
  const game = withPulseMovement(input), system = game.pulse!.tactical!, config = tacticalConfig(game);
  const site = game.rocks.find(r => !r.destroyed && r.owner === owner && r.specialists?.some(u => u.id === command.specialistId && u.owner === owner && u.kind === 'disruptor' && !u.captive));
  if (!site) throw new Error('Choose your stationed Disruptor at a controlled site.');
  const charging = system.charges.find(c => c.specialistId === command.specialistId);
  if (command.action === 'CHARGE_DISRUPTOR') {
    if (charging) throw new Error('This Disruptor is already charging.');
    if (!Number.isSafeInteger(command.resourceCost) || command.resourceCost < config.minimumResourceCost || command.resourceCost > config.maximumResourceCost) throw new Error(`Choose ${config.minimumResourceCost}–${config.maximumResourceCost} Pulse Material.`);
    if ((game.cargo[owner] ?? 0) < command.resourceCost) throw new Error('Not enough Pulse Material.');
    if (system.charges.length + system.waves.length >= 1000) throw new Error('Too many tactical pulses.');
    game.cargo = { ...game.cargo, [owner]: game.cargo[owner]! - command.resourceCost };
    system.charges.push({ id: command.id, specialistId: command.specialistId, factionId: owner, siteId: site.id, readyAt: game.hour + config.chargeDuration, resourceCost: command.resourceCost });
    game.events.unshift({ hour: game.hour, audience: [owner], message: `${site.name}: Disruptor charging. Movement cancels the charge without a refund.` });
  } else if (command.action === 'CANCEL_DISRUPTOR') {
    if (!charging) throw new Error('This Disruptor has no charge to cancel.');
    system.charges = system.charges.filter(c => c !== charging);
  } else throw new Error('Unknown tactical pulse command.');
  if (Object.keys(game.pulse!.receipts).length >= 10000) throw new Error('Pulse command history is full.');
  game.pulse!.receipts[key] = payload;
  reconcileFunding(game);
  return game;
}
export function reconcileTacticalCharges(game: Game): void {
  const system = game.pulse?.tactical;
  if (!system) return;
  system.charges = system.charges.filter(c => {
    const site = game.rocks.find(r => r.id === c.siteId && !r.destroyed && r.owner === c.factionId);
    const valid = !game.eliminated.includes(c.factionId) && site?.specialists?.some(u => u.id === c.specialistId && u.kind === 'disruptor' && u.owner === c.factionId && !u.captive);
    if (!valid) game.events.unshift({ hour: game.hour, audience: [c.factionId], message: 'Disruptor charge canceled. Committed material is lost.' });
    return valid;
  });
}
export function completeTacticalCharges(game: Game): void {
  reconcileTacticalCharges(game);
  const system = game.pulse?.tactical;
  if (!system) return;
  for (const charge of system.charges.filter(c => c.readyAt <= game.hour + 1e-9)) {
    const site = game.rocks.find(r => r.id === charge.siteId)!;
    system.waves.push({ id: charge.id, specialistId: charge.specialistId, factionId: charge.factionId, origin: { x: site.x, y: site.y }, firedAt: game.hour, initialStrength: charge.resourceCost * tacticalConfig(game).strengthPerResource, attenuationPerDistance: tacticalConfig(game).attenuationPerDistance, radius: 0, hitSites: [], hitFleets: [] });
    game.events.unshift({ hour: game.hour, audience: [charge.factionId], message: `${site.name}: tactical pulse launched. The wave now travels independently.` });
  }
  system.charges = system.charges.filter(c => c.readyAt > game.hour + 1e-9);
}
