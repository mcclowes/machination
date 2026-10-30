/**
 * ---
 * purpose: Redact authoritative state to a player's sensor observations and forecast only those observations.
 * ---
 */
import { cloneCompact, type BeltCompact } from './compact';
import type { DeathWarning } from './temporal-intelligence';
import { clonePulse, type PulseSystem } from './pulse';
import { allied, teamMembers } from './teams';
import { sitePosition } from './drift';
import { publicRules, type PublicRules } from './rules';
import { playersIn } from './players';
import { activeUnits, unitCount, type Recruitment } from './specialists';
import { fundingCount, type Funding } from './funding';
import { simulationFromObservation } from './observation-simulation';
import { isActionPlan, mapActionUnits, mapActionFleets } from './future-actions';
import type { ScheduledOrder } from './orders';
import { EVENTS_PER_OBSERVER, type ObservedEvent } from './events';
import { advance, type Faction, type Fleet, type Game, type Rock } from './simulation';
import { fleetPosition } from './flight';
import { canObserveHauler, inRange, sensors, type Sensor } from './sensors';
export type ObservedRock = (Rock & { known: true }) | (Pick<Rock, 'id' | 'name' | 'x' | 'y' | 'drift'> & { kind: Rock['kind'] | 'unknown'; known: false; destroyed?: never; owner?: Faction | null; drones?: never; module?: never; specialists?: never; coreOf?: never });
export type GameView = {
  foresight?: Omit<DeathWarning, 'owner'>[];
  compact?: BeltCompact;
  pulse?: Omit<PulseSystem, 'receipts'>; rules?: PublicRules; funding?: Funding[]; standings?: Partial<Record<Faction, { cargo: number; funders: number }>>; fundingUncertain?: boolean;
  recruitment?: Partial<Record<Faction, Pick<Recruitment, 'used' | 'offers'>>>; recruitmentUncertain?: boolean;
  // Hidden territory leaves economy, routing, succession, and victory conditional.
  forecastUncertain?: boolean;
  version?: 1 | 2; minesDrilled?: Partial<Record<Faction, number>>;
  hour: number; epoch: number; rocks: ObservedRock[]; fleets: Fleet[];
  cargo: Partial<Record<Faction, number>>; eliminated: Faction[]; winner: Faction | null; draw?: true;
  scheduled: ScheduledOrder[]; events: ObservedEvent[]; coverage: Sensor[]; uncertain: string[]; interceptionUncertain: boolean;
};
export function observe(game: Game, faction: Faction, identify: (id: number) => number = id => id, identifyUnit: (id: string) => string = id => id): GameView {
  game = { ...game, rocks: game.rocks.map(r => r.drift ? { ...r, ...sitePosition(game, r, game.hour) } : r) };
  const coverage = sensors(game, faction);
  const contacts = game.fleets.filter(f => canObserveHauler(game, faction, f, coverage)).sort((a, b) => a.id - b.id);
  const remoteTypes = game.version !== 2 || teamMembers(game, faction).some(f => unitCount(game, f, 'intelligence') > 0);
  const visibleIds = new Set(contacts.map(f => f.id));
  const publicFleet = (f: Fleet) => { const visible = { ...f }; delete visible.lastContacts; if (!allied(game, faction, f.owner)) delete visible.pendingCourse; else if (f.pendingCourse) visible.pendingCourse = { ...f.pendingCourse }; return visible; };
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
  const activeIds = new Set(game.temporalIntel?.warnings.length ? activeUnits(game).map(u => u.id) : []);
  const deathWarnings = (game.temporalIntel?.warnings ?? []).filter(w => allied(game, w.owner, faction) && activeIds.has(w.specialistId) && w.deathAt >= game.hour);
  const { receipts: _receipts, ...disclosedPulse } = pulse ?? { receipts: {} };
  return {
    ...(deathWarnings.length ? { foresight: deathWarnings.map(({ owner: _owner, ...w }) => ({ ...w, specialistId: identifyUnit(w.specialistId) })) } : {}),
    ...(game.compact ? { compact: cloneCompact(game.compact) } : {}),
    ...(pulse ? { pulse: disclosedPulse as Omit<PulseSystem, 'receipts'> } : {}),
    ...(game.rules ? { rules: publicRules(game.rules) } : {}),
    ...(game.version === 2 ? { funding: (game.funding ?? []).filter(f => allied(game, faction, f.from) || allied(game, faction, f.to)).map(f => ({ ...f })), standings: Object.fromEntries((playersIn(game)).map(f => [f, { cargo: game.cargo[f] ?? 0, funders: fundingCount(game, f) }])) as NonNullable<GameView['standings']> } : {}),
    ...(game.recruitment?.[faction] ? { recruitment: Object.fromEntries(teamMembers(game, faction).filter(f => game.recruitment?.[f]).map(f => [f, { used: game.recruitment![f]!.used, offers: [...game.recruitment![f]!.offers] }])) } : {}),
    version: game.version, ...(game.minesDrilled ? { minesDrilled: Object.fromEntries(teamMembers(game, faction).map(f => [f, game.minesDrilled![f]])) } : {}),
    hour: game.hour, epoch: game.epoch,
    rocks: game.rocks.map(r => r.owner && allied(game, faction, r.owner) || inRange(coverage, r, game)
      ? { ...r, ...(r.overclock ? { overclock: { ...r.overclock } } : {}), ...units(r), known: true } : { id: r.id, name: r.name, x: r.x, y: r.y, ...(r.drift ? { drift: r.drift } : {}), kind: !r.destroyed && (remoteTypes || r.kind === 'mine') ? r.kind : 'unknown', known: false, ...(game.version === 2 ? { owner: r.owner } : {}) }),
    fleets: contacts.map(f => ({ ...publicFleet(f), ...units(f), id: identify(f.id), ...(f.route ? { route: { from: { ...f.route.from }, to: { ...f.route.to } } } : {}), ...(f.intercept ? { intercept: { home: f.intercept.home, ...(f.intercept.target !== undefined && visibleIds.has(f.intercept.target) ? { target: identify(f.intercept.target) } : {}) } } : {}) })),
    cargo: Object.fromEntries(teamMembers(game, faction).map(f => [f, game.cargo[f]])), eliminated: [...game.eliminated], winner: game.winner, ...(game.draw ? { draw: true } : {}),
    events: game.events.filter(e => e.audience?.some(f => allied(game, faction, f))).slice(0, EVENTS_PER_OBSERVER).map(e => ({ hour: e.hour, message: e.message, ...(e.discoveredAt === undefined ? {} : { discoveredAt: e.discoveredAt }), ...(e.battle ? { battle: { ...e.battle } } : {}) })),
    scheduled: (game.scheduled ?? []).filter(p => allied(game, faction, p.owner)).map(p => isActionPlan(p) ? { ...p, ...(p.fleetId === undefined ? {} : { fleetId: identify(p.fleetId) }), action: mapActionFleets(mapActionUnits(p.action, identifyUnit), identify), ...(p.hireUnits ? { hireUnits: p.hireUnits.map(identifyUnit) } : {}) } : { ...p, ...(p.fleetId === undefined ? {} : { fleetId: identify(p.fleetId) }), ...(p.specialists ? { specialists: p.specialists.map(identifyUnit) } : {}) }),
    coverage, uncertain: [], interceptionUncertain: false,
  };
}
export function forecastObservation(view: GameView, faction: Faction, targetHour: number): GameView {
  if (!Number.isFinite(targetHour) || targetHour < view.hour) throw new Error('Time can only move forward.');
  const { simulation, unknown, alias, unknownInterceptions, territoryOwners } = simulationFromObservation(view, faction);
  const incompleteObservation = view.version === 2 && (unknown.size > 0 || !!view.forecastUncertain || !!view.pulse);
  const predicted = advance(simulation, targetHour, { rivals: false, temporalForecast: true, unknownDestinations: [...unknown], unknownInterceptions, territoryOwners });
  predicted.fleets.sort((a, b) => a.id - b.id);
  const projected = observe(predicted, faction);
  if (view.foresight?.length) { projected.foresight = view.foresight.map(w => ({ ...w })); projected.forecastUncertain = true; }
  projected.fleets = projected.fleets.map(f => ({ ...f, id: alias(f.id), ...(f.intercept ? { intercept: { home: f.intercept.home, ...(f.intercept.target !== undefined ? { target: alias(f.intercept.target) } : {}) } } : {}) }));
  if (projected.pulse?.tactical) for (const wave of projected.pulse.tactical.waves) wave.hitFleets = wave.hitFleets.map(alias);
  projected.scheduled = projected.scheduled.map(p => ({ ...p, ...(p.fleetId === undefined ? {} : { fleetId: alias(p.fleetId) }), ...(isActionPlan(p) ? { action: mapActionFleets(p.action, alias) } : {}) }));
  for (const member of teamMembers(view, faction)) if (view.recruitmentUncertain || projected.recruitment?.[member]?.used !== view.recruitment?.[member]?.used) {
    projected.recruitmentUncertain = true;
    if (projected.recruitment?.[member]) projected.recruitment[member]!.offers = [];
  }
  projected.rocks = projected.rocks.map(r => {
    const original = view.rocks.find(site => site.id === r.id)!;
    return unknown.has(r.id) ? { ...original, ...sitePosition(view, original, predicted.hour) } : r;
  });
  projected.uncertain = [...new Set([...view.uncertain, ...predicted.events.filter(e => e.unresolvedDestination).map(e => e.unresolvedDestination!)])];
  if (incompleteObservation || view.compact?.motion && targetHour >= view.compact.motion.closesAt) projected.forecastUncertain = true;
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
