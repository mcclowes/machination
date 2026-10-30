/**
 * ---
 * purpose: Exact pulse intersections, continuous shield energy, persistent hazards, and simultaneous King elimination.
 * related:
 *   - ./pulse.ts - state and balancing
 * ---
 */
import { nextTacticalPulseEvent, advanceTacticalPulseTime, settleTacticalPulses } from './tactical-pulse-simulation';
import { reconcileFunding } from './funding';
import type { Fleet, Game, Rock } from './simulation';
import { mapOffsets, worldDistance, type Point } from './geometry';
import { fleetPosition, flightEndpoints, flightDeparture } from './flight';
import { sitePosition } from './drift';
import { openingRate, OPENING_HOURS, workBetween } from './opening-clock';
import { playersIn } from './players';
import { observers } from './sensors';
import { pulseConfig, pulseRate, reconcilePulseKings, type ActivePulse } from './pulse';

const EPS = 1e-9;
type Motion = { point: Point; velocity: Point };
function motion(game: Game, asset: Rock | Fleet): Motion {
  if (typeof asset.id === 'string') { const rock = asset as Rock; return { point: sitePosition(game, rock, game.hour), velocity: rock.drift?.velocity ?? { x: 0, y: 0 } }; }
  const fleet = asset as Fleet;
  if (fleet.preparing) return motion(game, game.rocks.find(r => r.id === fleet.from)!);
  if ((fleet.enginesDisabledUntil ?? 0) > game.hour) return { point: fleetPosition(game, fleet), velocity: { x: 0, y: 0 } };
  const leg = flightEndpoints(game, fleet), duration = workBetween(game, flightDeparture(fleet), fleet.arrives), rate = openingRate(game, game.hour);
  return { point: fleetPosition(game, fleet), velocity: { x: (leg.to.x - leg.from.x) / duration * rate, y: (leg.to.y - leg.from.y) / duration * rate } };
}
const hostile = (pulse: ActivePulse, owner: Rock['owner']) => !!owner && pulse.factionId !== owner;
function covers(game: Game, pulse: ActivePulse, point: Point): boolean { return worldDistance(game, pulse.origin, point) <= pulse.radius + EPS; }
function exposures(game: Game, rock: Rock): number {
  const moving = motion(game, rock), dt = 1e-7;
  return game.pulse!.pulses.filter(p => {
    if (!hostile(p, rock.owner)) return false;
    const distance = worldDistance(game, p.origin, moving.point);
    if (Math.abs(distance - p.radius) > EPS) return distance < p.radius;
    // At an exact boundary, the following interval determines energy drain.
    return worldDistance(game, p.origin, { x: moving.point.x + moving.velocity.x * dt, y: moving.point.y + moving.velocity.y * dt }) <= p.radius + pulseConfig(game).propagationSpeed * pulseRate(game, p.factionId, 'pulse_speed') * dt + EPS;
  }).length;
}
/** Earliest entry or exit of a linearly moving target and an expanding circle, over toroidal images. */
export function expandingIntersection(game: Game, origin: Point, radius: number, speed: number, asset: Rock | Fleet, limit: number): number {
  const { point, velocity: v } = motion(game, asset);
  let next = Infinity;
  for (const offset of mapOffsets(game)) {
    const x = point.x + offset.x - origin.x, y = point.y + offset.y - origin.y;
    const a = v.x * v.x + v.y * v.y - speed * speed, b = 2 * (x * v.x + y * v.y - radius * speed), c = x * x + y * y - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) continue;
    const q = -.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant));
    const roots = Math.abs(a) < 1e-12 ? b ? [-c / b] : [] : [q / a, q ? c / q : 0];
    for (const root of roots) if (root > EPS && game.hour + root <= limit + EPS) next = Math.min(next, game.hour + root);
  }
  return next;
}
export function nextPulseEvent(game: Game, limit: number): number {
  if (!game.pulse) return Infinity;
  let next = nextTacticalPulseEvent(game, limit);
  if (game.hour < OPENING_HOURS) next = Math.min(next, OPENING_HOURS);
  for (const m of game.pulse.modifiers) if (m.expiresAt > game.hour) next = Math.min(next, m.expiresAt);
  for (const king of game.pulse.kings) if (king.state === 'charging') {
    const rate = pulseRate(game, king.factionId, 'charge_rate');
    if (rate) next = Math.min(next, game.hour + Math.max(0, pulseConfig(game).chargeDuration - king.chargeProgress) / rate);
  }
  for (const rock of game.rocks) {
    if (!rock.owner || rock.destroyed) continue;
    const shield = game.pulse.shields[rock.id];
    if (shield && !shield.exposed && shield.energy < pulseConfig(game).shieldMaxEnergy && pulseConfig(game).shieldRechargePerHour > 0) next = Math.min(next, game.hour + (pulseConfig(game).shieldMaxEnergy - shield.energy) / pulseConfig(game).shieldRechargePerHour);
    if (shield?.exposed && shield.energy > 0 && !rock.shieldsDisabled) {
      const drain = shield.exposed * pulseConfig(game).shieldDrainPerHour * pulseRate(game, rock.owner, 'shield_drain');
      if (drain) next = Math.min(next, game.hour + shield.energy / drain);
    }
  }
  for (const pulse of game.pulse.pulses) for (const asset of [...game.rocks.filter(r => !r.destroyed), ...game.fleets]) {
    if (hostile(pulse, asset.owner)) next = Math.min(next, expandingIntersection(game, pulse.origin, pulse.radius, pulseConfig(game).propagationSpeed * pulseRate(game, pulse.factionId, 'pulse_speed'), asset, next));
  }
  return next;
}
/** Advance only across an interval with constant modifiers and exposure. */
export function advancePulseTime(game: Game, through: number): void {
  if (!game.pulse) return;
  const elapsed = Math.max(0, through - game.hour), config = pulseConfig(game);
  advanceTacticalPulseTime(game, through);
  for (const king of game.pulse.kings) if (king.state === 'charging') king.chargeProgress += elapsed * pulseRate(game, king.factionId, 'charge_rate');
  for (const p of game.pulse.pulses) p.radius += elapsed * config.propagationSpeed * pulseRate(game, p.factionId, 'pulse_speed');
  for (const rock of game.rocks) {
    const shield = game.pulse.shields[rock.id];
    if (!shield || rock.destroyed) continue;
    const drain = shield.exposed && !rock.shieldsDisabled && rock.owner ? shield.exposed * config.shieldDrainPerHour * pulseRate(game, rock.owner, 'shield_drain') : 0;
    shield.energy = Math.max(0, Math.min(config.shieldMaxEnergy, shield.energy + elapsed * (shield.exposed ? -drain : config.shieldRechargePerHour)));
  }
}
function shieldProtects(game: Game, rock: Rock): boolean { return !rock.destroyed && !rock.shieldsDisabled && (game.pulse!.shields[rock.id]?.energy ?? 0) > EPS; }
export function settlePulseHazards(game: Game): void {
  if (!game.pulse) return;
  reconcilePulseKings(game);
  settleTacticalPulses(game);
  const pulses = [...game.pulse.pulses];
  const sites = game.rocks.filter(r => !r.destroyed && !(r.pulseDisabled && r.drones === 0 && !r.specialists?.length) && pulses.some(p => hostile(p, r.owner) && covers(game, p, r)) && !shieldProtects(game, r));
  const ships = game.fleets.filter(f => {
    const point = fleetPosition(game, f);
    const station = f.preparing && game.rocks.find(r => r.id === f.from);
    return !(station && station.owner === f.owner && shieldProtects(game, station)) && pulses.some(p => hostile(p, f.owner) && covers(game, p, point));
  });
  // Collect every lethal contact before removing any emitter. Equal-time kills are simultaneous.
  for (const rock of sites) {
    if (rock.kind === 'mine' && pulseConfig(game).miningDamage === 'disable') {
      rock.drones = 0; rock.specialists = []; rock.module = undefined; rock.coreOf = undefined;
      rock.pulseDisabled = true;
    } else { rock.destroyed = true; rock.drones = 0; rock.shield = 0; rock.specialists = []; delete rock.coreOf; delete rock.module; }
    game.events.unshift({ hour: game.hour, audience: [...new Set([rock.owner!, ...observers(game, rock)])], message: `${rock.name}: King's Pulse ${rock.pulseDisabled ? 'disabled mining infrastructure' : 'destroyed the site'}.` });
  }
  game.fleets = game.fleets.filter(f => !ships.includes(f));
  for (const fleet of ships) game.events.unshift({ hour: game.hour, audience: [...new Set([fleet.owner, ...observers(game, fleetPosition(game, fleet))])], message: "A hostile King's Pulse destroyed your hauler and its specialists." });
  reconcilePulseKings(game);
  for (const rock of game.rocks) {
    const shield = game.pulse.shields[rock.id];
    if (!shield) continue;
    const count = !rock.destroyed ? exposures(game, rock) : 0;
    if (count && !shield.exposed && rock.owner) game.events.unshift({ hour: game.hour, audience: [rock.owner], message: `${rock.name}: shield is absorbing a hostile pulse. Your King may be in danger.` });
    if (shield.exposed && shield.energy <= EPS && rock.owner && (sites.includes(rock) || !rock.pulseDisabled)) {
      game.events.unshift({ hour: game.hour, audience: [rock.owner], message: `${rock.name}: pulse shield collapsed.` });
      shield.energy = 0;
    }
    shield.exposed = count;
  }
  reconcileFunding(game);
  game.pulse.modifiers = game.pulse.modifiers.filter(m => m.expiresAt > game.hour);
}
export function evaluatePulseVictory(game: Game): void {
  if (!game.pulse || game.winner || game.draw) return;
  const living = playersIn(game).filter(f => !game.eliminated.includes(f));
  if (living.length > 1) return;
  if (living.length === 1) game.winner = living[0]!; else game.draw = true;
  game.scheduled = [];
  for (const fleet of game.fleets) delete fleet.pendingCourse;
  game.events.unshift({ hour: game.hour, audience: [...playersIn(game)], message: game.draw ? 'All Kings eliminated. The operation ended in a draw.' : `${game.winner}: last surviving King. Victory secured.` });
}
