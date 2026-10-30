/**
 * ---
 * purpose: Predict one observed hauler's encounters using the real simulation and no hidden state.
 * ---
 */
import { MAX_PLAN_DELAY } from './orders';
import { simulationFromObservation } from './observation-simulation';
import { advance, type Faction } from './simulation';
import type { GameView } from './visibility';
import type { EncounterAsset, EncounterPair, EncounterReport } from './combat-report';

export type EncounterForecast = {
  from: number;
  through: number;
  status: 'resolved' | 'unknown-destination' | 'unknown-interception' | 'operation-ended' | 'limit' | 'unavailable';
  reports: EncounterReport[];
  incomplete: boolean;
};

export function forecastEncounters(view: GameView, faction: Faction, fleetId: number): EncounterForecast {
  const result: EncounterForecast = { from: view.hour, through: view.hour, status: 'unavailable', reports: [],
    incomplete: !!view.forecastUncertain || view.rocks.some(r => !r.known) };
  if (view.version !== 2 || !view.fleets.some(f => f.id === fleetId)) return result;
  const { simulation, rank, alias, unknown, unknownInterceptions, territoryOwners } = simulationFromObservation(view, faction);
  const selected = rank(fleetId);
  let lastLeg = simulation.fleets.find(f => f.id === selected)!;
  const encounters: EncounterReport[] = [];
  const predicted = advance(simulation, view.hour + MAX_PLAN_DELAY, {
    rivals: false, temporalForecast: true, unknownDestinations: [...unknown], unknownInterceptions, territoryOwners,
    encounters: report => {
      const inspected = (side: EncounterAsset) => side.asset.type === 'hauler' && side.asset.id === selected;
      if (report.before.some(inspected) || report.reinforcement?.haulers.some(inspected)) encounters.push(report);
    },
    stopWhen: state => {
      const fleet = state.fleets.find(f => f.id === selected);
      if (fleet) lastLeg = fleet;
      return !fleet;
    },
  });
  const asset = (side: EncounterAsset): EncounterAsset => side.asset.type === 'hauler'
    ? { ...side, asset: { type: 'hauler', id: alias(side.asset.id) } } : side;
  const pair = (sides: EncounterPair): EncounterPair => [asset(sides[0]), asset(sides[1])];
  result.reports = encounters.map(report => ({ ...report, before: pair(report.before),
    after: [report.after[0] && asset(report.after[0]), report.after[1] && asset(report.after[1])],
    ...(report.reinforcement ? { reinforcement: { haulers: report.reinforcement.haulers.map(asset), site: asset(report.reinforcement.site) } } : {}),
    steps: report.steps.map(step => ({ ...step, before: pair(step.before), after: pair(step.after) })),
  }));
  result.through = predicted.hour;
  const present = predicted.fleets.some(f => f.id === selected);
  const terminal = encounters.at(-1);
  if (terminal && terminal.hour === predicted.hour && !present) result.status = 'resolved';
  else if (predicted.winner || predicted.draw) result.status = 'operation-ended';
  else if (present) result.status = 'limit';
  else if (lastLeg.intercept && unknownInterceptions.includes(selected)) result.status = 'unknown-interception';
  else if (unknown.has(lastLeg.to)) result.status = 'unknown-destination';
  else result.status = 'resolved';
  return result;
}
