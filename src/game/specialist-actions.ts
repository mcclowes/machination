/**
 * ---
 * purpose: Timed sentry fire and capacitor drain at exact event boundaries, independent of polling.
 * ---
 */
import { isDue } from './event-timing';
import { tracePoint, type SimulationTraceSink } from './simulation-trace';
import { worldDistance } from './geometry';
import type { Game } from './simulation';
import { unitsAtRock } from './specialists';
import { maximumShield } from './economy';
import { rockSensorRange, observers } from './sensors';
import { fleetPosition } from './flight';
import { sendUnitsHome } from './specialist-travel';

export function nextSpecialistEvent(game: Game): number {
  return Math.min(...game.rocks.filter(r => r.owner).flatMap(r => unitsAtRock(game, r.id).filter(u => u.owner === r.owner && (u.kind === 'sentry' || u.kind === 'tinkerer')).map(u => u.nextActionAt ?? Infinity)));
}
export function settleSpecialistActions(game: Game, trace?: SimulationTraceSink): void {
  for (const rock of game.rocks) for (const unit of unitsAtRock(game, rock.id)) {
    if (!rock.owner || unit.owner !== rock.owner || unit.nextActionAt === undefined || !isDue(game, unit.nextActionAt)) continue;
    try {
      if (unit.kind === 'tinkerer') {
        if ((rock.shield ?? 0) >= maximumShield(rock) && maximumShield(rock) > 0) rock.shieldAt = game.hour + 48 / maximumShield(rock);
        rock.shield = Math.max(0, (rock.shield ?? 0) - 1);
        unit.nextActionAt = game.hour + 1 / 3;
      }
      if (unit.kind === 'sentry') {
        unit.nextActionAt = game.hour + 2;
        const target = game.fleets.filter(f => f.owner !== unit.owner && !f.preparing && f.drones > 0 && worldDistance(game, fleetPosition(game, f), rock) <= rockSensorRange(game, rock) / 2)
          .sort((a, b) => b.drones - a.drones || a.id - b.id)[0];
        if (!target) continue;
        const damage = Math.ceil(target.drones * 0.05);
        target.drones -= damage;
        game.events.unshift({ hour: game.hour, audience: [...new Set([unit.owner, target.owner, ...observers(game, fleetPosition(game, target))])], message: `${rock.name}: sentry fire destroyed ${damage} drones.` });
        game.fleets = game.fleets.filter(f => f.drones > 0 || f.specialists?.length);
      }
    } finally { tracePoint(trace, 'timed-ability', game); }
  }
}
export function applyStationPassives(game: Game, trace?: SimulationTraceSink): void {
  for (const rock of game.rocks) {
    if (!rock.owner) continue;
    if (unitsAtRock(game, rock.id).some(u => u.owner === rock.owner && u.kind === 'hypnotist')) {
      for (const unit of rock.specialists ?? []) if (unit.captive) {
        if (unit.kind === 'queen' && unit.owner !== rock.owner) unit.kind = 'princess';
        unit.owner = rock.owner; delete unit.captive;
        tracePoint(trace, 'passive:hypnotist', game);
      }
    }
  }
  for (const rock of game.rocks) {
    if (!rock.owner || !unitsAtRock(game, rock.id).some(u => u.owner === rock.owner && u.kind === 'diplomat')) continue;
    for (const holding of game.rocks) {
      if (worldDistance(game, holding, rock) > rockSensorRange(game, rock)) continue;
      for (const unit of [...(holding.specialists ?? [])]) if (unit.owner === rock.owner && unit.captive && game.rocks.some(r => r.owner === unit.owner && !r.destroyed)) {
        holding.specialists = holding.specialists!.filter(u => u.id !== unit.id);
        delete unit.captive;
        sendUnitsHome(game, holding, unit.owner, [unit]);
        game.events.unshift({ hour: game.hour, audience: [...new Set([unit.owner, ...(holding.owner ? [holding.owner] : [])])], message: `${holding.name}: envoy protocol released a captive module.` });
        tracePoint(trace, 'passive:diplomat', game);
      }
    }
  }
  tracePoint(trace, 'passives', game);
}
