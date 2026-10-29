import { isActionPlan } from '../game/future-actions';
import type { ScheduledOrder } from '../game/orders';
import type { Faction } from '../game/simulation';
import { SPECIALISTS, type SpecialistKind } from '../game/specialist-catalog';
import { MODULES, type ModuleKind } from '../game/modules';
import { gameClock } from '../game/time-machine';

type Unit = { id: string; kind: SpecialistKind; owner: Faction; captive?: boolean };
type Asset = { id?: string | number; name?: string; from?: string; to?: string; owner?: Faction | null; specialists?: Unit[] };
export type LaunchUnit = { id: string; kind: SpecialistKind; planned: boolean; location: string };
export function launchCargoLabel(drones: number, specialists: readonly { kind: SpecialistKind }[], module?: ModuleKind): string {
  return [`${drones} drones`, specialists.length ? specialists.map(unit => SPECIALISTS[unit.kind].name).join(', ') : 'no specialists', ...(module ? [MODULES[module].name] : [])].join(' · ');
}
export function selectableLaunchUnits(view: { rocks: readonly Asset[]; fleets: readonly Asset[]; scheduled: readonly ScheduledOrder[] }, owner: Faction): LaunchUnit[] {
  const units = new Map<string, LaunchUnit>();
  const name = (id: string) => view.rocks.find(r => r.id === id)?.name ?? 'site';
  for (const asset of [...view.rocks, ...view.fleets]) {
    if (asset.owner !== owner) continue;
    const location = asset.name ?? (asset.from && asset.to ? `${name(asset.from)} → ${name(asset.to)}` : 'Owned asset');
    for (const unit of asset.specialists ?? []) if (unit.owner === owner && !unit.captive) units.set(unit.id, { id: unit.id, kind: unit.kind, planned: false, location });
  }
  for (const plan of view.scheduled) {
    if (plan.owner !== owner || !isActionPlan(plan) || plan.action.type !== 'hire') continue;
    for (const id of plan.hireUnits ?? []) if (!units.has(id)) units.set(id, { id, kind: plan.action.kind, planned: true, location: `Queued hire at ${gameClock(plan.executeAt)}` });
  }
  return [...units.values()];
}
