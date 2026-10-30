import { tacticalConfig, type TacticalPulseSystem } from './tactical-pulse';
import type { Game } from './simulation';
import { playersIn } from './players';

/** Validate finite waves and their once-per-target ledger without requiring a surviving emitter. */
export function validTacticalPulseSave(game: Game): boolean {
  const system = game.pulse?.tactical as TacticalPulseSystem | undefined;
  if (!game.rules?.tacticalPulse) return system === undefined && [...game.rocks, ...game.fleets].every(a => !['sensorJammedUntil', 'miningDisabledUntil', 'enginesDisabledUntil'].some(key => Object.hasOwn(a, key)));
  const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
  const nonnegative = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const id = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9:-]{1,100}$/.test(v);
  const config = tacticalConfig(game), factions = playersIn(game);
  if (!object(system) || Object.keys(system).sort().join() !== 'charges,resistance,waves' || !Array.isArray(system.charges) || !Array.isArray(system.waves) || !object(system.resistance) || system.charges.length + system.waves.length > 1000) return false;
  const charges = system.charges;
  if (charges.some(c => !object(c) || !id(c.id) || !id(c.specialistId) || !factions.includes(c.factionId) || !nonnegative(c.readyAt) || c.readyAt <= game.hour || c.readyAt > game.hour + config.chargeDuration + 1e-9 || !Number.isSafeInteger(c.resourceCost) || c.resourceCost < config.minimumResourceCost || c.resourceCost > config.maximumResourceCost
    || !game.rocks.some(r => r.id === c.siteId && !r.destroyed && r.owner === c.factionId && r.specialists?.some(u => u.id === c.specialistId && u.owner === c.factionId && u.kind === 'disruptor' && !u.captive)))) return false;
  if (new Set(charges.map(c => c.specialistId)).size !== charges.length) return false;
  const waves = system.waves;
  if (waves.some(w => !object(w) || !id(w.id) || !id(w.specialistId) || !factions.includes(w.factionId) || !object(w.origin) || ![w.origin.x, w.origin.y].every(Number.isFinite) || !nonnegative(w.firedAt) || w.firedAt > game.hour || !nonnegative(w.radius) || !nonnegative(w.initialStrength)
    || w.attenuationPerDistance !== config.attenuationPerDistance
    || w.initialStrength < config.minimumResourceCost * config.strengthPerResource || w.initialStrength > config.maximumResourceCost * config.strengthPerResource || w.radius * config.attenuationPerDistance >= w.initialStrength + 1e-9
    || Math.abs(w.radius - (game.hour - w.firedAt) * config.propagationSpeed) > 1e-6
    || !Array.isArray(w.hitSites) || w.hitSites.length > game.rocks.length || new Set(w.hitSites).size !== w.hitSites.length || w.hitSites.some(site => !game.rocks.some(r => r.id === site))
    || !Array.isArray(w.hitFleets) || w.hitFleets.length > 10000 || new Set(w.hitFleets).size !== w.hitFleets.length || w.hitFleets.some(f => !Number.isSafeInteger(f) || f < 1 || f >= game.nextId))) return false;
  if (new Set([...charges, ...waves].map(c => `${c.factionId}:${c.id}`)).size !== charges.length + waves.length) return false;
  if (Object.entries(system.resistance).some(([key, until]) => !game.pulse!.kings.some(k => k.kingId === key) || !nonnegative(until) || until <= game.hour || until > game.hour + config.resistanceDuration + 1e-9)) return false;
  for (const asset of [...game.rocks, ...game.fleets]) {
    for (const key of ['sensorJammedUntil', 'miningDisabledUntil', 'enginesDisabledUntil'] as const) {
      const until = (asset as Record<string, unknown>)[key];
      if (until !== undefined && (!nonnegative(until) || until <= game.hour || until > game.hour + config.disruptionDuration + 1e-9)) return false;
    }
  }
  if (game.rocks.some(r => Object.hasOwn(r, 'enginesDisabledUntil') || r.miningDisabledUntil !== undefined && (r.kind !== 'mine' || r.miningAt! < r.miningDisabledUntil))) return false;
  if (game.fleets.some(f => Object.hasOwn(f, 'miningDisabledUntil') || f.enginesDisabledUntil !== undefined && (f.preparing || !f.route || f.arrives <= f.enginesDisabledUntil))) return false;
  return true;
}
