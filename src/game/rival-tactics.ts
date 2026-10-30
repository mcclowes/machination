/**
 * ---
 * purpose: Bounded rival defense, attack validation, and logistics using the authoritative simulation.
 * related:
 *   - ./rival-ai.ts - policy, investment, and decision cadence
 * ---
 */
import { advance, dispatch, type Faction, type Game, type Rock } from './simulation';
import { allied } from './teams';
import { hasReserves } from './depletion';
import { worldDistance } from './geometry';
import { ALL_PLAYERS, playersIn } from './players';
import { FACTORY_OUTPUT, maximumShield } from './economy';
import { workBetween } from './opening-clock';
import { unitCount, type Specialist } from './specialists';

export const RIVAL_LOOKAHEAD = 12;
const MAX_ATTACK_CANDIDATES = 4;
const MOBILE_KINDS = new Set(['thief', 'infiltrator', 'lieutenant', 'warHero', 'assassin', 'helmsman', 'smuggler', 'elder', 'engineer']);
export const byId = (a: { id: string }, b: { id: string }): number => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
export const ownsKing = (rock: Rock, owner: Faction): boolean => !!rock.specialists?.some(u => u.owner === owner && u.kind === 'queen' && !u.captive);
export const ownedSites = (game: Game, owner: Faction): Rock[] => game.rocks.filter(r => !r.destroyed && r.owner === owner);
export const mobileUnits = (rock: Rock, owner: Faction): Specialist[] => (rock.specialists ?? []).filter(u => u.owner === owner && !u.captive && MOBILE_KINDS.has(u.kind));

export type RivalForecast = (game: Game, hour: number) => Game | undefined;
export const RIVAL_FORECAST_BUDGET = 8;
/** One decision owns its cache and budget; speculative advances never run rival decisions. */
export function createRivalForecast(game: Game): RivalForecast {
  let remaining = playersIn(game).length > 4 ? 4 : RIVAL_FORECAST_BUDGET;
  const cache = new WeakMap<Game, Map<number, Game>>();
  return (game, hour) => {
    const target = Math.min(hour, game.hour + RIVAL_LOOKAHEAD);
    let states = cache.get(game);
    if (!states) { states = new Map([[game.hour, game]]); cache.set(game, states); }
    if (states.has(target)) return states.get(target)!;
    if (remaining-- <= 0) return undefined;
    const earlier = [...states.keys()].filter(h => h <= target).sort((a, b) => b - a)[0]!;
    let future = states.get(earlier)!;
    for (let next = Math.floor(earlier) + 1; next < target && !future.winner && !future.draw; next++) {
      future = advance(future, next, { rivals: false });
      states.set(next, future);
    }
    future = advance(future, target, { rivals: false });
    states.set(target, future);
    return future;
  };
}
export function reserve(game: Game, rock: Rock, owner: Faction): number {
  const incoming = game.fleets.filter(f => f.owner !== owner && f.giftAt === undefined && f.to === rock.id && f.arrives <= game.hour + RIVAL_LOOKAHEAD && !game.eliminated.includes(f.owner));
  const shields = rock.shieldsDisabled ? 0 : rock.shield ?? 0;
  const threat = incoming.reduce((n, f) => n + f.drones, 0);
  return Math.max(ownsKing(rock, owner) ? 24 : 6, threat - shields + (incoming.length ? 8 : 0));
}
export const surplus = (game: Game, rock: Rock, owner: Faction): number => Math.max(0, Math.floor(rock.drones - reserve(game, rock, owner)));
export function siteValue(game: Game, rock: Rock, owner: Faction): number {
  if (rock.destroyed) return 0;
  if (ownsKing(rock, rock.owner!)) return 600;
  if (!hasReserves(rock)) return 0;
  const personality = ALL_PLAYERS.indexOf(owner) % 3;
  const value = rock.kind === 'mine' ? (game.rules?.mode === 'domination' ? 35 : 100) : rock.kind === 'factory' ? 65 : 45;
  return value + (personality === 0 && rock.owner ? 25 : personality === 1 && !rock.owner ? 25 : personality === 2 && rock.kind === 'mine' ? 30 : 0);
}
function held(game: Game | undefined, id: string, owner: Faction): boolean {
  return !!game && !game.eliminated.includes(owner) && game.rocks.some(r => r.id === id && r.owner === owner && !r.destroyed);
}
function order(game: Game, source: Rock, target: Rock, drones: number, owner: Faction, units: Specialist[] = []): Game {
  return dispatch(game, source.id, target.id, drones, owner, false, units.map(u => u.id));
}
function sourceSafe(game: Game, sent: Game, source: Rock, owner: Faction, forecast: RivalForecast): boolean {
  const lastThreat = Math.max(game.hour, ...game.fleets.filter(f => f.owner !== owner && f.to === source.id && f.giftAt === undefined && f.arrives <= game.hour + RIVAL_LOOKAHEAD).map(f => f.arrives));
  return lastThreat === game.hour || held(forecast(sent, lastThreat), source.id, owner);
}

