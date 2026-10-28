/**
 * ---
 * purpose: Validate versioned local snapshots before they reach the simulation or replace saved progress.
 * ---
 */
import { mechanicsVersion, validateRules, OUTPOSTS_PER_PLAYER } from './rules';
import { playersIn } from './players';
import type { ReplayData } from './replay';
import { upgradeSpecialists } from './specialists';
import { FUNDING_LEAD } from './funding';
import { MINING_DAY } from './mining';
import { isSpecialistKind, SPECIALISTS, HIRE_CATEGORIES } from './specialist-catalog';
import { MAX_PLAN_DELAY, MAX_PLANS_PER_FACTION } from './orders';
import { MAX_STORED_EVENTS } from './events';
import { isModule } from './modules';
import { createLegacyGame } from './legacy';
import { maximumShield } from './economy';
import { type Game, type Faction, type Rock, createGame } from './simulation';
export type Save = { savedAt: number; game: Game; replay?: ReplayData };
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonnegative = (v: unknown): v is number => finite(v) && v >= 0;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function decodeSave(raw: string): Save {
  const fail = () => { throw new Error('This save is damaged or belongs to an unsupported version. Reset the operation to start again.'); };
  let save: unknown;
  try { save = JSON.parse(raw); } catch { return fail(); }
  if (!record(save) || !nonnegative(save.savedAt) || !record(save.game)) return fail();
  const g = save.game;
  let rules;
  try { rules = g.rules === undefined ? undefined : validateRules(g.rules); } catch { return fail(); }
  if (rules && (g.version !== 2 || g.specialistVersion !== 1)) return fail();
  const factions = playersIn({ rules });
  const isFaction = (v: unknown): v is Faction => factions.includes(v as Faction);
  const base = g.version === 2 ? createGame(0) : createLegacyGame(0);
  if (![1, 2].includes(g.version as number) || !nonnegative(g.hour) || !nonnegative(g.epoch) || !Number.isInteger(g.nextId) || (g.nextId as number) < 1
    || !record(g.cargo) || Object.keys(g.cargo).some(key => !isFaction(key)) || !factions.every(f => nonnegative((g.cargo as Record<string, unknown>)[f as string]))
    || !Array.isArray(g.eliminated) || !g.eliminated.every(isFaction) || new Set(g.eliminated).size !== g.eliminated.length
    || !(g.winner === null || isFaction(g.winner))
    || !(g.specialistVersion === undefined || g.version === 2 && g.specialistVersion === 1)
    || !(g.draw === undefined || g.version === 2 && g.draw === true && g.winner === null && Array.isArray(g.eliminated) && g.eliminated.length === factions.length)
    || !Array.isArray(g.rocks) || g.rocks.length !== (rules ? rules.players.length * OUTPOSTS_PER_PLAYER : base.rocks.length)
    || !Array.isArray(g.fleets) || !Array.isArray(g.events) || g.events.length > MAX_STORED_EVENTS) return fail();
  if (g.specialistVersion === 1 && (!record(g.recruitment) || !g.rocks.every(r => record(r) && Array.isArray(r.specialists)) || !g.fleets.every(f => record(f) && Array.isArray(f.specialists)))) return fail();
  const unitIds = new Set<string>();
  const validUnits = (value: unknown): boolean => {
    if (value === undefined) return true;
    if (g.version !== 2 || !Array.isArray(value) || value.length > 10000) return false;
    for (const u of value) {
      if (!record(u) || typeof u.id !== 'string' || !/^[a-zA-Z0-9:-]{1,80}$/.test(u.id) || unitIds.has(u.id) || !isSpecialistKind(u.kind) || !isFaction(u.owner)
        || !(u.captive === undefined || u.captive === true) || !(u.nextActionAt === undefined || nonnegative(u.nextActionAt)) || !(u.lastCourseAt === undefined || nonnegative(u.lastCourseAt))) return false;
      unitIds.add(u.id);
    }
    return true;
  };
  if (g.recruitment !== undefined) {
    if (g.version !== 2 || !record(g.recruitment) || Object.keys(g.recruitment).some(key => !isFaction(key))) return fail();
    for (const f of factions) {
      const state = g.recruitment[f as string];
      if (!record(state) || !Number.isSafeInteger(state.used) || (state.used as number) < 0 || !Number.isSafeInteger(state.seed) || (state.seed as number) < 0 || (state.seed as number) >= 2 ** 32
        || !record(state.pool) || !Object.entries(state.pool).every(([k, v]) => isSpecialistKind(k) && Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 3)
        || !Array.isArray(state.offers) || state.offers.length !== 3 || !state.offers.every((k, i) => isSpecialistKind(k) && SPECIALISTS[k].category === HIRE_CATEGORIES[i] && ((state.pool as Record<string, number>)[k] ?? 0) > 0)) return fail();
    }
  }
  if (rules?.mode === 'domination' && Array.isArray(g.funding) && g.funding.length) return fail();
  if (g.funding !== undefined) {
    const eliminated = g.eliminated;
    if (g.version !== 2 || !Array.isArray(g.funding) || g.funding.length > factions.length * (factions.length - 1)
      || !g.funding.every(f => record(f) && isFaction(f.from) && isFaction(f.to) && f.from !== f.to && !eliminated.includes(f.from) && !eliminated.includes(f.to) && (g.cargo as Record<string, number>)[f.from]! - (g.cargo as Record<string, number>)[f.to]! >= FUNDING_LEAD)
      || new Set(g.funding.map(f => `${f.from}:${f.to}`)).size !== g.funding.length) return fail();
  }
  const ids = new Set<string>();
  for (const r of g.rocks) {
    if (!record(r) || typeof r.id !== 'string' || !/^[a-zA-Z0-9:-]{1,80}$/.test(r.id) || ids.has(r.id) || !rules && !base.rocks.some(b => b.id === r.id)
      || typeof r.name !== 'string' || !finite(r.x) || !finite(r.y) || rules && (r.x < 0 || r.y < 0 || r.x > rules.map.width || r.y > rules.map.height) || !nonnegative(r.drones)
      || !(r.owner === null || isFaction(r.owner)) || !(g.version === 2 ? ['factory', 'generator', 'mine'] : ['core', 'reactor', 'mine']).includes(r.kind as string)
      || !(r.coreOf === undefined || isFaction(r.coreOf)) || !(r.module === undefined || isModule(r.module))) return fail();
    if (rules?.mode === 'domination' && r.kind === 'mine') return fail();
    if (mechanicsVersion({ rules }) >= 2 && r.destroyed && (r.drones !== 0 || r.shield !== 0 || r.coreOf !== undefined || r.module !== undefined || !Array.isArray(r.specialists) || r.specialists.length)) return fail();
    if (g.version === 2 && (!Number.isSafeInteger(r.shield) || !nonnegative(r.shield) || ![10, 20].includes(r.shieldMax as number)
      || (r.shield as number) > maximumShield(r as Rock) || typeof r.shieldsDisabled !== 'boolean' || !nonnegative(r.shieldAt)
      || r.owner && (r.shield as number) < maximumShield(r as Rock) && (r.shieldAt as number) <= (g.hour as number)
      || r.kind === 'factory' && (!nonnegative(r.productionAt) || r.owner && !r.destroyed && r.productionAt <= (g.hour as number))
      || r.kind === 'mine' && (!nonnegative(r.miningAt) || r.owner && !r.destroyed && r.miningAt <= (g.hour as number)))) return fail();
    if (!(r.productionInterval === undefined || finite(r.productionInterval) && r.productionInterval > 0) || !(r.miningInterval === undefined || g.version === 2 && finite(r.miningInterval) && r.miningInterval >= MINING_DAY / g.rocks.length && r.miningInterval <= MINING_DAY) || !validUnits(r.specialists) || !(r.shieldBonus === undefined || finite(r.shieldBonus)) || !(r.destroyed === undefined || r.destroyed === true)) return fail();
    ids.add(r.id);
  }
  if (g.version === 2 && (!record(g.minesDrilled) || !factions.every(f => Number.isSafeInteger((g.minesDrilled as Record<string, unknown>)[f as string]) && ((g.minesDrilled as Record<string, number>)[f as string] ?? -1) >= 0))) return fail();
  const fleetIds = new Set<number>();
  for (const f of g.fleets) {
    if (!record(f) || !Number.isInteger(f.id) || (f.id as number) < 1 || (f.id as number) >= (g.nextId as number) || fleetIds.has(f.id as number)
      || !isFaction(f.owner) || g.version === 1 && g.eliminated.includes(f.owner) || !ids.has(f.from as string) || !ids.has(f.to as string) || f.from === f.to && !f.route
      || !Number.isInteger(f.drones) || (f.drones as number) < (g.version === 2 && Array.isArray(f.specialists) && f.specialists.length ? 0 : 1) || !nonnegative(f.departed) || (f.departed > g.hour && !(g.version === 2 && f.preparing === true && f.departed <= (g.hour as number) + 1 / 6 + 1e-9))
      || !(f.interceptionReturn === undefined || g.version === 2 && mechanicsVersion({ rules }) >= 3 && f.interceptionReturn === true && f.returning === true && f.intercept === undefined)
      || !(f.courseLocked === undefined || g.version === 2 && f.courseLocked === true)
      || !(f.giftAt === undefined || g.version === 2 && nonnegative(f.giftAt) && f.giftAt <= (g.hour as number) + 1 / 6 + 1e-9)
      || !(f.preparing === undefined || g.version === 2 && f.preparing === true && (f.departed as number) > (g.hour as number))
      || !(f.module === undefined || isModule(f.module))
      || !finite(f.arrives) || f.arrives <= g.hour || f.arrives <= f.departed) return fail();
    if (f.route !== undefined) {
      if (!record(f.route) || !record(f.route.from) || !record(f.route.to)
        || !finite(f.route.from.x) || !finite(f.route.from.y) || !finite(f.route.to.x) || !finite(f.route.to.y)
        || g.version === 1 && f.from !== f.to || !(g.version === 2 || f.intercept || f.returning === true)) return fail();
    }
    if (f.intercept !== undefined) {
      if (!record(f.intercept) || !f.route || (g.specialistVersion !== 1 ? f.module !== 'scavenger' : !Array.isArray(f.specialists) || !f.specialists.some(u => record(u) && u.kind === 'pirate' && !u.captive)) || f.returning !== undefined
        || !Number.isSafeInteger(f.intercept.target) || (f.intercept.target as number) < 1 || (f.intercept.target as number) >= (g.nextId as number)
        || f.intercept.target === f.id || f.intercept.home !== f.from) return fail();
    }
    if (g.version === 1 && record(f.route)) {
      const home = g.rocks.find(r => r.id === f.from)!;
      const endpoint = f.returning ? f.route.to : f.route.from;
      if (!record(endpoint) || endpoint.x !== home.x || endpoint.y !== home.y) return fail();
    }
    if (f.returning !== undefined && (f.returning !== true || !f.route || g.version === 1 && f.module !== 'scavenger')) return fail();
    if (f.lastContacts !== undefined && (g.version !== 2 || !Array.isArray(f.lastContacts) || !f.lastContacts.every(c => record(c) && Number.isSafeInteger(c.id) && (c.id as number) > 0 && (c.id as number) < (g.nextId as number) && nonnegative(c.hour) && c.hour <= (g.hour as number)))) return fail();
    if (!(f.speed === undefined || finite(f.speed) && f.speed > 0) || !validUnits(f.specialists)) return fail();
    fleetIds.add(f.id as number);
  }
  if (g.specialistVersion === 1) {
    const assets = [...g.rocks, ...g.fleets] as Record<string, unknown>[];
    if (assets.some(a => (a.specialists as Record<string, unknown>[]).some(u => !u.captive && u.owner !== a.owner))) return fail();
    for (const f of factions) if (!g.eliminated.includes(f as Faction) && assets.flatMap(a => a.specialists as Record<string, unknown>[]).filter(u => u.owner === f && u.kind === 'queen' && !u.captive).length !== 1) return fail();
  }
  if (g.scheduled !== undefined) {
    if (!Array.isArray(g.scheduled) || g.scheduled.length > MAX_PLANS_PER_FACTION * factions.length) return fail();
    const plans = new Set<string>();
    for (const p of g.scheduled) {
      if (!record(p) || typeof p.id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(p.id) || !isFaction(p.owner)
        || g.eliminated.includes(p.owner) || g.winner !== null || plans.has(`${p.owner}:${p.id}`)
        || !ids.has(p.from as string) || !ids.has(p.to as string) || p.from === p.to
        || !Number.isSafeInteger(p.drones) || (p.drones as number) < (g.version === 2 && Array.isArray(p.specialists) && p.specialists.length ? 0 : 1)
        || !finite(p.executeAt) || p.executeAt <= g.hour || p.executeAt > g.hour + MAX_PLAN_DELAY
        || !(p.module === undefined || isModule(p.module))) return fail();
      if (p.specialists !== undefined && (g.version !== 2 || !Array.isArray(p.specialists) || p.specialists.length > 10000 || !p.specialists.every(u => typeof u === 'string') || new Set(p.specialists).size !== p.specialists.length)) return fail();
      plans.add(`${p.owner}:${p.id}`);
    }
    if (factions.some(f => (g.scheduled as Record<string, unknown>[]).filter(p => p.owner === f).length > MAX_PLANS_PER_FACTION)) return fail();
  }
  if (!g.events.every(e => record(e) && nonnegative(e.hour) && e.hour <= (g.hour as number) && typeof e.message === 'string' && (e.audience === undefined || Array.isArray(e.audience) && e.audience.every(isFaction)))) return fail();
  const decoded = save as Save;
  return { ...decoded, game: upgradeSpecialists(decoded.game) };
}
