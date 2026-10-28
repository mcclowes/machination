import { isActionPlan } from '../game/future-actions';
import type { ScheduledOrder } from '../game/orders';
import type { Faction } from '../game/simulation';
import type { SpecialistKind } from '../game/specialist-catalog';

type Unit = { id: string; kind: SpecialistKind; owner: Faction; captive?: boolean };
type Asset = { owner?: Faction | null; specialists?: Unit[] };
export type LaunchUnit = { id: string; kind: SpecialistKind; planned: boolean };
export function selectableLaunchUnits(view: { rocks: readonly Asset[]; fleets: readonly Asset[]; scheduled: readonly ScheduledOrder[] }, owner: Faction): LaunchUnit[] {
  const units = new Map<string, LaunchUnit>();
  for (const asset of [...view.rocks, ...view.fleets]) {
    if (asset.owner !== owner) continue;
    for (const unit of asset.specialists ?? []) if (unit.owner === owner && !unit.captive) units.set(unit.id, { id: unit.id, kind: unit.kind, planned: false });
  }
  for (const plan of view.scheduled) {
    if (plan.owner !== owner || !isActionPlan(plan) || plan.action.type !== 'hire') continue;
    for (const id of plan.hireUnits ?? []) if (!units.has(id)) units.set(id, { id, kind: plan.action.kind, planned: true });
  }
  return [...units.values()];
}
