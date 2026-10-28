/**
 * ---
 * purpose: Per-unit mine cadence and progress-preserving rate changes as territory expands or contracts.
 * ---
 */
import type { Faction, Game } from './simulation';
export const MINING_DAY = 24;
export function miningInterval(game: Pick<Game, 'rocks'>, owner: Faction): number {
  return MINING_DAY / Math.max(1, game.rocks.filter(r => r.owner === owner && !r.destroyed).length);
}
export function refreshMining(game: Game): void {
  if (game.version !== 2) return;
  for (const rock of game.rocks) {
    if (rock.kind !== 'mine' || !rock.owner || rock.destroyed) continue;
    const interval = miningInterval(game, rock.owner);
    const previous = rock.miningInterval ?? MINING_DAY;
    if (interval !== previous) rock.miningAt = game.hour + Math.max(0, (rock.miningAt! - game.hour) / previous) * interval;
    rock.miningInterval = interval;
  }
}
