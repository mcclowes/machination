/**
 * ---
 * purpose: Build a simulation strictly from a player's observation, preserving opaque contact identities.
 * ---
 */
import { cloneCompact } from './compact';
import { clonePulse } from './pulse';
import { playersIn } from './players';
import { HIRE_KINDS } from './specialist-catalog';
import { isActionPlan, mapActionFleets } from './future-actions';
import type { Recruitment } from './specialists';
import type { Faction, Game } from './simulation';
import type { GameView } from './visibility';

export function simulationFromObservation(view: GameView, faction: Faction) {
  const unknown = new Set(view.rocks.filter(r => !r.known).map(r => r.id));
  const identities = [...new Set([...view.fleets.map(f => f.id), ...view.scheduled.flatMap(p => p.fleetId === undefined ? [] : [p.fleetId]), ...view.scheduled.flatMap(p => !isActionPlan(p) ? [] : p.action.type === 'intercept' ? [p.action.target] : p.action.type === 'hauler' ? [p.action.change.fleet] : [])])];
  const ranks = new Map(identities.map((id, index) => [id, index + 1]));
  const rank = (id: number) => ranks.get(id)!;
  const orderedFleets = view.fleets.map((f, index) => ({ ...f, id: index + 1, ...(f.intercept ? { intercept: { home: f.intercept.home, target: f.intercept.target === undefined ? undefined : ranks.get(f.intercept.target) } } : {}) }));
  const unknownInterceptions = orderedFleets.filter(f => f.intercept && f.intercept.target === undefined).map(f => f.id);
  // Keep public owners in the view ledger, never on producing simulation placeholders.
  // Hidden destinations never participate in combat or production in a forecast.
  const simulation: Game = {
    ...(view.compact ? { compact: cloneCompact(view.compact) } : {}),
    ...(view.pulse ? { pulse: clonePulse({ ...view.pulse, receipts: {} }) } : {}),
    ...(view.rules ? { rules: { ...view.rules, players: [...view.rules.players], map: { ...view.rules.map, seed: 0 } } } : {}),
    version: view.version ?? 1, ...(view.version === 2 ? { specialistVersion: 1 as const } : {}), hour: view.hour, epoch: view.epoch,
    ...(view.recruitment ? { recruitment: Object.fromEntries(playersIn(view).map(f => [f, { used: view.recruitment?.[f]?.used ?? 0, offers: view.recruitment?.[f]?.offers ?? [], seed: 0, pool: Object.fromEntries(HIRE_KINDS.map(k => [k, 3])) }])) as Record<Faction, Recruitment> } : {}),
    ...(view.version === 2 ? { minesDrilled: { you: 0, vesper: 0, null: 0, ...view.minesDrilled } } : {}),
    rocks: view.rocks.map(r => r.known ? { ...r } : { id: r.id, name: r.name, x: r.x, y: r.y, ...(r.drift ? { drift: r.drift } : {}), kind: r.kind === 'unknown' ? 'factory' : r.kind, owner: null, drones: 0 }),
    fleets: orderedFleets.map(f => ({ ...f })),
    scheduled: view.scheduled.map(p => ({ ...p, ...(p.fleetId === undefined ? {} : { fleetId: rank(p.fleetId) }), ...(isActionPlan(p) ? { action: mapActionFleets(p.action, rank) } : {}) })),
    funding: view.funding?.map(f => ({ ...f })),
    cargo: Object.fromEntries(playersIn(view).map(f => [f, view.cargo[f] ?? view.standings?.[f]?.cargo ?? 0])),
    eliminated: [...view.eliminated], winner: view.winner, ...(view.draw ? { draw: true } : {}),
    nextId: identities.length + 1,
    events: view.events.map(e => ({ ...e, audience: [faction] })),
  };
  if (simulation.pulse?.tactical) for (const wave of simulation.pulse.tactical.waves) wave.hitFleets = wave.hitFleets.map(rank).filter(id => id !== undefined);
  const territoryOwners = new Map(view.rocks.flatMap(r => !r.known && r.owner !== undefined ? [[r.id, r.owner] as const] : []));
  const alias = (id: number) => identities[id - 1] ?? Math.min(0, ...identities) - id;
  return { simulation, unknown, rank, alias, unknownInterceptions, territoryOwners };
}
