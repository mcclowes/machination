/**
 * ---
 * purpose: Ordered specialist combat phase with simultaneous equal-priority effects and global combat bonuses.
 * ---
 */
import { returnHauler } from './specialist-travel';
import { detonate } from './destruction';
import { fleetPosition } from './flight';
import type { Fleet, Game, Rock } from './simulation';
import { restoreControl, unitCount } from './specialists';
import { mechanicsVersion } from './rules';
import { SPECIALISTS, type SpecialistKind } from './specialist-catalog';
import { snapshotPair, type EncounterStep } from './combat-report';
export type Combatant = Rock | Fleet;
export const combatUnits = (asset: Combatant) => (asset.specialists ?? []).filter(u => u.owner === asset.owner && !u.captive);
const count = (asset: Combatant, kind: string) => combatUnits(asset).filter(u => u.kind === kind).length;

export type CombatPhase = { suppressed: boolean; ended: boolean; redirected: Fleet[] };
type Phase = { game: Game; a: Combatant; b: Combatant; haulers: boolean; suppressed: boolean; redirected: Fleet[]; detonated?: boolean };
type Resolution = 'continue' | 'end';

// One resolver per catalog combat priority. Each reads both sides before writing, so equal priorities act simultaneously.
const RESOLVERS: Record<number, (phase: Phase) => Resolution> = {
  1: phase => {
    const { game, a, b } = phase;
    if (!count(a, 'martyr') && !count(b, 'martyr')) return 'continue';
    detonate(game, 'kind' in b ? b : fleetPosition(game, a as Fleet));
    phase.detonated = true;
    return 'end';
  },
  2: phase => { phase.suppressed = !!count(phase.a, 'elder') !== !!count(phase.b, 'elder'); return 'continue'; },
  // Revision 13 marks the opposing hauler; only a marked hauler that survives turns home. Earlier revisions divert and end.
  3: phase => {
    const { game, a, b, haulers } = phase;
    if (!haulers) return 'continue';
    phase.redirected = [...(count(b, 'saboteur') ? [a as Fleet] : []), ...(count(a, 'saboteur') ? [b as Fleet] : [])];
    if (!phase.redirected.length || mechanicsVersion(game) >= 13) return 'continue';
    for (const fleet of phase.redirected) returnHauler(game, fleet);
    phase.redirected = [];
    return 'end';
  },
  4: ({ a, b }) => {
    const stolenA = !('kind' in a) && count(a, 'thief') ? Math.min(b.drones, Math.ceil(b.drones * 0.15) * count(a, 'thief')) : 0;
    const stolenB = !('kind' in b) && count(b, 'thief') ? Math.min(a.drones, Math.ceil(a.drones * 0.15) * count(b, 'thief')) : 0;
    a.drones += stolenA - stolenB; b.drones += stolenB - stolenA;
    return 'continue';
  },
  5: ({ a, b, haulers }) => {
    if ('kind' in b && count(a, 'infiltrator')) b.shield = 0;
    return haulers && (count(a, 'infiltrator') || count(b, 'infiltrator')) ? 'end' : 'continue';
  },
  6: ({ game, a, b, haulers }) => {
    if (!haulers || !count(a, 'doubleAgent') && !count(b, 'doubleAgent')) return 'continue';
    const owner = a.owner; a.owner = b.owner; b.owner = owner; a.drones = 0; b.drones = 0;
    for (const asset of [a, b]) for (const unit of asset.specialists ?? []) restoreControl(game, unit, asset.owner!, asset.specialists);
    game.fleets = game.fleets.filter(f => f.drones > 0 || f.specialists?.length);
    return 'end';
  },
  7: ({ a, b }) => {
    const killA = count(a, 'assassin') > 0; const killB = count(b, 'assassin') > 0;
    if (killA) b.specialists = (b.specialists ?? []).filter(u => u.owner === a.owner);
    if (killB) a.specialists = (a.specialists ?? []).filter(u => u.owner === b.owner);
    return 'continue';
  },
  8: ({ a, b }) => {
    const damageA = 5 * count(a, 'lieutenant') + 20 * count(a, 'warHero');
    const damageB = 5 * count(b, 'lieutenant') + 20 * count(b, 'warHero');
    a.drones = Math.max(0, a.drones - damageB); b.drones = Math.max(0, b.drones - damageA);
    return 'continue';
  },
};

export const COMBAT_PRIORITIES: readonly number[] = [...new Set(Object.values(SPECIALISTS).flatMap(d => 'priority' in d ? [d.priority] : []))].sort((x, y) => x - y);
for (const priority of new Set([...COMBAT_PRIORITIES, ...Object.keys(RESOLVERS).map(Number)])) {
  if (!COMBAT_PRIORITIES.includes(priority) || !RESOLVERS[priority]) throw new Error(`Combat priority ${priority} needs both a catalog specialist and a resolver.`);
}
const ELDER_PRIORITY = SPECIALISTS.elder.priority;
const KINDS_BY_PRIORITY = new Map(COMBAT_PRIORITIES.map(p => [p, (Object.keys(SPECIALISTS) as SpecialistKind[]).filter(k => (SPECIALISTS[k] as { priority?: number }).priority === p)]));
const actingKinds = (a: Combatant, b: Combatant, priority: number) => KINDS_BY_PRIORITY.get(priority)!.filter(k => count(a, k) || count(b, k));

// Steps, when supplied, receive snapshots around each resolver with an acting specialist; rules are unchanged.
export function applyCombatAbilities(game: Game, a: Combatant, b: Combatant, steps?: EncounterStep[]): CombatPhase {
  const phase: Phase = { game, a, b, haulers: !('kind' in a) && !('kind' in b), suppressed: false, redirected: [] };
  for (const priority of COMBAT_PRIORITIES) {
    if (priority > ELDER_PRIORITY && phase.suppressed) break;
    const kinds = steps ? actingKinds(a, b, priority) : [];
    const before = kinds.length ? snapshotPair(a, b) : undefined;
    const resolution = RESOLVERS[priority]!(phase);
    if (before) steps!.push(Object.freeze({ type: 'ability', priority, kinds: Object.freeze(kinds), ended: resolution === 'end', before, after: snapshotPair(a, b) }));
    if (resolution === 'continue') continue;
    if (phase.detonated) return { suppressed: false, ended: true, redirected: [] };
    for (const fleet of phase.redirected) if (game.fleets.includes(fleet)) returnHauler(game, fleet);
    return { suppressed: phase.suppressed, ended: true, redirected: [] };
  }
  const generalsA = a.owner && combatUnits(a).length ? unitCount(game, a.owner, 'general') * 10 : 0;
  const generalsB = b.owner && combatUnits(b).length ? unitCount(game, b.owner, 'general') * 10 : 0;
  const kingA = a.owner && unitCount(game, a.owner, 'king') > 0 ? Math.floor(a.drones / 4) : 0;
  const kingB = b.owner && unitCount(game, b.owner, 'king') > 0 ? Math.floor(b.drones / 4) : 0;
  const before = steps && (generalsA || generalsB || kingA || kingB) ? snapshotPair(a, b) : undefined;
  a.drones = Math.max(0, a.drones - generalsB - kingB); b.drones = Math.max(0, b.drones - generalsA - kingA);
  if (before) steps!.push(Object.freeze({ type: 'global', generals: Object.freeze([generalsB, generalsA] as const), king: Object.freeze([kingB, kingA] as const), before, after: snapshotPair(a, b) }));
  return { suppressed: phase.suppressed, ended: false, redirected: phase.redirected };
}
