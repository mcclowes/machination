import { pulseConfig, pulseEnabled, type PulseSystem } from './pulse';
import type { Game } from './simulation';
import { playersIn } from './players';

/** Validate untrusted save data before the simulation reads pulse state. */
export function validPulseSave(game: Game): boolean {
  if (!pulseEnabled(game)) return game.pulse === undefined;
  const s = game.pulse as PulseSystem | undefined, config = pulseConfig(game);
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const point = (v: unknown) => obj(v) && [v.x, v.y].every(n => typeof n === 'number' && Number.isFinite(n));
  const id = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9:-]{1,100}$/.test(v);
  const factions = playersIn(game);
  if (!obj(s) || !Array.isArray(s.kings) || !Array.isArray(s.pulses) || !Array.isArray(s.modifiers) || !obj(s.shields) || !obj(s.receipts)
    || s.kings.length !== factions.length || s.pulses.length > factions.length || s.modifiers.length > 10000 || Object.keys(s.receipts).length > 10000) return false;
  if (s.kings.some(k => !obj(k) || !id(k.kingId) || !factions.includes(k.factionId) || !point(k.position) || !['idle', 'charging', 'ready', 'firing', 'moving', 'destroyed'].includes(k.state) || !positive(k.chargeProgress) || k.chargeProgress > config.chargeDuration || !positive(k.resourceCommitted) || k.state === 'destroyed' !== game.eliminated.includes(k.factionId))) return false;
  if (new Set(s.kings.map(k => k.factionId)).size !== factions.length || new Set(s.kings.map(k => k.kingId)).size !== factions.length) return false;
  if (s.pulses.some(p => !obj(p) || !id(p.id) || !point(p.origin) || !positive(p.radius) || !positive(p.firedAt) || p.firedAt > game.hour || !s.kings.some(k => k.kingId === p.kingId && k.factionId === p.factionId && k.state === 'firing'))) return false;
  if (s.kings.some(k => s.pulses.filter(p => p.kingId === k.kingId).length !== (k.state === 'firing' ? 1 : 0))) return false;
  if (Object.entries(s.shields).some(([key, v]) => !game.rocks.some(r => r.id === key) || !obj(v) || !positive(v.energy) || v.energy > config.shieldMaxEnergy || !Number.isSafeInteger(v.exposed) || v.exposed < 0 || v.exposed >= factions.length)) return false;
  if (s.modifiers.some(m => !obj(m) || !factions.includes(m.factionId) || !['charge_rate', 'pulse_speed', 'shield_drain'].includes(m.type) || !positive(m.multiplier) || m.multiplier > 100 || !positive(m.expiresAt) || m.expiresAt <= game.hour)) return false;
  return Object.entries(s.receipts).every(([key, v]) => factions.some(f => key.startsWith(`${f}:`) && /^[a-zA-Z0-9-]{16,80}$/.test(key.slice(f.length + 1))) && typeof v === 'string' && (['START_CHARGE', 'CANCEL_CHARGE', 'FIRE_PULSE', 'TERMINATE_PULSE'].includes(v) || v.startsWith('effect:') && v.length <= 300));
}
