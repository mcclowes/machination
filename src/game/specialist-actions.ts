/**
 * ---
 * purpose: Timed sentry fire and capacitor drain at exact event boundaries, independent of polling.
 * ---
 */
import { afterWork } from './opening-clock';
import { siteRangeWindows } from './drift';
import { isDue } from './event-timing';
import { tracePoint, type SimulationTraceSink } from './simulation-trace';
import { worldDistance } from './geometry';
import type { Game } from './simulation';
import { restoreControl, unitsAtRock } from './specialists';
import { maximumShield } from './economy';
import { rockSensorRange, observers } from './sensors';
import { fleetPosition } from './flight';
import { sendUnitsHome } from './specialist-travel';

export function nextSpecialistEvent(game: Game): number {
  const contacts: number[] = [];
  for (const rock of game.rocks) {
    if (!rock.owner || !unitsAtRock(game, rock.id).some(u => u.owner === rock.owner && u.kind === 'diplomat')) continue;
    for (const holding of game.rocks) {
      if ((!rock.drift && !holding.drift) || !holding.specialists?.some(u => u.owner === rock.owner && u.captive)) continue;
      contacts.push(...siteRangeWindows(game, rock, holding, rockSensorRange(game, rock)).map(w => w.from).filter(hour => hour > game.hour && hour <= game.hour + 1));
    }
  }
  return Math.min(...contacts, ...game.rocks.filter(r => r.owner).flatMap(r => unitsAtRock(game, r.id).filter(u => u.owner === r.owner && (u.kind === 'sentry' || u.kind === 'tinkerer')).map(u => u.nextActionAt ?? Infinity)));
}
export function settleSpecialistActions(game: Game, trace?: SimulationTraceSink): void {
  for (const rock of game.rocks) for (const unit of unitsAtRock(game, rock.id)) {
    if (!rock.owner || unit.owner !== rock.owner || unit.nextActionAt === undefined || !isDue(game, unit.nextActionAt)) continue;
    try {
      if (unit.kind === 'tinkerer') {
        if ((rock.shield ?? 0) >= maximumShield(rock) && maximumShield(rock) > 0) rock.shieldAt = afterWork(game, game.hour, 48 / maximumShield(rock));
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
        restoreControl(game, unit, rock.owner);
        tracePoint(trace, 'passive:hypnotist', game);
      }
    }
  }
  for (const rock of game.rocks) {
    if (!rock.owner || !unitsAtRock(game, rock.id).some(u => u.owner === rock.owner && u.kind === 'diplomat')) continue;
    for (const holding of game.rocks) {
      const inRange = rock.drift || holding.drift
        ? siteRangeWindows(game, rock, holding, rockSensorRange(game, rock)).some(w => game.hour >= w.from && game.hour <= w.through)
        : worldDistance(game, holding, rock) <= rockSensorRange(game, rock);
      if (!inRange) continue;
      for (const unit of [...(holding.specialists ?? [])]) if (unit.owner === rock.owner && unit.captive && game.rocks.some(r => r.owner === unit.owner && !r.destroyed)) {
        holding.specialists = holding.specialists!.filter(u => u.id !== unit.id);
        restoreControl(game, unit, unit.owner);
        sendUnitsHome(game, holding, unit.owner, [unit]);
        game.events.unshift({ hour: game.hour, audience: [...new Set([unit.owner, ...(holding.owner ? [holding.owner] : [])])], message: `${holding.name}: envoy protocol released a captive module.` });
        tracePoint(trace, 'passive:diplomat', game);
      }
    }
  }
  tracePoint(trace, 'passives', game);
}
