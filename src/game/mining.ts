/**
 * ---
 * purpose: Per-unit mine cadence and progress-preserving rate changes as territory expands or contracts.
 * ---
 */
import { mechanicsVersion } from './rules';
import { hasReserves } from './depletion';
import type { Faction, Game } from './simulation';
export const MINING_DAY = 24;
export function miningInterval(game: Pick<Game, 'rocks'>, owner: Faction): number {
  return MINING_DAY / Math.max(1, game.rocks.filter(r => r.owner === owner && !r.destroyed && hasReserves(r)).length);
}
export function refreshMining(game: Game): void {
  if (game.version !== 2) return;
  for (const rock of game.rocks) {
    if (rock.kind !== 'mine' || !rock.owner || rock.destroyed) continue;
    const interval = miningInterval(game, rock.owner);
    const previous = rock.miningInterval ?? MINING_DAY;
    if (interval !== previous) {
      const resumes = Math.max(game.hour, rock.miningDisabledUntil ?? 0, rock.stasisUntil ?? 0);
      rock.miningAt = resumes + Math.max(0, (rock.miningAt! - resumes) / previous) * interval;
    }
    rock.miningInterval = interval;
  }
}

export function loseMine(game: Game, owner: Faction): void {
  const cargo = game.cargo[owner] ?? 0;
  game.cargo[owner] = mechanicsVersion(game) >= 2 ? Math.floor(cargo * 4 / 5) : cargo * 0.8;
}
