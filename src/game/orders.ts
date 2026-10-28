/**
 * ---
 * purpose: Validate future transfers, share mixed queue types, and cancel private orders without reserving resources.
 * ---
 */
import { isActionPlan, actionLabel, plannedUnitIds, type ScheduledAction, type FutureAction } from './future-actions';
import { inRange, sensors } from './sensors';
import { mechanicsVersion } from './rules';
import { playersIn } from './players';
import type { Faction, Game } from './simulation';
import { recentEvents } from './events';
import type { ModuleKind } from './modules';
export const MAX_PLAN_DELAY = 7 * 24;
export type ScheduledTransfer = { id: string; owner: Faction; from: string; to: string; drones: number; executeAt: number; fleetId?: number; specialists?: string[]; module?: ModuleKind };
export type ScheduledOrder = ScheduledTransfer | ScheduledAction;
export type ScheduledLaunch = ScheduledTransfer | (ScheduledAction & { action: Extract<FutureAction, { type: 'gift' | 'intercept' }> });
export type LaunchEdit = { planId: string; drones: number; specialists?: string[] };
export function isScheduledLaunch(plan: ScheduledOrder): plan is ScheduledLaunch {
  return !isActionPlan(plan) || plan.action.type === 'gift' || plan.action.type === 'intercept';
}
export function validateLaunchEdit(value: unknown): LaunchEdit {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Provide a scheduled launch manifest.');
  const edit = value as Record<string, unknown>;
  if (!['planId', 'drones'].every(key => Object.hasOwn(edit, key)) || Object.keys(edit).some(key => !['planId', 'drones', 'specialists'].includes(key))
    || typeof edit.planId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(edit.planId) || !Number.isSafeInteger(edit.drones) || (edit.drones as number) < 0
    || edit.specialists !== undefined && (!Array.isArray(edit.specialists) || edit.specialists.length > 10000 || new Set(edit.specialists).size !== edit.specialists.length
      || !edit.specialists.every(id => typeof id === 'string' && /^[a-zA-Z0-9:-]{1,80}$/.test(id)))) throw new Error('Provide a scheduled launch manifest.');
  return { planId: edit.planId, drones: edit.drones as number, ...(Array.isArray(edit.specialists) ? { specialists: [...edit.specialists] as string[] } : {}) };
}
export function editScheduledLaunch(game: Game, owner: Faction, change: LaunchEdit): Game {
  if (!playersIn(game).includes(owner) || game.winner || game.draw || game.eliminated.includes(owner)) throw new Error('This intelligence is no longer operational.');
  const edit = validateLaunchEdit(change);
  const plan = game.scheduled?.find(p => p.id === edit.planId && p.owner === owner);
  if (!plan || !isScheduledLaunch(plan) || plan.executeAt <= game.hour) throw new Error('Scheduled launch unavailable. It may have executed or been canceled.');
  const prior = 'action' in plan ? plan.action : plan;
  if (game.version === 1 && edit.specialists?.length) throw new Error('This operation transports cargo modules instead of specialists.');
  const specialists = game.version === 1 ? undefined : edit.specialists ?? prior.specialists;
  if (edit.drones < (game.version === 2 && (specialists?.length || 'type' in prior && prior.type === 'intercept') ? 0 : 1)) throw new Error('A launch needs drones or a specialist manifest.');
  const available = new Set([...game.rocks, ...game.fleets].filter(a => a.owner === owner).flatMap(a => (a.specialists ?? []).filter(u => u.owner === owner && !u.captive).map(u => u.id))
    .concat(plannedUnitIds(game, owner), prior.specialists ?? []));
  if (edit.specialists?.some(id => !available.has(id))) throw new Error('Choose owned modules, planned recruits, or the existing manifest.');
  const manifest = { drones: edit.drones, ...(specialists === undefined ? {} : { specialists: [...specialists] }) };
  const replacement: ScheduledLaunch = 'action' in plan ? { ...plan, action: { ...plan.action, ...manifest } } : { ...plan, ...manifest };
  return { ...game, scheduled: game.scheduled!.map(p => p === plan ? replacement : p), events: recentEvents([{ hour: game.hour, audience: [owner], message: `Scheduled launch from ${game.rocks.find(r => r.id === prior.from)?.name ?? prior.from} updated. Execution time is unchanged.` }, ...game.events]) };
}
export type TransferPlan = Omit<ScheduledTransfer, 'module' | 'fleetId'> & { carryModule?: boolean };
export function scheduleTransfer(game: Game, plan: TransferPlan): Game {
  if (game.winner || game.draw || game.eliminated.includes(plan.owner)) throw new Error('This intelligence is no longer operational.');
  if (typeof plan.id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(plan.id)) throw new Error('Provide a unique plan ID.');
  const existing = game.scheduled ?? [];
  if (existing.some(p => p.id === plan.id && p.owner === plan.owner)) throw new Error('This plan ID is already in use.');
  if (!Number.isFinite(plan.executeAt) || plan.executeAt <= game.hour || plan.executeAt > game.hour + MAX_PLAN_DELAY) throw new Error('Schedule a future launch within seven days.');
  if (!Array.isArray(plan.specialists ?? []) || new Set(plan.specialists).size !== (plan.specialists?.length ?? 0)) throw new Error('Choose each planned module once.');
  if (!Number.isSafeInteger(plan.drones) || plan.drones < (game.version === 2 && plan.specialists?.length ? 0 : 1)) throw new Error('A transfer needs a positive whole number of drones.');
  const from = game.rocks.find(r => r.id === plan.from);
  const knownWreck = (site: Game['rocks'][number] | undefined) => site?.destroyed && (site.owner === plan.owner || inRange(sensors(game, plan.owner), site, game));
  if (mechanicsVersion(game) >= 2 && (knownWreck(from) || knownWreck(game.rocks.find(r => r.id === plan.to)))) throw new Error('Destroyed sites cannot send or receive haulers.');
  const futureSource = game.version === 2 && (game.fleets.some(f => f.owner === plan.owner && f.to === plan.from) || existing.some(p => !isActionPlan(p) && p.owner === plan.owner && p.to === plan.from));
  if (!from || from.owner !== plan.owner && !futureSource || plan.from === plan.to || !game.rocks.some(r => r.id === plan.to)) throw new Error('Select a controlled departure rock and a different destination.');
  const availableUnits = new Set([...game.rocks, ...game.fleets].filter(asset => asset.owner === plan.owner).flatMap(asset => (asset.specialists ?? []).filter(unit => unit.owner === plan.owner && !unit.captive).map(unit => unit.id)).concat(plannedUnitIds(game, plan.owner)));
  if (plan.specialists?.some(id => !availableUnits.has(id))) throw new Error('Planned modules must be owned or supplied by your queued hire.');
  if (plan.carryModule !== undefined && typeof plan.carryModule !== 'boolean' || plan.carryModule && !from.module) throw new Error('There is no module available to plan for transport.');
  const scheduled: ScheduledTransfer = { id: plan.id, owner: plan.owner, from: plan.from, to: plan.to, drones: plan.drones, executeAt: plan.executeAt, ...(mechanicsVersion(game) >= 4 ? { fleetId: game.nextId } : {}), ...(plan.carryModule ? { module: from.module! } : {}), ...(plan.specialists?.length ? { specialists: [...plan.specialists] } : {}) };
  return { ...game, nextId: game.nextId + (mechanicsVersion(game) >= 4 ? 1 : 0), scheduled: [...existing, scheduled], events: recentEvents([{ hour: game.hour, audience: [plan.owner], message: `Transfer planned from ${from.name} for hour ${plan.executeAt.toFixed(2)}. Drones are not reserved.` }, ...game.events]) };
}
export function cancelTransfer(game: Game, id: string, owner: Faction): Game {
  const plan = game.scheduled?.find(p => p.id === id && p.owner === owner);
  if (!plan) throw new Error('Scheduled transfer not found. It may already have launched or been canceled.');
  return { ...game, scheduled: game.scheduled!.filter(p => p !== plan), events: recentEvents([{ hour: game.hour, audience: [owner], message: isActionPlan(plan) ? `${actionLabel(plan.action, game.rocks)} canceled.` : `Scheduled transfer from ${game.rocks.find(r => r.id === plan.from)!.name} canceled.` }, ...game.events]) };
}
