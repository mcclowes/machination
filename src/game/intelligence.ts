/**
 * ---
 * purpose: Rank public victory progress and derive scoreboard figures strictly from a player's observation.
 * related:
 *   - ../components/IntelligenceReports.tsx - scoreboard presentation and funding controls
 * ---
 */
import { playersIn, type Faction } from './players';
import { victoryTarget } from './rules';
import { allied, teamMembers, teamNumber } from './teams';
import { hasReserves } from './depletion';
import { MINING_DAY, miningInterval } from './mining';
import type { Rock } from './simulation';
import type { GameView } from './visibility';
import { simulationFromObservation } from './observation-simulation';
import { droneInventory, factoryOutput, FACTORY_CYCLE, powerCapacity } from './economy';
import { openingRate } from './opening-clock';
import { fundingCount } from './funding';

export function intelligenceReport(view: GameView, viewer: Faction) {
  const domination = view.rules?.mode === 'domination';
  const ownersKnown = view.rocks.every(r => r.owner !== undefined);
  const { simulation } = simulationFromObservation(view, viewer);
  const cargo = (f: Faction) => view.standings?.[f]?.cargo ?? view.cargo[f];
  const rows = playersIn(view).map(faction => {
    const members = teamMembers(view, faction);
    const sites = view.rocks.filter(r => r.owner === faction && !r.destroyed);
    const known = sites.filter((r): r is Rock & { known: true } => r.known);
    const mines = sites.filter(r => r.kind === 'mine');
    const eliminated = view.eliminated.includes(faction);
    const observed = !allied(view, viewer, faction);
    const drones = droneInventory({ rocks: known, fleets: view.fleets }, faction);
    const capacity = !observed && view.version === 2 && known.length === sites.length ? powerCapacity(simulation, faction) : undefined;
    const production = capacity === undefined || view.fundingUncertain ? undefined : drones >= capacity ? 0
      : known.filter(r => r.kind === 'factory' && !r.destroyed).reduce((n, r) => n + factoryOutput(simulation, r) * MINING_DAY * openingRate(view, view.hour) / (r.productionInterval ?? FACTORY_CYCLE), 0);
    const income = eliminated ? 0 : view.version !== 2 || !ownersKnown || known.length !== sites.length ? undefined
      : known.filter(r => r.kind === 'mine' && !r.destroyed && !r.pulseDisabled && hasReserves(r) && (r.miningDisabledUntil ?? 0) <= view.hour)
        .reduce((n, r) => n + MINING_DAY / (r.miningInterval ?? miningInterval({ rocks: known }, faction)), 0);
    const score = domination ? !ownersKnown ? undefined : view.rocks.filter(r => r.owner && members.includes(r.owner)).length
      : members.every(f => cargo(f) !== undefined) ? members.reduce((n, f) => n + cargo(f)!, 0) : undefined;
    return { faction, score, income, drones, observed, capacity, production, cargo: cargo(faction),
      sites: ownersKnown ? sites.length : undefined,
      mines: ownersKnown ? mines.length : undefined, factories: sites.filter(r => r.kind === 'factory').length, generators: sites.filter(r => r.kind === 'generator').length,
      typesUnknown: !ownersKnown || sites.some(r => r.kind === 'unknown'), sponsors: view.standings?.[faction]?.funders ?? fundingCount(view, faction),
      team: teamNumber(view, faction), eliminated, rank: undefined as number | undefined };
  }).sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || (b.score ?? -1) - (a.score ?? -1));
  const contenders = rows.filter(r => !r.eliminated);
  const entrants = contenders.filter((row, i) => row.team === undefined || contenders.findIndex(other => other.team === row.team) === i);
  for (const row of contenders) if (row.score !== undefined) row.rank = entrants.findIndex(r => r.score === row.score) + 1;
  const target = view.rules?.mode === 'pulse' ? undefined : victoryTarget(view);
  let projection: { faction: Faction; team: number | undefined; hours: number } | undefined;
  if (!domination && view.rules?.mode !== 'pulse' && !view.winner && !view.draw && !view.forecastUncertain && target !== undefined
    && contenders.every(r => r.score !== undefined && r.income !== undefined)) {
    const estimates = contenders.map(row => {
      const income = rows.filter(r => teamMembers(view, row.faction).includes(r.faction)).reduce((n, r) => n + (r.income ?? 0), 0);
      return { faction: row.faction, team: row.team, hours: income > 0 ? Math.max(0, target - row.score!) * MINING_DAY / income : Infinity };
    }).filter((r, i, all) => r.team === undefined || all.findIndex(other => other.team === r.team) === i).sort((a, b) => a.hours - b.hours);
    if (Number.isFinite(estimates[0]?.hours) && (!estimates[1] || estimates[0]!.hours < estimates[1].hours)) projection = estimates[0];
  }
  return { rows, projection, scoreLabel: domination ? 'Sites' : view.rules?.mode === 'pulse' ? 'Material' : 'Cargo', target };
}
