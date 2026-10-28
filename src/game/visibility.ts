/**
 * ---
 * purpose: Redact authoritative state to a player's sensor observations and forecast only those observations.
 * ---
 */
import { publicRules, type PublicRules } from './rules';
import { playersIn } from './players';
import { unitCount, type Recruitment } from './specialists';
import { fundingCount, type Funding } from './funding';
import { HIRE_KINDS } from './specialist-catalog';
import { isActionPlan, mapActionUnits, mapActionFleets } from './future-actions';
import type { ScheduledOrder } from './orders';
import { EVENTS_PER_OBSERVER } from './events';
import { advance, type Faction, type Fleet, type Game, type Rock } from './simulation';
import { fleetPosition } from './flight';
import { canObserveHauler, inRange, sensors, type Sensor } from './sensors';
export type ObservedRock = (Rock & { known: true }) | (Pick<Rock, 'id' | 'name' | 'x' | 'y'> & { kind: Rock['kind'] | 'unknown'; known: false; destroyed?: never; owner?: Faction | null; drones?: never; module?: never; specialists?: never; coreOf?: never });
export type GameView = {
  rules?: PublicRules; funding?: Funding[]; standings?: Partial<Record<Faction, { cargo: number; funders: number }>>; fundingUncertain?: boolean;
  recruitment?: Partial<Record<Faction, Pick<Recruitment, 'used' | 'offers'>>>; recruitmentUncertain?: boolean;
  // Hidden territory leaves economy, routing, succession, and victory conditional.
  forecastUncertain?: boolean;
  version?: 1 | 2; minesDrilled?: Partial<Record<Faction, number>>;
  hour: number; epoch: number; rocks: ObservedRock[]; fleets: Fleet[];
  cargo: Partial<Record<Faction, number>>; eliminated: Faction[]; winner: Faction | null; draw?: true;
  scheduled: ScheduledOrder[]; events: { hour: number; message: string }[]; coverage: Sensor[]; uncertain: string[]; interceptionUncertain: boolean;
};
export function observe(game: Game, faction: Faction, identify: (id: number) => number = id => id, identifyUnit: (id: string) => string = id => id): GameView {
  const coverage = sensors(game, faction);
  const contacts = game.fleets.filter(f => canObserveHauler(game, faction, f, coverage)).sort((a, b) => a.id - b.id);
  const remoteTypes = game.version !== 2 || unitCount(game, faction, 'intelligence') > 0;
  const visibleIds = new Set(contacts.map(f => f.id));
  const publicFleet = (f: Fleet) => { const visible = { ...f }; delete visible.lastContacts; return visible; };
  const units = (asset: { specialists?: Game['rocks'][number]['specialists'] }) => asset.specialists ? { specialists: asset.specialists.map(u => ({ ...u, id: identifyUnit(u.id) })) } : {};
  return {
    ...(game.rules ? { rules: publicRules(game.rules) } : {}),
    ...(game.version === 2 ? { funding: (game.funding ?? []).filter(f => f.from === faction || f.to === faction).map(f => ({ ...f })), standings: Object.fromEntries((playersIn(game)).map(f => [f, { cargo: game.cargo[f] ?? 0, funders: fundingCount(game, f) }])) as NonNullable<GameView['standings']> } : {}),
    ...(game.recruitment?.[faction] ? { recruitment: { [faction]: { used: game.recruitment[faction].used, offers: [...game.recruitment[faction].offers] } } } : {}),
    version: game.version, ...(game.minesDrilled ? { minesDrilled: { [faction]: game.minesDrilled[faction] } } : {}),
    hour: game.hour, epoch: game.epoch,
    rocks: game.rocks.map(r => r.owner === faction || inRange(coverage, r, game)
      ? { ...r, ...units(r), known: true } : { id: r.id, name: r.name, x: r.x, y: r.y, kind: !r.destroyed && (remoteTypes || r.kind === 'mine') ? r.kind : 'unknown', known: false, ...(game.version === 2 ? { owner: r.owner } : {}) }),
    fleets: contacts.map(f => ({ ...publicFleet(f), ...units(f), id: identify(f.id), ...(f.route ? { route: { from: { ...f.route.from }, to: { ...f.route.to } } } : {}), ...(f.intercept ? { intercept: { home: f.intercept.home, ...(f.intercept.target !== undefined && visibleIds.has(f.intercept.target) ? { target: identify(f.intercept.target) } : {}) } } : {}) })),
    cargo: { [faction]: game.cargo[faction] }, eliminated: [...game.eliminated], winner: game.winner, ...(game.draw ? { draw: true } : {}),
    events: game.events.filter(e => e.audience?.includes(faction)).slice(0, EVENTS_PER_OBSERVER).map(e => ({ hour: e.hour, message: e.message })),
    scheduled: (game.scheduled ?? []).filter(p => p.owner === faction).map(p => isActionPlan(p) ? { ...p, ...(p.fleetId === undefined ? {} : { fleetId: identify(p.fleetId) }), action: mapActionFleets(mapActionUnits(p.action, identifyUnit), identify), ...(p.hireUnits ? { hireUnits: p.hireUnits.map(identifyUnit) } : {}) } : { ...p, ...(p.fleetId === undefined ? {} : { fleetId: identify(p.fleetId) }), ...(p.specialists ? { specialists: p.specialists.map(identifyUnit) } : {}) }),
    coverage, uncertain: [], interceptionUncertain: false,
  };
}
export function forecastObservation(view: GameView, faction: Faction, targetHour: number): GameView {
  if (!Number.isFinite(targetHour) || targetHour < view.hour) throw new Error('Time can only move forward.');
  const unknown = new Set(view.rocks.filter(r => !r.known).map(r => r.id));
  const identities = [...new Set([...view.fleets.map(f => f.id), ...view.scheduled.flatMap(p => p.fleetId === undefined ? [] : [p.fleetId]), ...view.scheduled.flatMap(p => !isActionPlan(p) ? [] : p.action.type === 'intercept' ? [p.action.target] : p.action.type === 'hauler' ? [p.action.change.fleet] : [])])];
  const ranks = new Map(identities.map((id, index) => [id, index + 1]));
  const rank = (id: number) => ranks.get(id)!;
  const orderedFleets = view.fleets.map((f, index) => ({ ...f, id: index + 1, ...(f.intercept ? { intercept: { home: f.intercept.home, target: f.intercept.target === undefined ? undefined : ranks.get(f.intercept.target) } } : {}) }));
  const unknownInterceptions = orderedFleets.filter(f => f.intercept && f.intercept.target === undefined).map(f => f.id);
  // Keep public owners in the view ledger, never on producing simulation placeholders.
  // Hidden destinations never participate in combat or production in a forecast.
  const simulation: Game = {
    ...(view.rules ? { rules: { ...view.rules, players: [...view.rules.players], map: { ...view.rules.map, seed: 0 } } } : {}),
    version: view.version ?? 1, ...(view.version === 2 ? { specialistVersion: 1 as const } : {}), hour: view.hour, epoch: view.epoch,
    ...(view.recruitment ? { recruitment: Object.fromEntries(playersIn(view).map(f => [f, { used: view.recruitment?.[f]?.used ?? 0, offers: view.recruitment?.[f]?.offers ?? [], seed: 0, pool: Object.fromEntries(HIRE_KINDS.map(k => [k, 3])) }])) as Record<Faction, Recruitment> } : {}),
    ...(view.version === 2 ? { minesDrilled: { you: 0, vesper: 0, null: 0, ...view.minesDrilled } } : {}),
    rocks: view.rocks.map(r => r.known ? { ...r } : { id: r.id, name: r.name, x: r.x, y: r.y, kind: r.kind === 'unknown' ? 'factory' : r.kind, owner: null, drones: 0 }),
    fleets: orderedFleets.map(f => ({ ...f })),
    scheduled: view.scheduled.map(p => ({ ...p, ...(p.fleetId === undefined ? {} : { fleetId: rank(p.fleetId) }), ...(isActionPlan(p) ? { action: mapActionFleets(p.action, rank) } : {}) })),
    funding: view.funding?.map(f => ({ ...f })),
    cargo: Object.fromEntries(playersIn(view).map(f => [f, view.cargo[f] ?? view.standings?.[f]?.cargo ?? 0])),
    eliminated: [...view.eliminated], winner: view.winner, ...(view.draw ? { draw: true } : {}),
    nextId: identities.length + 1,
    events: view.events.map(e => ({ ...e, audience: [faction] })),
  };
  const incompleteObservation = view.version === 2 && (unknown.size > 0 || !!view.forecastUncertain);
  const predicted = advance(simulation, targetHour, { rivals: false, unknownDestinations: [...unknown], unknownInterceptions, incompleteObservation });
  predicted.fleets.sort((a, b) => a.id - b.id);
  const projected = observe(predicted, faction);
  const alias = (id: number) => identities[id - 1] ?? Math.min(0, ...identities) - id;
  projected.fleets = projected.fleets.map(f => ({ ...f, id: alias(f.id), ...(f.intercept ? { intercept: { home: f.intercept.home, ...(f.intercept.target !== undefined ? { target: alias(f.intercept.target) } : {}) } } : {}) }));
  projected.scheduled = projected.scheduled.map(p => ({ ...p, ...(p.fleetId === undefined ? {} : { fleetId: alias(p.fleetId) }), ...(isActionPlan(p) ? { action: mapActionFleets(p.action, alias) } : {}) }));
  if (view.recruitmentUncertain || projected.recruitment?.[faction]?.used !== view.recruitment?.[faction]?.used) {
    projected.recruitmentUncertain = true;
    if (projected.recruitment?.[faction]) projected.recruitment[faction]!.offers = [];
  }
  projected.rocks = projected.rocks.map(r => unknown.has(r.id) ? { ...view.rocks.find(original => original.id === r.id)! } : r);
  projected.uncertain = [...new Set([...view.uncertain, ...predicted.events.filter(e => e.unresolvedDestination).map(e => e.unresolvedDestination!)])];
  if (incompleteObservation) projected.forecastUncertain = true;
  projected.interceptionUncertain = view.interceptionUncertain || predicted.events.some(e => e.unresolvedInterception);
  projected.fundingUncertain = view.fundingUncertain || !!view.funding?.length && unknown.size > 0;
  for (const f of playersIn(view)) {
    const anonymous = Math.max(0, (view.standings?.[f]?.funders ?? 0) - fundingCount(view, f));
    if (anonymous) {
      projected.fundingUncertain = true;
      if (projected.standings && !projected.eliminated.includes(f)) projected.standings[f]!.funders += anonymous;
    }
  }
  return projected;
}
