/**
 * ---
 * purpose: Ordered specialist combat phase with simultaneous equal-priority effects and global combat bonuses.
 * ---
 */
import { returnHauler } from './specialist-travel';
import { detonate } from './destruction';
import { fleetPosition } from './flight';
import type { Fleet, Game, Rock } from './simulation';
import { unitCount } from './specialists';
export type Combatant = Rock | Fleet;
export const combatUnits = (asset: Combatant) => (asset.specialists ?? []).filter(u => u.owner === asset.owner && !u.captive);
const count = (asset: Combatant, kind: string) => combatUnits(asset).filter(u => u.kind === kind).length;

export function applyCombatAbilities(game: Game, a: Combatant, b: Combatant): { suppressed: boolean; ended: boolean } {
  if (count(a, 'martyr') || count(b, 'martyr')) { detonate(game, 'kind' in b ? b : fleetPosition(game, a as Fleet)); return { suppressed: false, ended: true }; }
  const suppressed = !!count(a, 'elder') !== !!count(b, 'elder');
  if (!suppressed) {
    const haulers = !('kind' in a) && !('kind' in b);
    if (haulers && (count(a, 'saboteur') || count(b, 'saboteur'))) {
      const redirectA = count(b, 'saboteur'); const redirectB = count(a, 'saboteur');
      if (redirectA) returnHauler(game, a as Fleet);
      if (redirectB) returnHauler(game, b as Fleet);
      return { suppressed, ended: true };
    }
    const stolenA = !('kind' in a) && count(a, 'thief') ? Math.min(b.drones, Math.ceil(b.drones * 0.15) * count(a, 'thief')) : 0;
    const stolenB = !('kind' in b) && count(b, 'thief') ? Math.min(a.drones, Math.ceil(a.drones * 0.15) * count(b, 'thief')) : 0;
    a.drones += stolenA - stolenB; b.drones += stolenB - stolenA;
    if ('kind' in b && count(a, 'infiltrator')) b.shield = 0;
    if (haulers && (count(a, 'infiltrator') || count(b, 'infiltrator'))) return { suppressed, ended: true };
    if (haulers && (count(a, 'doubleAgent') || count(b, 'doubleAgent'))) {
      const owner = a.owner; a.owner = b.owner; b.owner = owner; a.drones = 0; b.drones = 0;
      for (const asset of [a, b]) for (const unit of asset.specialists ?? []) { if (unit.kind === 'queen' && unit.owner !== asset.owner) unit.kind = 'princess'; unit.owner = asset.owner!; delete unit.captive; }
      game.fleets = game.fleets.filter(f => f.drones > 0 || f.specialists?.length);
      return { suppressed, ended: true };
    }
    const killA = count(a, 'assassin') > 0; const killB = count(b, 'assassin') > 0;
    if (killA) b.specialists = (b.specialists ?? []).filter(u => u.owner === a.owner);
    if (killB) a.specialists = (a.specialists ?? []).filter(u => u.owner === b.owner);
    const damageA = 5 * count(a, 'lieutenant') + 20 * count(a, 'warHero');
    const damageB = 5 * count(b, 'lieutenant') + 20 * count(b, 'warHero');
    a.drones = Math.max(0, a.drones - damageB); b.drones = Math.max(0, b.drones - damageA);
  }
  const generalsA = a.owner && combatUnits(a).length ? unitCount(game, a.owner, 'general') * 10 : 0;
  const generalsB = b.owner && combatUnits(b).length ? unitCount(game, b.owner, 'general') * 10 : 0;
  const kingA = a.owner && unitCount(game, a.owner, 'king') > 0 ? Math.floor(a.drones / 4) : 0;
  const kingB = b.owner && unitCount(game, b.owner, 'king') > 0 ? Math.floor(b.drones / 4) : 0;
  a.drones = Math.max(0, a.drones - generalsB - kingB); b.drones = Math.max(0, b.drones - generalsA - kingA);
  return { suppressed, ended: false };
}
