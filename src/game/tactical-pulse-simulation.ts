/**
 * ---
 * purpose: Exact finite wave contacts, King resistance, engine outages, mining outages, and sensor jamming.
 * related:
 *   - ./tactical-pulse.ts - state and balance
 *   - ./pulse-simulation.ts - shared expanding-circle solver
 * ---
 */
import type { Game, Fleet, Rock } from './simulation';
import { worldDistance, nearestImage } from './geometry';
import { fleetPosition, flightEndpoints, flightDeparture } from './flight';
import { afterWork, workBetween } from './opening-clock';
import { endPulse } from './pulse';
import { expandingIntersection } from './pulse-simulation';
import { completeTacticalCharges, reconcileTacticalCharges, tacticalConfig, tacticalStrength } from './tactical-pulse';
import { stationCourse } from './drift';
import { observers } from './sensors';

const EPS = 1e-9;
export function nextTacticalPulseEvent(game: Game, limit: number): number {
  const system = game.pulse?.tactical;
  if (!system) return limit;
  const config = tacticalConfig(game);
  let next = limit;
  for (const c of system.charges) next = Math.min(next, c.readyAt);
  for (const asset of [...game.rocks, ...game.fleets]) {
    const until = 'enginesDisabledUntil' in asset ? asset.enginesDisabledUntil : undefined;
    for (const time of [asset.sensorJammedUntil, until, 'miningDisabledUntil' in asset ? asset.miningDisabledUntil : undefined]) if (time !== undefined && time > game.hour) next = Math.min(next, time);
  }
  for (const until of Object.values(system.resistance)) if (until > game.hour) next = Math.min(next, until);
  for (const wave of system.waves) {
    next = Math.min(next, game.hour + Math.max(0, tacticalStrength(wave, config)) / config.attenuationPerDistance / config.propagationSpeed);
    for (const asset of [...game.rocks.filter(r => !r.destroyed && !wave.hitSites.includes(r.id)), ...game.fleets.filter(f => !wave.hitFleets.includes(f.id))]) {
      if (asset.owner && asset.owner !== wave.factionId) next = Math.min(next, expandingIntersection(game, wave.origin, wave.radius, config.propagationSpeed, asset, next));
    }
  }
  return next;
}
export function advanceTacticalPulseTime(game: Game, through: number): void {
  for (const wave of game.pulse?.tactical?.waves ?? []) wave.radius += (through - game.hour) * tacticalConfig(game).propagationSpeed;
}
function affectKing(game: Game, asset: Rock | Fleet, strength: number): void {
  const system = game.pulse!.tactical!, config = tacticalConfig(game);
  if (strength + EPS < config.chargeInterruptThreshold) return;
  for (const king of game.pulse!.kings) {
    if (king.factionId !== asset.owner || !asset.specialists?.some(u => u.id === king.kingId && !u.captive) || (system.resistance[king.kingId] ?? 0) > game.hour + EPS) continue;
    if (['charging', 'ready'].includes(king.state)) {
      endPulse(game, king);
      system.resistance[king.kingId] = game.hour + config.resistanceDuration;
      game.events.unshift({ hour: game.hour, audience: [king.factionId], message: 'A strong tactical pulse reset your King’s charge. Temporary resistance protects the next attempt.' });
    } else if (king.state === 'firing') {
      game.pulse!.modifiers.push({ type: 'pulse_speed', factionId: king.factionId, multiplier: config.strategicSlowMultiplier, expiresAt: game.hour + config.disruptionDuration });
      system.resistance[king.kingId] = game.hour + config.resistanceDuration;
      game.events.unshift({ hour: game.hour, audience: [king.factionId], message: 'A strong tactical pulse temporarily slowed your King’s wave. Emission continues.' });
    }
  }
}
function disableEngines(game: Game, fleet: Fleet): void {
  if (fleet.preparing || fleet.arrives <= game.hour + EPS) return;
  const config = tacticalConfig(game), until = game.hour + config.disruptionDuration;
  if ((fleet.enginesDisabledUntil ?? 0) >= until) return;
  const point = fleetPosition(game, fleet), destination = nearestImage(game, point, flightEndpoints(game, fleet).to);
  const remaining = workBetween(game, Math.max(game.hour, flightDeparture(fleet)), fleet.arrives);
  fleet.route = { from: point, to: destination };
  fleet.departed = game.hour;
  fleet.enginesDisabledUntil = until;
  fleet.arrives = afterWork(game, until, Math.max(1e-6, remaining));
  const target = game.rocks.find(r => r.id === fleet.to);
  if (target?.drift && !fleet.intercept) Object.assign(fleet, stationCourse(game, point, target, fleet.speed ?? 8, until));
}
export function settleTacticalPulses(game: Game): void {
  const system = game.pulse?.tactical;
  if (!system) return;
  reconcileTacticalCharges(game);
  completeTacticalCharges(game);
  const config = tacticalConfig(game);
  for (const wave of system.waves) {
    const strength = tacticalStrength(wave, config);
    if (strength <= EPS) continue;
    for (const asset of [...game.rocks.filter(r => !r.destroyed), ...game.fleets]) {
      if (!asset.owner || asset.owner === wave.factionId) continue;
      const rock = typeof asset.id === 'string' ? asset as Rock : undefined;
      if (rock ? wave.hitSites.includes(rock.id) : wave.hitFleets.includes((asset as Fleet).id)) continue;
      const point = rock ?? fleetPosition(game, asset as Fleet);
      if (Math.abs(worldDistance(game, wave.origin, point) - wave.radius) > 1e-6) continue;
      if (rock) wave.hitSites.push(rock.id); else wave.hitFleets.push((asset as Fleet).id);
      if (strength + EPS < config.communicationsJamThreshold) continue;
      const audience = [...new Set([asset.owner, ...observers(game, point)])];
      asset.sensorJammedUntil = Math.max(asset.sensorJammedUntil ?? 0, game.hour + config.disruptionDuration);
      if (strength + EPS >= config.miningDisableThreshold) {
        if (rock) {
          if (rock.kind === 'mine' && !rock.pulseDisabled) {
            const until = game.hour + config.disruptionDuration;
            rock.miningAt! += Math.max(0, until - Math.max(game.hour, rock.miningDisabledUntil ?? 0));
            rock.miningDisabledUntil = Math.max(rock.miningDisabledUntil ?? 0, until);
          }
          const shield = game.pulse!.shields[rock.id];
          if (shield) shield.energy = Math.max(0, shield.energy - config.shieldDamage);
        } else disableEngines(game, asset as Fleet);
      }
      affectKing(game, asset, strength);
      game.events.unshift({ hour: game.hour, audience, message: `${rock?.name ?? 'Hauler'}: ${strength + EPS >= config.miningDisableThreshold ? 'strong tactical disruption' : 'sensors temporarily jammed'}.` });
    }
  }
  system.waves = system.waves.filter(w => tacticalStrength(w, config) > EPS);
  for (const [id, until] of Object.entries(system.resistance)) if (until <= game.hour + EPS) delete system.resistance[id];
  for (const asset of [...game.rocks, ...game.fleets]) if ((asset.sensorJammedUntil ?? Infinity) <= game.hour + EPS) delete asset.sensorJammedUntil;
  for (const rock of game.rocks) if ((rock.miningDisabledUntil ?? Infinity) <= game.hour + EPS) delete rock.miningDisabledUntil;
  for (const fleet of game.fleets) if ((fleet.enginesDisabledUntil ?? Infinity) <= game.hour + EPS) {
    fleet.departed = fleet.enginesDisabledUntil!;
    delete fleet.enginesDisabledUntil;
  }
}
