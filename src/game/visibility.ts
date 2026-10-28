/**
 * ---
 * purpose: Redact authoritative state to a player's sensor observations and forecast only those observations.
 * ---
 */
import type { Recruitment } from './specialists';
import { HIRE_KINDS } from './specialist-catalog';
import type { ScheduledTransfer } from './orders';
import { EVENTS_PER_OBSERVER } from './events';
import { advance, type Faction, type Fleet, type Game, type Rock } from './simulation';
import { fleetPosition } from './flight';
import { inRange, sensors, type Sensor } from './sensors';
export type ObservedRock = (Rock & { known: true }) | (Pick<Rock, 'id' | 'name' | 'x' | 'y' | 'kind'> & { known: false; destroyed?: never; owner?: never; drones?: never; module?: never; specialists?: never; coreOf?: never });
export type GameView = {
  recruitment?: Partial<Record<Faction, Pick<Recruitment, 'used' | 'offers'>>>;
  version?: 1 | 2; minesDrilled?: Partial<Record<Faction, number>>;
  hour: number; epoch: number; rocks: ObservedRock[]; fleets: Fleet[];
  cargo: Partial<Record<Faction, number>>; eliminated: Faction[]; winner: Faction | null; draw?: true;
  scheduled: ScheduledTransfer[]; events: { hour: number; message: string }[]; coverage: Sensor[]; uncertain: string[]; interceptionUncertain: boolean;
};
export function observe(game: Game, faction: Faction, identify: (id: number) => number = id => id, identifyUnit: (id: string) => string = id => id): GameView {
  const coverage = sensors(game, faction);
  const contacts = game.fleets.filter(f => f.owner === faction || !f.preparing && inRange(coverage, fleetPosition(game, f))).sort((a, b) => a.id - b.id);
  const visibleIds = new Set(contacts.map(f => f.id));
  const publicFleet = (f: Fleet) => { const visible = { ...f }; delete visible.lastContacts; return visible; };
  const units = (asset: { specialists?: Game['rocks'][number]['specialists'] }) => asset.specialists ? { specialists: asset.specialists.map(u => ({ ...u, id: identifyUnit(u.id) })) } : {};
  return {
    ...(game.recruitment ? { recruitment: { [faction]: { used: game.recruitment[faction].used, offers: [...game.recruitment[faction].offers] } } } : {}),
    version: game.version, ...(game.minesDrilled ? { minesDrilled: { [faction]: game.minesDrilled[faction] } } : {}),
    hour: game.hour, epoch: game.epoch,
    rocks: game.rocks.map(r => r.owner === faction || inRange(coverage, r)
      ? { ...r, ...units(r), known: true } : { id: r.id, name: r.name, x: r.x, y: r.y, kind: r.kind, known: false }),
    fleets: contacts.map(f => ({ ...publicFleet(f), ...units(f), id: identify(f.id), ...(f.route ? { route: { from: { ...f.route.from }, to: { ...f.route.to } } } : {}), ...(f.intercept ? { intercept: { home: f.intercept.home, ...(f.intercept.target !== undefined && visibleIds.has(f.intercept.target) ? { target: identify(f.intercept.target) } : {}) } } : {}) })),
    cargo: { [faction]: game.cargo[faction] }, eliminated: [...game.eliminated], winner: game.winner, ...(game.draw ? { draw: true } : {}),
    events: game.events.filter(e => e.audience?.includes(faction)).slice(0, EVENTS_PER_OBSERVER).map(e => ({ hour: e.hour, message: e.message })),
    scheduled: (game.scheduled ?? []).filter(p => p.owner === faction).map(p => ({ ...p, ...(p.specialists ? { specialists: p.specialists.map(identifyUnit) } : {}) })),
    coverage, uncertain: [], interceptionUncertain: false,
  };
}
export function forecastObservation(view: GameView, faction: Faction, targetHour: number): GameView {
  if (!Number.isFinite(targetHour) || targetHour < view.hour) throw new Error('Time can only move forward.');
  const unknown = new Set(view.rocks.filter(r => !r.known).map(r => r.id));
  const ranks = new Map(view.fleets.map((f, index) => [f.id, index + 1]));
  const orderedFleets = view.fleets.map((f, index) => ({ ...f, id: index + 1, ...(f.intercept ? { intercept: { home: f.intercept.home, target: f.intercept.target === undefined ? undefined : ranks.get(f.intercept.target) } } : {}) }));
  const unknownInterceptions = orderedFleets.filter(f => f.intercept && f.intercept.target === undefined).map(f => f.id);
  // Hidden destinations never participate in combat or production in a forecast.
  const simulation: Game = {
    version: view.version ?? 1, ...(view.version === 2 ? { specialistVersion: 1 as const } : {}), hour: view.hour, epoch: view.epoch,
    ...(view.recruitment ? { recruitment: Object.fromEntries((['you', 'vesper', 'null'] as Faction[]).map(f => [f, { used: view.recruitment?.[f]?.used ?? 0, offers: view.recruitment?.[f]?.offers ?? [], seed: 0, pool: Object.fromEntries(HIRE_KINDS.map(k => [k, 3])) }])) as Record<Faction, Recruitment> } : {}),
    ...(view.version === 2 ? { minesDrilled: { you: 0, vesper: 0, null: 0, ...view.minesDrilled } } : {}),
    rocks: view.rocks.map(r => r.known ? { ...r } : { id: r.id, name: r.name, x: r.x, y: r.y, kind: r.kind, owner: null, drones: 0 }),
    fleets: orderedFleets.map(f => ({ ...f })),
    scheduled: view.scheduled.map(p => ({ ...p })),
    cargo: { you: 0, vesper: 0, null: 0, [faction]: view.cargo[faction] ?? 0 },
    eliminated: [...view.eliminated], winner: view.winner, ...(view.draw ? { draw: true } : {}),
    nextId: Math.max(0, ...orderedFleets.map(f => f.id)) + 1,
    events: view.events.map(e => ({ ...e, audience: [faction] })),
  };
  const predicted = advance(simulation, targetHour, { rivals: false, unknownDestinations: [...unknown], unknownInterceptions });
  predicted.fleets.sort((a, b) => a.id - b.id);
  const projected = observe(predicted, faction);
  const alias = (id: number) => view.fleets[id - 1]?.id ?? Math.min(0, ...view.fleets.map(f => f.id)) - id;
  projected.fleets = projected.fleets.map(f => ({ ...f, id: alias(f.id), ...(f.intercept ? { intercept: { home: f.intercept.home, ...(f.intercept.target !== undefined ? { target: alias(f.intercept.target) } : {}) } } : {}) }));
  projected.rocks = projected.rocks.map(r => unknown.has(r.id) ? { ...view.rocks.find(original => original.id === r.id)! } : r);
  projected.uncertain = [...new Set([...view.uncertain, ...predicted.events.filter(e => e.unresolvedDestination).map(e => e.unresolvedDestination!)])];
  projected.interceptionUncertain = view.interceptionUncertain || predicted.events.some(e => e.unresolvedInterception);
  return projected;
}
