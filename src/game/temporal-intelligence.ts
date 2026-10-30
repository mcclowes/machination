/**
 * ---
 * purpose: Private delayed Hindsight telemetry and bounded Foresight warnings derived from committed simulation.
 * ---
 */
import { allied } from './teams';
import { advance, type Faction, type Game } from './simulation';
import type { GameCommand } from './replay';
import type { EncounterReport } from './combat-report';
import { TEMPORAL, temporalEnabled, inStasis } from './temporal';
import { activeUnits, unitsAtRock } from './specialists';
import { SPECIALISTS } from './specialist-catalog';
import { actionLabel, isActionPlan } from './future-actions';
import { fleetPosition } from './flight';
import { worldDistance, type Point } from './geometry';
import { rockSensorRange } from './sensors';
import { recentEvents, EVENTS_PER_OBSERVER } from './events';

export type DelayedDiscovery = { owner: Faction; occurredAt: number; discoverAt: number; message: string };
export type DeathWarning = { owner: Faction; specialistId: string; deathAt: number; source: string };
export type TemporalIntelligence = { pending: DelayedDiscovery[]; warnings: DeathWarning[] };
export function cloneTemporalIntelligence(state: TemporalIntelligence): TemporalIntelligence {
  return { pending: state.pending.map(p => ({ ...p })), warnings: state.warnings.map(w => ({ ...w })) };
}
export function recordTemporalAction(game: Game, actor: Faction, message: string, point: Point): void {
  if (!temporalEnabled(game)) return;
  const watchers = new Set(game.rocks.filter(r => r.owner && !allied(game, r.owner, actor) && !r.destroyed && !inStasis(game, r)
    && worldDistance(game, r, point) <= TEMPORAL.hindsightRangeMultiplier * rockSensorRange(game, r)
    && unitsAtRock(game, r.id).some(u => u.owner === r.owner && u.kind === 'hindsight')).map(r => r.owner!));
  if (!watchers.size) return;
  const pending = [...(game.temporalIntel?.pending ?? [])];
  for (const owner of watchers) {
    pending.push({ owner, occurredAt: game.hour, discoverAt: game.hour + TEMPORAL.hindsightDelay, message });
    while (pending.filter(p => p.owner === owner).length > EVENTS_PER_OBSERVER) pending.splice(pending.findIndex(p => p.owner === owner), 1);
  }
  game.temporalIntel = { pending, warnings: game.temporalIntel?.warnings ?? [] };
}
export function recordTemporalCommand(before: Game, game: Game, command: GameCommand): void {
  if (!temporalEnabled(game) || command.type === 'inactivity' || ['dispatch', 'gift', 'schedule', 'schedule-action', 'cancel-schedule', 'edit-schedule', 'pulse-specialist-effect'].includes(command.type)) return;
  let point: Point | undefined;
  if ('rock' in command) point = before.rocks.find(r => r.id === command.rock);
  else if ('id' in command) point = before.rocks.find(r => r.specialists?.some(u => u.id === command.id));
  else if (command.type === 'hire') point = before.rocks.find(r => r.specialists?.some(u => u.kind === 'queen' && u.owner === command.owner && !u.captive));
  else if (command.type === 'intercept') point = before.rocks.find(r => r.id === command.from);
  else if (command.type === 'hauler') { const fleet = before.fleets.find(f => f.id === command.change.fleet); if (fleet) point = fleetPosition(before, fleet); }
  else if (command.type === 'pulse') point = before.pulse?.kings.find(k => k.factionId === command.owner)?.position;
  if (!point) return;
  const message = command.type === 'pulse' ? `${command.owner}: ${command.command.action.toLowerCase().replaceAll('_', ' ')}.`
    : ['hire', 'promote', 'release', 'activate', 'drill-mine', 'shields', 'intercept', 'hauler'].includes(command.type)
      ? `${command.owner}: ${actionLabel(command as Parameters<typeof actionLabel>[0], before.rocks)}.` : `${command.owner}: ${command.type}.`;
  recordTemporalAction(game, command.owner, message, point);
}
export function nextHindsightEvent(game: Game): number {
  return Math.min(...(game.temporalIntel?.pending ?? []).map(p => p.discoverAt));
}
export function settleHindsight(game: Game): void {
  const state = game.temporalIntel;
  if (!state) return;
  const due = state.pending.filter(p => p.discoverAt <= game.hour);
  if (!due.length) return;
  state.pending = state.pending.filter(p => p.discoverAt > game.hour);
  game.events = recentEvents([...due.map(p => ({ hour: p.occurredAt, discoveredAt: p.discoverAt, audience: [p.owner],
    message: `Hindsight: ${p.message} Learned at hour ${p.discoverAt.toFixed(2)}.` })), ...game.events]);
}

