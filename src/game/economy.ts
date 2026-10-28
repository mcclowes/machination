/**
 * ---
 * purpose: Industry cycles, power capacity, mining construction, and shield recharge for version-two operations.
 * ---
 */
import type { Faction, Game, Rock } from './simulation';
import { fundingCount, reconcileFunding, FUNDING_OUTPUT, FUNDING_POWER } from './funding';
import { miningInterval, MINING_DAY } from './mining';
import { unitCount, unitsAtRock } from './specialists';
import { rockSensorRange, observers } from './sensors';
import { recentEvents } from './events';

export const FACTORY_CYCLE = 8;
export const FACTORY_OUTPUT = 6;
export const SHIELD_RECHARGE = 48;
export const MINING_TARGET = 200;
export function cargoTarget(game: { version?: number }): number { return game.version === 2 ? MINING_TARGET : 300; }
export function droneInventory(game: Pick<Game, 'rocks' | 'fleets'>, owner: Faction): number {
  return game.rocks.filter(r => r.owner === owner).reduce((n, r) => n + r.drones, 0) + game.fleets.filter(f => f.owner === owner).reduce((n, f) => n + f.drones, 0);
}
export function powerCapacity(game: Pick<Game, 'rocks' | 'fleets' | 'funding'>, owner: Faction): number {
  return 150 * Math.min(1, unitCount(game, owner, 'queen')) + FUNDING_POWER * fundingCount(game, owner) + 50 * game.rocks.filter(r => r.owner === owner && r.kind === 'generator').length + 300 * unitCount(game, owner, 'energy')
    + game.rocks.filter(r => r.owner === owner).reduce((n, rock) => n + 3 * maximumShield(rock) * unitsAtRock(game, rock.id).filter(u => u.owner === owner && u.kind === 'tinkerer').length, 0);
}
export function maximumShield(rock: Rock): number { return Math.max(0, (rock.shieldMax ?? 0) + (rock.coreOf && rock.owner === rock.coreOf ? 20 : 0) + (rock.shieldBonus ?? 0)); }
export function mineCost(game: Pick<Game, 'minesDrilled'>, owner: Faction): number {
  const built = game.minesDrilled?.[owner] ?? 0;
  return built === 0 ? 50 : built * 100;
}
export function drillMine(game: Game, id: string, owner: Faction): Game {
  if (game.version !== 2 || game.winner || game.draw || game.eliminated.includes(owner)) throw new Error('Mine construction is unavailable in this operation.');
  const rock = game.rocks.find(r => r.id === id);
  if (!rock || rock.owner !== owner || !['factory', 'generator'].includes(rock.kind)) throw new Error('Choose a controlled factory or generator.');
  const cost = mineCost(game, owner);
  if (rock.drones < cost) throw new Error(`This mine needs ${cost} drones on station.`);
  return { ...game, minesDrilled: { ...game.minesDrilled!, [owner]: game.minesDrilled![owner] + 1 },
    rocks: game.rocks.map(r => r.id === id ? { ...r, kind: 'mine', drones: r.drones - cost, miningAt: game.hour + miningInterval(game, owner), miningInterval: miningInterval(game, owner) } : r),
    events: recentEvents([{ hour: game.hour, audience: observers(game, rock), message: `${rock.name}: mine drilled for ${cost} drones.` }, ...game.events]),
  };
}
export function setShields(game: Game, id: string, owner: Faction, disabled: boolean): Game {
  if (game.version !== 2 || game.winner || game.draw || game.eliminated.includes(owner)) throw new Error('Shield controls are unavailable in this operation.');
  const rock = game.rocks.find(r => r.id === id);
  if (!rock || rock.owner !== owner || typeof disabled !== 'boolean') throw new Error('Choose a controlled rock and a shield state.');
  return { ...game, rocks: game.rocks.map(r => r.id === id ? { ...r, shieldsDisabled: disabled } : r),
    events: recentEvents([{ hour: game.hour, audience: observers(game, rock), message: `${rock.name}: shields ${disabled ? 'disabled' : 'enabled'}.` }, ...game.events]),
  };
}
export function absorbShields(game: Game, rock: Rock, attackers: number): number {
  if (rock.shieldsDisabled || !rock.owner) return attackers;
  const absorbed = Math.min(rock.shield ?? 0, attackers);
  const max = maximumShield(rock);
  if (absorbed && rock.shield! >= max) rock.shieldAt = game.hour + SHIELD_RECHARGE / max;
  rock.shield = (rock.shield ?? 0) - absorbed;
  return attackers - absorbed;
}
export function nextEconomyEvent(game: Game): number {
  return Math.min(...game.rocks.filter(r => r.owner).flatMap(r => [r.kind === 'factory' ? r.productionAt ?? Infinity : Infinity, r.kind === 'mine' ? r.miningAt ?? Infinity : Infinity, (r.shield ?? 0) < maximumShield(r) ? r.shieldAt ?? Infinity : Infinity]));
}
export function settleEconomy(game: Game): void {
  for (const rock of game.rocks) if (rock.owner && rock.kind === 'mine' && rock.miningAt! <= game.hour + 1e-9) {
    if (!game.eliminated.includes(rock.owner)) game.cargo[rock.owner] += 1;
    rock.miningAt = game.hour + (rock.miningInterval ?? MINING_DAY);
  }
  reconcileFunding(game);
  for (const rock of game.rocks) {
    if (!rock.owner) continue;
    const max = maximumShield(rock);
    if ((rock.shield ?? 0) < max && rock.shieldAt! <= game.hour + 1e-9) {
      rock.shield = (rock.shield ?? 0) + 1;
      rock.shieldAt = game.hour + SHIELD_RECHARGE / max;
    }
    if (rock.kind === 'factory' && rock.productionAt! <= game.hour + 1e-9) {
      const foremen = game.rocks.filter(r => r.owner === rock.owner && Math.hypot(r.x - rock.x, r.y - rock.y) <= rockSensorRange(game, r) / 2).reduce((n, r) => n + unitsAtRock(game, r.id).filter(u => u.owner === rock.owner && u.kind === 'foreman').length, 0);
      const localTycoons = unitsAtRock(game, rock.id).filter(u => u.owner === rock.owner && u.kind === 'tycoon').length;
      const output = Math.max(0, FACTORY_OUTPUT + FUNDING_OUTPUT * fundingCount(game, rock.owner) + 4 * foremen + 3 * localTycoons - unitCount(game, rock.owner, 'energy'));
      rock.drones += Math.max(0, Math.min(output, powerCapacity(game, rock.owner) - droneInventory(game, rock.owner)));
      rock.productionAt = game.hour + (rock.productionInterval ?? FACTORY_CYCLE);
    }
  }
}
