/** Launch eligibility and stable fleet references shared by live and forecast planning. */
import type { Faction } from '../game/simulation';
import type { GameView, ObservedRock } from '../game/visibility';
import { MAX_PLAN_DELAY } from '../game/orders';

export function launchBlockReason({ game, owner, source, target, liveHour, executeAt, drones, units, unavailable }: {
  game: GameView; owner: Faction; source?: ObservedRock; target?: ObservedRock;
  liveHour: number; executeAt: number; drones: number; units: number; unavailable?: string;
}): string | undefined {
  if (unavailable) return unavailable;
  if (game.winner || game.draw || game.eliminated.includes(owner)) return 'This intelligence is no longer operational at the selected time.';
  if (!source || source.owner !== owner) return 'Choose a departure site you control at the selected time.';
  if (source.destroyed || target?.destroyed) return 'Destroyed sites cannot send or receive haulers.';
  if (!target || target.id === source.id) return 'Choose a different destination on the chart.';
  if (!Number.isFinite(executeAt) || executeAt > liveHour + MAX_PLAN_DELAY) return 'Choose a launch within seven days of now.';
  if (!Number.isSafeInteger(drones) || drones < (units ? 0 : 1)) return units ? 'Enter a whole number of drones, at least zero.' : 'Send at least one drone or select a specialist.';
  if (executeAt <= liveHour && drones > Math.floor(source.drones ?? 0)) return 'Not enough drones on site. Reduce the manifest or choose a future launch time.';
}

export function futureCommandFleets(forecast: Pick<GameView, 'fleets'>, live: Pick<GameView, 'fleets' | 'scheduled'>, owner: Faction) {
  const ids = new Set(live.fleets.filter(f => f.owner === owner).map(f => f.id));
  for (const plan of live.scheduled) {
    if (plan.owner === owner && 'fleetId' in plan && typeof plan.fleetId === 'number') ids.add(plan.fleetId);
  }
  return forecast.fleets.filter(f => f.owner === owner && ids.has(f.id));
}

export function observedInterceptionIds(live: Pick<GameView, 'fleets'>, owner: Faction): readonly number[] {
  return live.fleets.filter(f => f.owner !== owner).map(f => f.id);
}
