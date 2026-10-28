/**
 * ---
 * purpose: Area destruction that preserves chart locations while removing sites, manifests, and specialists.
 * ---
 */
import type { Game } from './simulation';
import type { Point } from './flight';
import { fleetPosition } from './flight';
import { ROCK_SENSOR_RANGE, observers } from './sensors';

export function detonate(game: Game, point: Point): void {
  const radius = ROCK_SENSOR_RANGE * 0.2;
  const affected = game.rocks.filter(r => Math.hypot(r.x - point.x, r.y - point.y) <= radius);
  const hit = game.fleets.filter(f => { const p = fleetPosition(game, f); return Math.hypot(p.x - point.x, p.y - point.y) <= radius; });
  const audience = [...new Set([...observers(game, point), ...affected.flatMap(r => r.owner ? [r.owner] : []), ...hit.map(f => f.owner)])];
  for (const rock of affected) {
    if (rock.kind === 'mine' && rock.owner) game.cargo[rock.owner] *= 0.8;
    rock.destroyed = true; rock.owner = null; rock.drones = 0; rock.shield = 0; rock.specialists = [];
    delete rock.coreOf; delete rock.module;
  }
  game.fleets = game.fleets.filter(f => !hit.includes(f));
  game.events.unshift({ hour: game.hour, audience, message: `Self-destruct detonation destroyed ${affected.length} sites and ${hit.length} haulers within ${radius} chart units.` });
}
