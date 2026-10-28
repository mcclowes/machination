/**
 * ---
 * purpose: Validate versioned local snapshots before they reach the simulation or replace saved progress.
 * ---
 */
import { MAX_PLAN_DELAY, MAX_PLANS_PER_FACTION } from './orders';
import { MAX_STORED_EVENTS } from './events';
import { isModule } from './modules';
import { createLegacyGame } from './legacy';
import { maximumShield } from './economy';
import { type Game, type Faction, type Rock, createGame } from './simulation';
export type Save = { savedAt: number; game: Game };
const factions: unknown[] = ['you', 'vesper', 'null'];
const isFaction = (v: unknown): v is Faction => factions.includes(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonnegative = (v: unknown): v is number => finite(v) && v >= 0;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function decodeSave(raw: string): Save {
  const fail = () => { throw new Error('This save is damaged or belongs to an unsupported version. Reset the operation to start again.'); };
  let save: unknown;
  try { save = JSON.parse(raw); } catch { return fail(); }
  if (!record(save) || !nonnegative(save.savedAt) || !record(save.game)) return fail();
  const g = save.game;
  const base = g.version === 2 ? createGame(0) : createLegacyGame(0);
  if (![1, 2].includes(g.version as number) || !nonnegative(g.hour) || !nonnegative(g.epoch) || !Number.isInteger(g.nextId) || (g.nextId as number) < 1
    || !record(g.cargo) || !factions.every(f => nonnegative((g.cargo as Record<string, unknown>)[f as string]))
    || !Array.isArray(g.eliminated) || !g.eliminated.every(isFaction) || new Set(g.eliminated).size !== g.eliminated.length
    || !(g.winner === null || isFaction(g.winner))
    || !Array.isArray(g.rocks) || g.rocks.length !== base.rocks.length
    || !Array.isArray(g.fleets) || !Array.isArray(g.events) || g.events.length > MAX_STORED_EVENTS) return fail();
  const ids = new Set<string>();
  for (const r of g.rocks) {
    if (!record(r) || typeof r.id !== 'string' || ids.has(r.id) || !base.rocks.some(b => b.id === r.id)
      || typeof r.name !== 'string' || !finite(r.x) || !finite(r.y) || !nonnegative(r.drones)
      || !(r.owner === null || isFaction(r.owner)) || !(g.version === 2 ? ['factory', 'generator', 'mine'] : ['core', 'reactor', 'mine']).includes(r.kind as string)
      || !(r.coreOf === undefined || isFaction(r.coreOf)) || !(r.module === undefined || isModule(r.module))) return fail();
    if (g.version === 2 && (!Number.isSafeInteger(r.shield) || !nonnegative(r.shield) || ![10, 20].includes(r.shieldMax as number)
      || (r.shield as number) > maximumShield(r as Rock) || typeof r.shieldsDisabled !== 'boolean' || !nonnegative(r.shieldAt)
      || r.owner && (r.shield as number) < maximumShield(r as Rock) && (r.shieldAt as number) <= (g.hour as number)
      || r.kind === 'factory' && (!nonnegative(r.productionAt) || r.owner && r.productionAt <= (g.hour as number))
      || r.kind === 'mine' && (!nonnegative(r.miningAt) || r.owner && r.miningAt <= (g.hour as number)))) return fail();
    ids.add(r.id);
  }
  if (g.version === 2 && (!record(g.minesDrilled) || !factions.every(f => Number.isSafeInteger((g.minesDrilled as Record<string, unknown>)[f as string]) && ((g.minesDrilled as Record<string, number>)[f as string] ?? -1) >= 0))) return fail();
  const fleetIds = new Set<number>();
  for (const f of g.fleets) {
    if (!record(f) || !Number.isInteger(f.id) || (f.id as number) < 1 || (f.id as number) >= (g.nextId as number) || fleetIds.has(f.id as number)
      || !isFaction(f.owner) || g.version === 1 && g.eliminated.includes(f.owner) || !ids.has(f.from as string) || !ids.has(f.to as string) || f.from === f.to && !f.route
      || !Number.isInteger(f.drones) || (f.drones as number) < 1 || !nonnegative(f.departed) || (f.departed > g.hour && !(g.version === 2 && f.preparing === true && f.departed <= (g.hour as number) + 1 / 6 + 1e-9))
      || !(f.giftAt === undefined || g.version === 2 && nonnegative(f.giftAt) && f.giftAt <= (g.hour as number) + 1 / 6 + 1e-9)
      || !(f.preparing === undefined || g.version === 2 && f.preparing === true && (f.departed as number) > (g.hour as number))
      || !(f.module === undefined || isModule(f.module))
      || !finite(f.arrives) || f.arrives <= g.hour || f.arrives <= f.departed) return fail();
    if (f.route !== undefined) {
      if (!record(f.route) || !record(f.route.from) || !record(f.route.to)
        || !finite(f.route.from.x) || !finite(f.route.from.y) || !finite(f.route.to.x) || !finite(f.route.to.y)
        || f.from !== f.to || !(g.version === 2 || f.intercept || f.returning === true)) return fail();
    }
    if (f.intercept !== undefined) {
      if (!record(f.intercept) || !f.route || f.module !== 'scavenger' || f.returning !== undefined
        || !Number.isSafeInteger(f.intercept.target) || (f.intercept.target as number) < 1 || (f.intercept.target as number) >= (g.nextId as number)
        || f.intercept.target === f.id || f.intercept.home !== f.from) return fail();
    }
    if (g.version === 1 && record(f.route)) {
      const home = g.rocks.find(r => r.id === f.from)!;
      const endpoint = f.returning ? f.route.to : f.route.from;
      if (!record(endpoint) || endpoint.x !== home.x || endpoint.y !== home.y) return fail();
    }
    if (f.returning !== undefined && (f.returning !== true || !f.route || g.version === 1 && f.module !== 'scavenger')) return fail();
    fleetIds.add(f.id as number);
  }
  if (g.scheduled !== undefined) {
    if (!Array.isArray(g.scheduled) || g.scheduled.length > MAX_PLANS_PER_FACTION * factions.length) return fail();
    const plans = new Set<string>();
    for (const p of g.scheduled) {
      if (!record(p) || typeof p.id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(p.id) || !isFaction(p.owner)
        || g.eliminated.includes(p.owner) || g.winner !== null || plans.has(`${p.owner}:${p.id}`)
        || !ids.has(p.from as string) || !ids.has(p.to as string) || p.from === p.to
        || !Number.isSafeInteger(p.drones) || (p.drones as number) < 1
        || !finite(p.executeAt) || p.executeAt <= g.hour || p.executeAt > g.hour + MAX_PLAN_DELAY
        || !(p.module === undefined || isModule(p.module))) return fail();
      plans.add(`${p.owner}:${p.id}`);
    }
    if (factions.some(f => (g.scheduled as Record<string, unknown>[]).filter(p => p.owner === f).length > MAX_PLANS_PER_FACTION)) return fail();
  }
  if (!g.events.every(e => record(e) && nonnegative(e.hour) && e.hour <= (g.hour as number) && typeof e.message === 'string' && (e.audience === undefined || Array.isArray(e.audience) && e.audience.every(isFaction)))) return fail();
  return save as Save;
}