export function defendSites(input: Game, owner: Faction, forecast: RivalForecast): Game {
  let game = input;
  const contacts = game.fleets.filter(f => f.owner !== owner && f.giftAt === undefined && f.arrives <= game.hour + 6 && ownedSites(game, owner).some(r => r.id === f.to));
  const pulseThreat = game.pulse?.pulses.some(p => p.factionId !== owner);
  if (!contacts.length && !pulseThreat) return game;
  const baseline = forecast(game, pulseThreat ? game.hour + RIVAL_LOOKAHEAD : Math.max(...contacts.map(f => f.arrives)));
  if (!baseline) return game;
  const threatened = ownedSites(game, owner).filter(r => !held(baseline, r.id, owner))
    .sort((a, b) => Number(ownsKing(b, owner)) - Number(ownsKing(a, owner)) || siteValue(game, b, owner) - siteValue(game, a, owner) || byId(a, b));
  // At most three emergencies per decision; leadership is always considered first.
  for (const oldTarget of threatened.slice(0, 3)) {
    const target = game.rocks.find(r => r.id === oldTarget.id)!;
    const hostile = game.fleets.filter(f => f.owner !== owner && f.giftAt === undefined && f.to === target.id && f.arrives <= game.hour + RIVAL_LOOKAHEAD).sort((a, b) => a.arrives - b.arrives || a.id - b.id);
    const deadline = hostile.find(f => !held(forecast(game, f.arrives), target.id, owner))?.arrives;
    if (deadline !== undefined) {
      const donors = ownedSites(game, owner).filter(r => r.id !== target.id && surplus(game, r, owner) > 0)
        .sort((a, b) => worldDistance(game, a, target) - worldDistance(game, b, target) || byId(a, b)).slice(0, 3);
      let reinforced = game;
      for (const donor of donors) {
        const source = reinforced.rocks.find(r => r.id === donor.id)!;
        const amount = surplus(reinforced, source, owner);
        if (!amount) continue;
        const sent = order(reinforced, source, target, amount, owner, mobileUnits(source, owner));
        if (sent.fleets.at(-1)!.arrives >= deadline || !sourceSafe(reinforced, sent, source, owner, forecast)) continue;
        reinforced = sent;
        if (held(forecast(reinforced, deadline), target.id, owner)) { game = reinforced; break; }
      }
    }
    if (ownsKing(target, owner) && !held(forecast(game, game.hour + RIVAL_LOOKAHEAD), target.id, owner)) game = evacuateKing(game, target, owner, forecast);
  }
  return game;
}
function evacuateKing(game: Game, source: Rock, owner: Faction, forecast: RivalForecast): Game {
  const units = (source.specialists ?? []).filter(u => u.owner === owner && !u.captive && u.kind !== 'martyr');
  const destinations = ownedSites(game, owner).filter(r => r.id !== source.id)
    .sort((a, b) => (b.drones + (game.pulse?.shields[b.id]?.energy ?? 0)) - (a.drones + (game.pulse?.shields[a.id]?.energy ?? 0)) || byId(a, b)).slice(0, 6);
  for (const destination of destinations) {
    const sent = order(game, source, destination, Math.floor(source.drones), owner, units);
    const arrival = sent.fleets.at(-1)!.arrives;
    if (arrival + 3 > game.hour + RIVAL_LOOKAHEAD) continue;
    const future = forecast(sent, arrival + 3);
    if (future && !future.eliminated.includes(owner) && held(future, destination.id, owner)
      && future.rocks.some(r => r.id === destination.id && ownsKing(r, owner))) return sent;
  }
  return game;
}

