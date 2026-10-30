/**
 * ---
 * purpose: Specialist identity, time-based recruitment, promotion, and shared active-unit queries.
 * ---
 */
import { compactAllows } from './compact';
import { workClock, workHour, type OpeningWorld } from './opening-clock';
import { isActionPlan } from './future-actions';
import { withUnitEffects } from './specialist-effects';
import type { Faction, Fleet, Game, Rock } from './simulation';
import { HIRE_CATEGORIES, HIRE_KINDS, SPECIALISTS, hireAmount, promotion, specialistEventName, type SpecialistKind } from './specialist-catalog';
import { recentEvents } from './events';
import { observers } from './sensors';
import { mechanicsVersion } from './rules';
import { reconcileFunding } from './funding';

export const RECRUITMENT_CARGO_COST = 5;
export function recruitmentCost(game: OpeningWorld): number { return (game.rules?.mechanicsVersion ?? 1) >= 17 ? RECRUITMENT_CARGO_COST : 0; }

export type Specialist = { id: string; kind: SpecialistKind; owner: Faction; captive?: true; nextActionAt?: number; lastCourseAt?: number };
export type Recruitment = { used: number; seed: number; pool: Partial<Record<SpecialistKind, number>>; offers: SpecialistKind[] };
export function newRecruitment(seed: number, tactical = false): Recruitment { return drawOffers({ used: 0, seed: seed >>> 0, pool: {}, offers: [] }, tactical); }
function drawOffers(input: Recruitment, tactical = false): Recruitment {
  const next: Recruitment = { ...input, pool: { ...input.pool }, offers: [] };
  for (const category of HIRE_CATEGORIES) {
    const kinds = HIRE_KINDS.filter(k => SPECIALISTS[k].category === category && (k !== 'disruptor' || tactical));
    if (kinds.every(k => (next.pool[k] ?? 0) === 0)) for (const kind of kinds) next.pool[kind] = 3;
    const deck = kinds.flatMap(k => Array<SpecialistKind>(next.pool[k] ?? 0).fill(k));
    next.seed = (Math.imul(1664525, next.seed) + 1013904223) >>> 0;
    next.offers.push(deck[Math.floor(next.seed / 2 ** 32 * deck.length)]!);
  }
  return next;
}
export type UnitWorld = { rocks: readonly { id: string; owner?: Faction | null; specialists?: Specialist[] }[]; fleets: readonly { id: number; from: string; owner: Faction; preparing?: true; specialists?: Specialist[] }[] };
export function activeUnits(game: UnitWorld, owner?: Faction): Specialist[] {
  const units: Specialist[] = [];
  for (const assets of [game.rocks, game.fleets]) for (const asset of assets) for (const unit of asset.specialists ?? []) {
    if (unit.owner === asset.owner && !unit.captive && (owner === undefined || unit.owner === owner)) units.push(unit);
  }
  return units;
}
export function restoreControl(game: Game, unit: Specialist, owner: Faction, cargo: readonly Specialist[] = []): void {
  if (unit.kind === 'queen') {
    // A captured manifest may not yet belong to an asset in the world.
    const another = (u: Specialist) => u.kind === 'queen' && u.owner === owner && !u.captive && u.id !== unit.id;
    if (unit.owner !== owner || mechanicsVersion(game) >= 14 && (activeUnits(game, owner).some(another) || cargo.some(another))) unit.kind = 'princess';
  }
  unit.owner = owner;
  delete unit.captive;
}
export function unitsAtRock(game: UnitWorld, id: string): Specialist[] {
  return [...(game.rocks.find(r => r.id === id)?.specialists ?? []), ...game.fleets.filter(f => f.preparing && f.from === id).flatMap(f => f.specialists ?? [])].filter(u => !u.captive);
}
export function unitCount(game: UnitWorld, owner: Faction, kind: SpecialistKind): number { return activeUnits(game, owner).filter(u => u.kind === kind).length; }
export function recruitmentStatus(game: UnitWorld & OpeningWorld & { hour: number; recruitment?: Partial<Record<Faction, Pick<Recruitment, 'used' | 'offers'>>> }, owner: Faction): { credits: number; offers: SpecialistKind[]; nextAt: number; at?: string } {
  const state = game.recruitment?.[owner];
  const core = game.rocks.find(r => unitsAtRock(game, r.id).some(u => u.owner === owner && u.kind === 'queen'));
  const elapsed = workClock(game, game.hour);
  const earned = elapsed < 4 ? 0 : 1 + Math.floor((elapsed - 4) / 18);
  return { credits: Math.max(0, earned - (state?.used ?? 0)), offers: state?.offers ?? [], nextAt: workHour(game, 4 + 18 * Math.max(earned, state?.used ?? 0)), ...(core && core.owner === owner ? { at: core.id } : {}) };
}
function requireRecruitment(game: Game, owner: Faction): { status: ReturnType<typeof recruitmentStatus>; state: Recruitment } {
  const status = recruitmentStatus(game, owner);
  if (game.version !== 2 || game.winner || game.draw || game.eliminated.includes(owner) || !status.credits || !game.recruitment?.[owner]) throw new Error('Recruitment needs an active intelligence and an available hiring credit.');
  return { status, state: game.recruitment[owner] };
}
export function hireSpecialist(game: Game, owner: Faction, kind: SpecialistKind, ids?: readonly string[]): Game {
  const { status, state } = requireRecruitment(game, owner);
  if (kind === 'martyr' && !compactAllows(game, 'weapons')) throw new Error('Strategic weapons interlocks are active under the Belt compact.');
  if (!status.at) throw new Error('Hiring needs your active core at a controlled site.');
  if (!state.offers.includes(kind)) throw new Error('Choose one of the three current recruitment offers.');
  const cost = recruitmentCost(game);
  if ((game.cargo[owner] ?? 0) < cost) throw new Error(`Recruitment needs ${cost} cargo.`);
  const amount = hireAmount(kind);
  if (ids !== undefined) {
    const existing = new Set([...game.rocks, ...game.fleets].flatMap(asset => asset.specialists ?? []).map(unit => unit.id));
    if (!Array.isArray(ids) || ids.length !== amount || new Set(ids).size !== amount || !Array.from(ids).every(id => typeof id === 'string' && /^[a-zA-Z0-9:-]{1,80}$/.test(id) && !existing.has(id))) throw new Error('Planned hire identities are no longer available.');
  }
  const units = Array.from({ length: amount }, (_, index): Specialist => ({ id: ids?.[index] ?? `unit-${game.nextId + index}`, owner, kind, ...(kind === 'tinkerer' || kind === 'sentry' ? { nextActionAt: game.hour + (kind === 'sentry' ? 2 : 1 / 3) } : {}) }));
  const result = withUnitEffects({ ...game, nextId: game.nextId + amount,
    cargo: { ...game.cargo, [owner]: (game.cargo[owner] ?? 0) - cost },
    recruitment: { ...game.recruitment!, [owner]: drawOffers({ ...state, used: state.used + 1, pool: { ...state.pool, [kind]: state.pool[kind]! - 1 } }, !!game.rules?.tacticalPulse) },
    rocks: game.rocks.map(r => r.id === status.at ? { ...r, specialists: [...(r.specialists ?? []), ...units] } : r),
    events: recentEvents([{ hour: game.hour, audience: observers(game, game.rocks.find(r => r.id === status.at)!), message: `${amount} ${specialistEventName(kind)}${amount > 1 ? ' units' : ''} recruited at the core${cost ? ` for ${cost} cargo` : ''}.` }, ...game.events]),
  });
  if (cost) { reconcileFunding(result); result.events = recentEvents(result.events); }
  return result;
}
export function promoteSpecialist(game: Game, owner: Faction, id: string): Game {
  const { state } = requireRecruitment(game, owner);
  const site = game.rocks.find(r => r.owner === owner && r.specialists?.some(u => u.id === id && u.owner === owner && !u.captive));
  const unit = site?.specialists?.find(u => u.id === id);
  const kind = unit && promotion(unit.kind);
  if (!site || !unit || !kind) throw new Error('Choose a promotable module at one of your sites.');
  if (kind === 'martyr' && !compactAllows(game, 'weapons')) throw new Error('Strategic weapons interlocks are active under the Belt compact.');
  return withUnitEffects({ ...game, recruitment: { ...game.recruitment!, [owner]: drawOffers({ ...state, used: state.used + 1 }, !!game.rules?.tacticalPulse) },
    rocks: game.rocks.map(r => r.id === site.id ? { ...r, specialists: r.specialists!.map(u => u.id === id ? { ...u, kind, ...(kind === 'sentry' ? { nextActionAt: game.hour + 2 } : {}) } : u) } : r),
    events: recentEvents([{ hour: game.hour, audience: observers(game, site), message: `${site.name}: ${specialistEventName(unit.kind)} promoted to ${specialistEventName(kind)}.` }, ...game.events]),
  });
}
export function cloneUnits<T extends Rock | Fleet>(asset: T): T { return { ...asset, ...(asset.specialists ? { specialists: asset.specialists.map(u => ({ ...u })) } : {}) }; }
export function upgradeSpecialists(input: Game): Game {
  if (input.version !== 2 || input.specialistVersion === 1) return input;
  const game: Game = { ...input, specialistVersion: 1, rocks: input.rocks.map(cloneUnits), fleets: input.fleets.map(cloneUnits), recruitment: input.recruitment ?? { you: newRecruitment(input.epoch), vesper: newRecruitment(input.epoch + 1), null: newRecruitment(input.epoch + 2) } };
  const mapping = { routing: 'helmsman', virus: 'thief', scavenger: 'pirate', charge: 'martyr' } as const;
  for (const rock of game.rocks) {
    rock.specialists ??= rock.coreOf ? [{ id: `core-${rock.coreOf}`, owner: rock.coreOf, kind: 'queen', ...(rock.owner !== rock.coreOf ? { captive: true } : {}) }] : [];
    if (rock.module && rock.owner) rock.specialists.push({ id: `legacy-rock-${rock.id}`, kind: mapping[rock.module], owner: rock.owner });
    delete rock.module;
  }
  for (const owner of ['you', 'vesper', 'null'] as const) {
    if (!game.eliminated.includes(owner) && ![...game.rocks, ...game.fleets].flatMap(a => a.specialists ?? []).some(u => u.owner === owner && u.kind === 'queen')) {
      const home = game.rocks.find(r => r.id === ({ you: 'a', vesper: 'e', null: 'g' }[owner]) && r.owner === owner && !r.destroyed);
      if (home) { home.specialists!.push({ id: `core-${owner}`, owner, kind: 'queen' }); home.coreOf = owner; }
    }
  }
  for (const fleet of game.fleets) {
    fleet.specialists ??= [];
    if (fleet.module) fleet.specialists.push({ id: `legacy-fleet-${fleet.id}`, kind: mapping[fleet.module], owner: fleet.owner });
    delete fleet.module;
  }
  game.scheduled = game.scheduled?.map(plan => {
    if (isActionPlan(plan) || !plan.module) return { ...plan };
    const { module: _module, ...rest } = plan;
    return { ...rest, specialists: [...(plan.specialists ?? []), `legacy-rock-${plan.from}`] };
  });
  return game;
}

export function manifestUnits(rock: Pick<Rock, 'specialists'>, owner: Faction, ids: string[]): Specialist[] {
  if (!Array.isArray(ids) || ids.length > 10000 || new Set(ids).size !== ids.length || ids.some(id => !rock.specialists?.some(u => u.id === id && u.owner === owner && !u.captive))) throw new Error('Choose available modules at the departure site.');
  return (rock.specialists ?? []).filter(u => ids.includes(u.id)).map(u => ({ ...u }));
}
