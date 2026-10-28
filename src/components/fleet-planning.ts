/** Fleet references that remain addressable when a forecast order executes. */
import type { Faction } from '../game/simulation';
import type { GameView } from '../game/visibility';

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
