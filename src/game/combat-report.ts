/**
 * ---
 * purpose: Immutable encounter reports captured from the real combat resolvers for observation-bound forecasts.
 * ---
 */
import type { Faction } from './players';
import type { SpecialistKind } from './specialist-catalog';
import type { Fleet, Rock } from './simulation';

export type EncounterKind = 'arrival' | 'route' | 'interception' | 'gift';
export type EncounterAssetId = Readonly<{ type: 'site'; id: string } | { type: 'hauler'; id: number }>;
export type EncounterSpecialist = Readonly<{ id: string; kind: SpecialistKind; owner: Faction; captive: boolean }>;
export type EncounterAsset = Readonly<{
  asset: EncounterAssetId; owner: Faction | null; drones: number;
  shield?: number; destroyed?: true; returning?: true;
  specialists: readonly EncounterSpecialist[];
}>;
export type EncounterPair = readonly [EncounterAsset, EncounterAsset];
export type EncounterAbilityStep = Readonly<{ type: 'ability'; priority: number; kinds: readonly SpecialistKind[]; ended: boolean; before: EncounterPair; after: EncounterPair }>;
// Nominal damage to side i; before/after pairs retain the actual clipped effect.
export type EncounterGlobalStep = Readonly<{ type: 'global'; generals: readonly [number, number]; king: readonly [number, number]; before: EncounterPair; after: EncounterPair }>;
export type EncounterStep = EncounterAbilityStep | EncounterGlobalStep;
export type EncounterOutcome = 'captured' | 'held' | 'won' | 'tie' | 'ended' | 'transferred' | 'returned';
export type EncounterReport = Readonly<{
  kind: EncounterKind; hour: number; site?: string;
  before: EncounterPair;
  reinforcement?: Readonly<{ haulers: readonly EncounterAsset[]; site: EncounterAsset }>;
  steps: readonly EncounterStep[];
  suppressed: boolean;
  shield?: Readonly<{ before: number; absorbed: number; after: number }>;
  winner?: 0 | 1;
  repaired: number;
  captured: readonly string[];
  outcome: EncounterOutcome;
  after: readonly [EncounterAsset | null, EncounterAsset | null];
}>;
export type EncounterSink = (report: EncounterReport) => void;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export type EncounterDraft = Mutable<Omit<EncounterReport, 'steps' | 'captured'>> & { steps: EncounterStep[]; captured: string[] };

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
export function snapshotAsset(asset: Rock | Fleet): EncounterAsset {
  const specialists = (asset.specialists ?? []).map(u => ({ id: u.id, kind: u.kind, owner: u.owner, captive: !!u.captive }));
  if (typeof asset.id === 'string') {
    const rock = asset as Rock;
    return freeze({ asset: { type: 'site', id: rock.id }, owner: rock.owner, drones: rock.drones, shield: rock.shield ?? 0, ...(rock.destroyed ? { destroyed: true as const } : {}), specialists });
  }
  const fleet = asset as Fleet;
  return freeze({ asset: { type: 'hauler', id: fleet.id }, owner: fleet.owner, drones: fleet.drones, ...(fleet.returning ? { returning: true as const } : {}), specialists });
}
export function snapshotPair(a: Rock | Fleet, b: Rock | Fleet): EncounterPair {
  return freeze([snapshotAsset(a), snapshotAsset(b)] as const);
}
export function startEncounter(kind: EncounterKind, hour: number, a: Rock | Fleet, b: Rock | Fleet): EncounterDraft {
  return { kind, hour, before: snapshotPair(a, b), steps: [], suppressed: false, repaired: 0, captured: [], outcome: 'ended', after: [null, null] };
}
export function emitEncounter(sink: EncounterSink, draft: EncounterDraft): void {
  sink(freeze({ ...draft, steps: [...draft.steps], captured: [...draft.captured], after: [...draft.after] as const }));
}
