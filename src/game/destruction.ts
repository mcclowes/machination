/**
 * ---
 * purpose: Area destruction that preserves chart locations while removing sites, manifests, and specialists.
 * ---
 */
import { compactAllows } from './compact';
import { mechanicsVersion } from './rules';
import { worldDistance } from './geometry';
import type { Game } from './simulation';
import type { Point } from './flight';
import { fleetPosition } from './flight';
import { ROCK_SENSOR_RANGE, observers } from './sensors';

export function detonate(game: Game, point: Point): void {
  if (!compactAllows(game, 'weapons')) throw new Error('Strategic weapons interlocks are active under the Belt compact.');
  const radius = ROCK_SENSOR_RANGE * 0.2;
  const affected = game.rocks.filter(r => worldDistance(game, r, point) <= radius);
  const hit = game.fleets.filter(f => { const p = fleetPosition(game, f); return worldDistance(game, p, point) <= radius; });
  const audience = [...new Set([...observers(game, point), ...affected.flatMap(r => r.owner ? [r.owner] : []), ...hit.map(f => f.owner)])];
  for (const rock of affected) {
    if (mechanicsVersion(game) < 2) {
      if (rock.kind === 'mine' && rock.owner) game.cargo[rock.owner] = (game.cargo[rock.owner] ?? 0) * 0.8;
      rock.owner = null;
    }
    if (compactAllows(game, 'infrastructure')) rock.destroyed = true; rock.drones = 0; rock.shield = 0; rock.specialists = [];
    delete rock.coreOf; delete rock.module;
  }
  game.fleets = game.fleets.filter(f => !hit.includes(f));
  game.events.unshift({ hour: game.hour, audience, battle: { x: point.x, y: point.y }, message: `Self-destruct detonation ${compactAllows(game, 'infrastructure') ? 'destroyed' : 'cleared garrisons at'} ${affected.length} sites and ${hit.length} haulers within ${radius} chart units.` });
}
