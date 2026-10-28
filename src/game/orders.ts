/**
 * ---
 * purpose: Validate and cancel private future transfer plans without reserving resources.
 * ---
 */
import type { Faction, Game } from './simulation';
import { recentEvents } from './events';
import type { ModuleKind } from './modules';
export const MAX_PLAN_DELAY = 7 * 24;
export const MAX_PLANS_PER_FACTION = 20;
export type ScheduledTransfer = { id: string; owner: Faction; from: string; to: string; drones: number; executeAt: number; specialists?: string[]; module?: ModuleKind };
export type TransferPlan = Omit<ScheduledTransfer, 'module'> & { carryModule?: boolean };
export function scheduleTransfer(game: Game, plan: TransferPlan): Game {
  if (game.winner || game.draw || game.eliminated.includes(plan.owner)) throw new Error('This intelligence is no longer operational.');
  if (typeof plan.id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(plan.id)) throw new Error('Provide a unique plan ID.');
  const existing = game.scheduled ?? [];
  if (existing.some(p => p.id === plan.id && p.owner === plan.owner)) throw new Error('This plan ID is already in use.');
  if (existing.filter(p => p.owner === plan.owner).length >= MAX_PLANS_PER_FACTION) throw new Error('An intelligence can queue at most 20 transfers.');
  if (!Number.isFinite(plan.executeAt) || plan.executeAt <= game.hour || plan.executeAt > game.hour + MAX_PLAN_DELAY) throw new Error('Schedule a future launch within seven days.');
  if (!Array.isArray(plan.specialists ?? []) || new Set(plan.specialists).size !== (plan.specialists?.length ?? 0)) throw new Error('Choose each planned module once.');
  if (!Number.isSafeInteger(plan.drones) || plan.drones < (game.version === 2 && plan.specialists?.length ? 0 : 1)) throw new Error('A transfer needs a positive whole number of drones.');
  const from = game.rocks.find(r => r.id === plan.from);
  if (!from || from.owner !== plan.owner || plan.from === plan.to || !game.rocks.some(r => r.id === plan.to)) throw new Error('Select a controlled departure rock and a different destination.');
  if (plan.specialists?.some(id => !from.specialists?.some(u => u.id === id && u.owner === plan.owner && !u.captive))) throw new Error('Planned modules must be available at the departure site.');
  if (plan.carryModule !== undefined && typeof plan.carryModule !== 'boolean' || plan.carryModule && !from.module) throw new Error('There is no module available to plan for transport.');
  const scheduled: ScheduledTransfer = { id: plan.id, owner: plan.owner, from: plan.from, to: plan.to, drones: plan.drones, executeAt: plan.executeAt, ...(plan.carryModule ? { module: from.module! } : {}), ...(plan.specialists?.length ? { specialists: [...plan.specialists] } : {}) };
  return { ...game, scheduled: [...existing, scheduled], events: recentEvents([{ hour: game.hour, audience: [plan.owner], message: `Transfer planned from ${from.name} for hour ${plan.executeAt.toFixed(2)}. Drones are not reserved.` }, ...game.events]) };
}
export function cancelTransfer(game: Game, id: string, owner: Faction): Game {
  const plan = game.scheduled?.find(p => p.id === id && p.owner === owner);
  if (!plan) throw new Error('Scheduled transfer not found. It may already have launched or been canceled.');
  return { ...game, scheduled: game.scheduled!.filter(p => p !== plan), events: recentEvents([{ hour: game.hour, audience: [owner], message: `Scheduled transfer from ${game.rocks.find(r => r.id === plan.from)!.name} canceled.` }, ...game.events]) };
}