function warningSource(game: Game, report: EncounterReport | undefined, owner: Faction): string {
  const enemy = report?.before.find(a => a.owner && a.owner !== owner);
  const fleetId = enemy?.asset.type === 'hauler' ? enemy.asset.id : undefined;
  const plan = fleetId === undefined ? undefined : game.scheduled?.find(p => p.fleetId === fleetId);
  if (plan && !isActionPlan(plan)) {
    const name = (id: string) => game.rocks.find(r => r.id === id)?.name ?? id;
    return `queued enemy transfer from ${name(plan.from)} to ${name(plan.to)} at hour ${plan.executeAt.toFixed(2)}`;
  }
  const fleet = game.fleets.find(f => f.id === fleetId);
  if (fleet) {
    const name = (id: string) => game.rocks.find(r => r.id === id)?.name ?? id;
    return `enemy hauler from ${name(fleet.from)} to ${name(fleet.to)}`;
  }
  return report?.site ? `enemy action at ${game.rocks.find(r => r.id === report.site)?.name ?? report.site}` : 'committed enemy activity';
}
export function predictSpecialistDeaths(game: Game): DeathWarning[] {
  if (!temporalEnabled(game) || game.winner || game.draw) return [];
  const owners = new Set(activeUnits(game).filter(u => u.kind === 'foresight').map(u => u.owner));
  if (!owners.size) return [];
  const protectedUnits = activeUnits(game).filter(u => owners.has(u.owner));
  const warnings: DeathWarning[] = [], warned = new Set<string>();
  const reports = new Map<string, EncounterReport>();
  const inspect = (state: Readonly<Game>): boolean => {
    const present = new Set([...state.rocks, ...state.fleets].flatMap(a => a.specialists ?? []).map(u => u.id));
    for (const unit of protectedUnits) if (!present.has(unit.id) && !warned.has(unit.id)) {
      warned.add(unit.id);
      warnings.push({ owner: unit.owner, specialistId: unit.id, deathAt: state.hour, source: warningSource(game, reports.get(unit.id)?.hour === state.hour ? reports.get(unit.id) : undefined, unit.owner) });
    }
    return false;
  };
  const predicted = advance(game, game.hour + TEMPORAL.foresightHorizon, { rivals: false, temporalForecast: true, encounters: report => {
    const involved = [...report.before.flatMap(a => a.specialists), ...(report.reinforcement?.haulers.flatMap(a => a.specialists) ?? [])];
    for (const unit of involved) reports.set(unit.id, report);
  }, stopWhen: inspect });
  inspect(predicted);
  return warnings;
}
export function refreshForesight(game: Game): void {
  if (!temporalEnabled(game)) return;
  const warnings = predictSpecialistDeaths(game), previous = game.temporalIntel?.warnings ?? [];
  if (!warnings.length && !previous.length) return;
  const changed = warnings.filter(w => !previous.some(p => p.owner === w.owner && p.specialistId === w.specialistId && Math.abs(p.deathAt - w.deathAt) < 1e-7 && p.source === w.source));
  game.temporalIntel = { pending: game.temporalIntel?.pending ?? [], warnings };
  for (const warning of changed) {
    const unit = [...game.rocks, ...game.fleets].flatMap(a => a.specialists ?? []).find(u => u.id === warning.specialistId);
    game.events.unshift({ hour: game.hour, audience: [warning.owner], message: `Foresight: ${unit ? SPECIALISTS[unit.kind].name : 'specialist'} predicted killed at hour ${warning.deathAt.toFixed(2)} by ${warning.source}. This warning changes with plans.` });
  }
  if (changed.length) game.events = recentEvents(game.events);
}
