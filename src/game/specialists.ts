/**
 * ---
 * purpose: Specialist identity, time-based recruitment, promotion, and shared active-unit queries.
 * ---
 */
import { isActionPlan } from './future-actions';
import { withUnitEffects } from './specialist-effects';
import type { Faction, Fleet, Game, Rock } from './simulation';
import { HIRE_CATEGORIES, HIRE_KINDS, SPECIALISTS, hireAmount, promotion, type SpecialistKind } from './specialist-catalog';
import { recentEvents } from './events';
import { observers } from './sensors';

export type Specialist = { id: string; kind: SpecialistKind; owner: Faction; captive?: true; nextActionAt?: number; lastCourseAt?: number };
export type Recruitment = { used: number; seed: number; pool: Partial<Record<SpecialistKind, number>>; offers: SpecialistKind[] };
export function newRecruitment(seed: number): Recruitment { return drawOffers({ used: 0, seed: seed >>> 0, pool: {}, offers: [] }); }
function drawOffers(input: Recruitment): Recruitment {
  const next: Recruitment = { ...input, pool: { ...input.pool }, offers: [] };
  for (const category of HIRE_CATEGORIES) {
    const kinds = HIRE_KINDS.filter(k => SPECIALISTS[k].category === category);
    if (kinds.every(k => (next.pool[k] ?? 0) === 0)) for (const kind of kinds) next.pool[kind] = 3;
    const deck = kinds.flatMap(k => Array<SpecialistKind>(next.pool[k] ?? 0).fill(k));
    next.seed = (Math.imul(1664525, next.seed) + 1013904223) >>> 0;
    next.offers.push(deck[Math.floor(next.seed / 2 ** 32 * deck.length)]!);
  }
  return next;
}
export type UnitWorld = { rocks: readonly { id: string; owner?: Faction | null; specialists?: Specialist[] }[]; fleets: readonly { id: number; from: string; owner: Faction; preparing?: true; specialists?: Specialist[] }[] };
export function activeUnits(game: UnitWorld, owner?: Faction): Specialist[] {
  return [...game.rocks.flatMap(a => (a.specialists ?? []).filter(u => u.owner === a.owner)), ...game.fleets.flatMap(a => (a.specialists ?? []).filter(u => u.owner === a.owner))].filter(u => !u.captive && (owner === undefined || u.owner === owner));
}
export function unitsAtRock(game: UnitWorld, id: string): Specialist[] {
  return [...(game.rocks.find(r => r.id === id)?.specialists ?? []), ...game.fleets.filter(f => f.preparing && f.from === id).flatMap(f => f.specialists ?? [])].filter(u => !u.captive);
}
export function unitCount(game: UnitWorld, owner: Faction, kind: SpecialistKind): number { return activeUnits(game, owner).filter(u => u.kind === kind).length; }
export function recruitmentStatus(game: UnitWorld & { hour: number; recruitment?: Partial<Record<Faction, Pick<Recruitment, 'used' | 'offers'>>> }, owner: Faction): { credits: number; offers: SpecialistKind[]; nextAt: number; at?: string } {
  const state = game.recruitment?.[owner];
  const core = game.rocks.find(r => unitsAtRock(game, r.id).some(u => u.owner === owner && u.kind === 'queen'));
  const earned = game.hour < 4 ? 0 : 1 + Math.floor((game.hour - 4) / 18);
  return { credits: Math.max(0, earned - (state?.used ?? 0)), offers: state?.offers ?? [], nextAt: 4 + 18 * Math.max(earned, state?.used ?? 0), ...(core && core.owner === owner ? { at: core.id } : {}) };
}
function requireRecruitment(game: Game, owner: Faction): { status: ReturnType<typeof recruitmentStatus>; state: Recruitment } {
  const status = recruitmentStatus(game, owner);
  if (game.version !== 2 || game.winner || game.draw || game.eliminated.includes(owner) || !status.credits || !game.recruitment?.[owner]) throw new Error('Recruitment needs an active intelligence and an available hiring credit.');
  return { status, state: game.recruitment[owner] };
}
export function hireSpecialist(game: Game, owner: Faction, kind: SpecialistKind, ids?: readonly string[]): Game {
  const { status, state } = requireRecruitment(game, owner);
  if (!status.at) throw new Error('Hiring needs your active core at a controlled site.');
  if (!state.offers.includes(kind)) throw new Error('Choose one of the three current recruitment offers.');
  const amount = hireAmount(kind);
  if (ids !== undefined) {
    const existing = new Set([...game.rocks, ...game.fleets].flatMap(asset => asset.specialists ?? []).map(unit => unit.id));
    if (!Array.isArray(ids) || ids.length !== amount || new Set(ids).size !== amount || !Array.from(ids).every(id => typeof id === 'string' && /^[a-zA-Z0-9:-]{1,80}$/.test(id) && !existing.has(id))) throw new Error('Planned hire identities are no longer available.');
  }
  const units = Array.from({ length: amount }, (_, index): Specialist => ({ id: ids?.[index] ?? `unit-${game.nextId + index}`, owner, kind, ...(kind === 'tinkerer' || kind === 'sentry' ? { nextActionAt: game.hour + (kind === 'sentry' ? 2 : 1 / 3) } : {}) }));
  return withUnitEffects({ ...game, nextId: game.nextId + amount,
    recruitment: { ...game.recruitment!, [owner]: drawOffers({ ...state, used: state.used + 1, pool: { ...state.pool, [kind]: state.pool[kind]! - 1 } }) },
    rocks: game.rocks.map(r => r.id === status.at ? { ...r, specialists: [...(r.specialists ?? []), ...units] } : r),
    events: recentEvents([{ hour: game.hour, audience: observers(game, game.rocks.find(r => r.id === status.at)!), message: `${amount} ${SPECIALISTS[kind].name}${amount > 1 ? ' units' : ''} recruited at the core.` }, ...game.events]),
  });
}
export function promoteSpecialist(game: Game, owner: Faction, id: string): Game {
  const { state } = requireRecruitment(game, owner);
  const site = game.rocks.find(r => r.owner === owner && r.specialists?.some(u => u.id === id && u.owner === owner && !u.captive));
  const unit = site?.specialists?.find(u => u.id === id);
  const kind = unit && promotion(unit.kind);
  if (!site || !unit || !kind) throw new Error('Choose a promotable module at one of your sites.');
  return withUnitEffects({ ...game, recruitment: { ...game.recruitment!, [owner]: drawOffers({ ...state, used: state.used + 1 }) },
    rocks: game.rocks.map(r => r.id === site.id ? { ...r, specialists: r.specialists!.map(u => u.id === id ? { ...u, kind, ...(kind === 'sentry' ? { nextActionAt: game.hour + 2 } : {}) } : u) } : r),
    events: recentEvents([{ hour: game.hour, audience: observers(game, site), message: `${site.name}: ${SPECIALISTS[unit.kind].name} promoted to ${SPECIALISTS[kind].name}.` }, ...game.events]),
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
