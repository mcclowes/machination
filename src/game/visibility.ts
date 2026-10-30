/**
 * ---
 * purpose: Redact authoritative state to a player's sensor observations and forecast only those observations.
 * ---
 */
import { clonePulse, type PulseSystem } from './pulse';
import { sitePosition } from './drift';
import { publicRules, type PublicRules } from './rules';
import { playersIn } from './players';
import { unitCount, type Recruitment } from './specialists';
import { fundingCount, type Funding } from './funding';
import { simulationFromObservation } from './observation-simulation';
import { isActionPlan, mapActionUnits, mapActionFleets } from './future-actions';
import type { ScheduledOrder } from './orders';
import { EVENTS_PER_OBSERVER } from './events';
import { advance, type Faction, type Fleet, type Game, type Rock } from './simulation';
import { fleetPosition } from './flight';
import { canObserveHauler, inRange, sensors, type Sensor } from './sensors';
export type ObservedRock = (Rock & { known: true }) | (Pick<Rock, 'id' | 'name' | 'x' | 'y' | 'drift'> & { kind: Rock['kind'] | 'unknown'; known: false; destroyed?: never; owner?: Faction | null; drones?: never; module?: never; specialists?: never; coreOf?: never });
export type GameView = {
  pulse?: Omit<PulseSystem, 'receipts'>; rules?: PublicRules; funding?: Funding[]; standings?: Partial<Record<Faction, { cargo: number; funders: number }>>; fundingUncertain?: boolean;
  recruitment?: Partial<Record<Faction, Pick<Recruitment, 'used' | 'offers'>>>; recruitmentUncertain?: boolean;
  // Hidden territory leaves economy, routing, succession, and victory conditional.
  forecastUncertain?: boolean;
  version?: 1 | 2; minesDrilled?: Partial<Record<Faction, number>>;
  hour: number; epoch: number; rocks: ObservedRock[]; fleets: Fleet[];
  cargo: Partial<Record<Faction, number>>; eliminated: Faction[]; winner: Faction | null; draw?: true;
  scheduled: ScheduledOrder[]; events: { hour: number; message: string }[]; coverage: Sensor[]; uncertain: string[]; interceptionUncertain: boolean;
};
export function observe(game: Game, faction: Faction, identify: (id: number) => number = id => id, identifyUnit: (id: string) => string = id => id): GameView {
  game = { ...game, rocks: game.rocks.map(r => r.drift ? { ...r, ...sitePosition(game, r, game.hour) } : r) };
  const coverage = sensors(game, faction);
  const contacts = game.fleets.filter(f => canObserveHauler(game, faction, f, coverage)).sort((a, b) => a.id - b.id);
  const remoteTypes = game.version !== 2 || unitCount(game, faction, 'intelligence') > 0;
  const visibleIds = new Set(contacts.map(f => f.id));
  const publicFleet = (f: Fleet) => { const visible = { ...f }; delete visible.lastContacts; if (f.owner !== faction) delete visible.pendingCourse; else if (f.pendingCourse) visible.pendingCourse = { ...f.pendingCourse }; return visible; };
  const units = (asset: { specialists?: Game['rocks'][number]['specialists'] }) => asset.specialists ? { specialists: asset.specialists.map(u => ({ ...u, id: identifyUnit(u.id) })) } : {};
  const pulse = game.pulse && clonePulse(game.pulse);
  if (pulse) {
    pulse.kings = pulse.kings.filter(k => k.factionId === faction || game.rocks.some(r => r.specialists?.some(u => u.id === k.kingId) && (r.owner === faction || inRange(coverage, r, game))) || contacts.some(f => f.specialists?.some(u => u.id === k.kingId))).map(k => ({ ...k, kingId: identifyUnit(k.kingId) }));
    pulse.pulses = pulse.pulses.map(p => ({ ...p, id: `pulse-${p.factionId}-${p.firedAt}`, kingId: identifyUnit(p.kingId) }));
    if (pulse.tactical) {
      pulse.tactical.charges = pulse.tactical.charges.filter(c => c.factionId === faction).map(c => ({ ...c, specialistId: identifyUnit(c.specialistId) }));
      pulse.tactical.waves = pulse.tactical.waves.map((w, index) => ({ ...w,
        id: `tactical-${w.factionId}-${w.firedAt}-${index}`, specialistId: w.factionId === faction ? identifyUnit(w.specialistId) : `tactical-emitter-${w.factionId}-${w.firedAt}-${index}`,
        hitSites: w.hitSites.filter(id => game.rocks.some(r => r.id === id && (r.owner === faction || inRange(coverage, r, game)))),
        hitFleets: w.hitFleets.filter(id => visibleIds.has(id)).map(identify),
      }));
      pulse.tactical.resistance = Object.fromEntries(Object.entries(pulse.tactical.resistance).filter(([id]) => pulse.kings.some(k => k.kingId === identifyUnit(id))).map(([id, until]) => [identifyUnit(id), until]));
    }
    pulse.shields = Object.fromEntries(Object.entries(pulse.shields).filter(([id]) => game.rocks.some(r => r.id === id && r.owner === faction)));
    pulse.modifiers = pulse.modifiers.filter(m => m.factionId === faction || m.type === 'pulse_speed' && pulse.pulses.some(p => p.factionId === m.factionId));
  }
  const { receipts: _receipts, ...disclosedPulse } = pulse ?? { receipts: {} };
  return {
    ...(pulse ? { pulse: disclosedPulse as Omit<PulseSystem, 'receipts'> } : {}),
    ...(game.rules ? { rules: publicRules(game.rules) } : {}),
    ...(game.version === 2 ? { funding: (game.funding ?? []).filter(f => f.from === faction || f.to === faction).map(f => ({ ...f })), standings: Object.fromEntries((playersIn(game)).map(f => [f, { cargo: game.cargo[f] ?? 0, funders: fundingCount(game, f) }])) as NonNullable<GameView['standings']> } : {}),
    ...(game.recruitment?.[faction] ? { recruitment: { [faction]: { used: game.recruitment[faction].used, offers: [...game.recruitment[faction].offers] } } } : {}),
    version: game.version, ...(game.minesDrilled ? { minesDrilled: { [faction]: game.minesDrilled[faction] } } : {}),
    hour: game.hour, epoch: game.epoch,
    rocks: game.rocks.map(r => r.owner === faction || inRange(coverage, r, game)
      ? { ...r, ...units(r), known: true } : { id: r.id, name: r.name, x: r.x, y: r.y, ...(r.drift ? { drift: r.drift } : {}), kind: !r.destroyed && (remoteTypes || r.kind === 'mine') ? r.kind : 'unknown', known: false, ...(game.version === 2 ? { owner: r.owner } : {}) }),
    fleets: contacts.map(f => ({ ...publicFleet(f), ...units(f), id: identify(f.id), ...(f.route ? { route: { from: { ...f.route.from }, to: { ...f.route.to } } } : {}), ...(f.intercept ? { intercept: { home: f.intercept.home, ...(f.intercept.target !== undefined && visibleIds.has(f.intercept.target) ? { target: identify(f.intercept.target) } : {}) } } : {}) })),
    cargo: { [faction]: game.cargo[faction] }, eliminated: [...game.eliminated], winner: game.winner, ...(game.draw ? { draw: true } : {}),
    events: game.events.filter(e => e.audience?.includes(faction)).slice(0, EVENTS_PER_OBSERVER).map(e => ({ hour: e.hour, message: e.message })),
    scheduled: (game.scheduled ?? []).filter(p => p.owner === faction).map(p => isActionPlan(p) ? { ...p, ...(p.fleetId === undefined ? {} : { fleetId: identify(p.fleetId) }), action: mapActionFleets(mapActionUnits(p.action, identifyUnit), identify), ...(p.hireUnits ? { hireUnits: p.hireUnits.map(identifyUnit) } : {}) } : { ...p, ...(p.fleetId === undefined ? {} : { fleetId: identify(p.fleetId) }), ...(p.specialists ? { specialists: p.specialists.map(identifyUnit) } : {}) }),
    coverage, uncertain: [], interceptionUncertain: false,
  };
}
export function forecastObservation(view: GameView, faction: Faction, targetHour: number): GameView {
  if (!Number.isFinite(targetHour) || targetHour < view.hour) throw new Error('Time can only move forward.');
  const { simulation, unknown, alias, unknownInterceptions, territoryOwners } = simulationFromObservation(view, faction);
  const incompleteObservation = view.version === 2 && (unknown.size > 0 || !!view.forecastUncertain || !!view.pulse);
  const predicted = advance(simulation, targetHour, { rivals: false, unknownDestinations: [...unknown], unknownInterceptions, territoryOwners });
  predicted.fleets.sort((a, b) => a.id - b.id);
  const projected = observe(predicted, faction);
  projected.fleets = projected.fleets.map(f => ({ ...f, id: alias(f.id), ...(f.intercept ? { intercept: { home: f.intercept.home, ...(f.intercept.target !== undefined ? { target: alias(f.intercept.target) } : {}) } } : {}) }));
  if (projected.pulse?.tactical) for (const wave of projected.pulse.tactical.waves) wave.hitFleets = wave.hitFleets.map(alias);
  projected.scheduled = projected.scheduled.map(p => ({ ...p, ...(p.fleetId === undefined ? {} : { fleetId: alias(p.fleetId) }), ...(isActionPlan(p) ? { action: mapActionFleets(p.action, alias) } : {}) }));
  if (view.recruitmentUncertain || projected.recruitment?.[faction]?.used !== view.recruitment?.[faction]?.used) {
    projected.recruitmentUncertain = true;
    if (projected.recruitment?.[faction]) projected.recruitment[faction]!.offers = [];
  }
  projected.rocks = projected.rocks.map(r => {
    const original = view.rocks.find(site => site.id === r.id)!;
    return unknown.has(r.id) ? { ...original, ...sitePosition(view, original, predicted.hour) } : r;
  });
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