function plausibleAttack(game: Game, source: Rock, target: Rock, owner: Faction): boolean {
  if (game.fleets.some(f => f.to === target.id)) return true;
  const units = mobileUnits(source, owner);
  const has = (kind: string) => units.some(u => u.kind === kind);
  const defending = (target.specialists ?? []).filter(u => !u.captive && u.owner === target.owner);
  if (defending.some(u => u.kind === 'martyr') && !has('elder')) return false;
  const ability = units.reduce((n, u) => n + (u.kind === 'warHero' ? 20 : u.kind === 'lieutenant' ? 5 : 0), 0)
    + (units.length ? 10 * unitCount(game, owner, 'general') : 0);
  const shields = has('infiltrator') || target.shieldsDisabled || !target.owner ? 0 : target.shield ?? 0;
  const drones = target.drones * (has('thief') ? 0.7 : 1);
  const available = surplus(game, source, owner);
  return available + ability + (unitCount(game, owner, 'king') ? Math.floor(available / 4) : 0) > drones + shields;
}

export function attackSites(input: Game, owner: Faction, forecast: RivalForecast, savingAt?: string): Game {
  let game = input;
  const usedSources = new Set<string>();
  // Replan after each launch so committed troops and destinations are accounted for.
  for (let action = 0; action < 2; action++) {
    const candidates = ownedSites(game, owner).filter(r => r.id !== savingAt && surplus(game, r, owner) > 0 && !usedSources.has(r.id)).flatMap(source =>
      game.rocks.filter(target => !target.destroyed && (!target.owner || !allied(game, owner, target.owner)) && siteValue(game, target, owner) > 0
        && plausibleAttack(game, source, target, owner)).map(target => ({ source, target,
        score: siteValue(game, target, owner) / (2 + worldDistance(game, source, target) / 8) - target.drones * 0.2,
      }))).sort((a, b) => b.score - a.score || byId(a.target, b.target) || byId(a.source, b.source)).slice(0, MAX_ATTACK_CANDIDATES);
    let launched = false;
    for (const { source, target } of candidates) {
      const available = surplus(game, source, owner);
      const units = mobileUnits(source, owner);
      const probe = order(game, source, target, available, owner, units);
      const arrival = probe.fleets.at(-1)!.arrives;
      if (arrival > game.hour + RIVAL_LOOKAHEAD) continue;
      if (game.fleets.some(f => f.owner === owner && f.to === target.id)) {
        const expected = forecast(game, arrival);
        if (!expected || expected.rocks.some(r => r.id === target.id && (r.owner === owner || r.destroyed))) continue;
      }
      const production = target.owner && target.kind === 'factory' ? Math.min(target.reserves ?? Infinity, FACTORY_OUTPUT * Math.ceil(workBetween(game, game.hour, arrival) / (target.productionInterval ?? 8))) : 0;
      const estimate = Math.ceil(target.drones + production + (target.shieldsDisabled || !target.owner ? 0 : maximumShield(target)) + 8);
      // Validate both ordinary combat and specialist effects with the real engine.
      const amounts = [...new Set([Math.min(available, Math.max(1, estimate)), available])];
      for (const amount of amounts) {
        const sent = amount === available ? probe : order(game, source, target, amount, owner, units);
        const outcome = forecast(sent, arrival);
        if (!held(outcome, target.id, owner) || !sourceSafe(game, sent, source, owner, forecast)) continue;
        game = sent; usedSources.add(source.id); launched = true; break;
      }
      if (launched) break;
    }
    if (!launched) break;
  }
  return game;
}

export function reinforceFront(input: Game, owner: Faction, forecast: RivalForecast, savingAt?: string): Game {
  const sites = ownedSites(input, owner);
  const enemies = input.rocks.filter(r => !r.destroyed && (!r.owner || !allied(input, owner, r.owner)) && siteValue(input, r, owner) > 0);
  if (!enemies.length) return input;
  const distance = (r: Rock) => Math.min(...enemies.map(e => worldDistance(input, r, e)));
  const front = savingAt ? sites.find(r => r.id === savingAt) : [...sites].sort((a, b) => distance(a) - distance(b) || byId(a, b))[0];
  if (!front) return input;
  const donor = sites.filter(r => r.id !== front.id && r.id !== savingAt && surplus(input, r, owner) >= 10
    && (savingAt || distance(r) > distance(front) + 5)
    && !input.fleets.some(f => f.owner === owner && f.from === r.id && f.to === front.id))
    .sort((a, b) => surplus(input, b, owner) - surplus(input, a, owner) || byId(a, b))[0];
  if (!donor) return input;
  const sent = order(input, donor, front, surplus(input, donor, owner), owner, mobileUnits(donor, owner));
  const arrival = sent.fleets.at(-1)!.arrives;
  return arrival <= input.hour + RIVAL_LOOKAHEAD && held(forecast(sent, arrival), front.id, owner) && sourceSafe(input, sent, donor, owner, forecast) ? sent : input;
}
