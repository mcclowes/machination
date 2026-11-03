/**
 * ---
 * purpose: Reuse an overlapping committed death forecast while its simulated trajectory remains exact.
 * ---
 */
import { advanceSteps, type Game } from './simulation';
import type { EncounterReport } from './combat-report';
import { traceSnapshot } from './simulation-trace';
import { TEMPORAL } from './temporal';
import { sameSnapshot } from './snapshot-equality';

type PredictedDeath = { specialistId: string; hour: number; report?: EncounterReport };

function sameCommittedState(left: Game, right: Game): boolean {
  // Events and warning text are outputs; pending Hindsight discoveries still affect simulation boundaries.
  const { events: _leftEvents, temporalIntel: leftIntel, ...a } = left;
  const { events: _rightEvents, temporalIntel: rightIntel, ...b } = right;
  return sameSnapshot(a, b) && sameSnapshot(leftIntel?.pending ?? [], rightIntel?.pending ?? []);
}

function presentUnits(game: Readonly<Game>): Set<string> {
  return new Set([...game.rocks, ...game.fleets].flatMap(asset => asset.specialists ?? []).map(unit => unit.id));
}

export class CommittedDeathForecast {
    private origin?: Game;
    private endpoint?: Game;
    private deaths: PredictedDeath[] = [];
    private present = new Set<string>();
    private reports = new Map<string, EncounterReport>();
    *predictSteps(game: Game): Generator<void, readonly PredictedDeath[], unknown> {
        yield;
        const horizon = game.hour + TEMPORAL.foresightHorizon;
        const follows = this.origin && this.endpoint && game.hour >= this.origin.hour && game.hour <= this.endpoint.hour
            && sameCommittedState((yield* advanceSteps(this.origin, game.hour, { rivals: false, temporalForecast: true })), game);
        if (!follows) {
            this.deaths = [];
            this.reports.clear();
            this.present = presentUnits(game);
            this.endpoint = undefined;
        }
        else
            this.deaths = this.deaths.filter(death => death.hour > game.hour);
        this.origin = traceSnapshot(game);
        if (!this.endpoint || this.endpoint.hour < horizon && !this.endpoint.winner && !this.endpoint.draw) {
            this.endpoint = yield* advanceSteps(this.endpoint ?? game, horizon, {
                rivals: false, temporalForecast: true,
                encounters: report => {
                    for (const unit of [...report.before.flatMap(asset => asset.specialists), ...(report.reinforcement?.haulers.flatMap(asset => asset.specialists) ?? [])])
                        this.reports.set(unit.id, report);
                },
                stopWhen: state => { this.inspect(state); return false; },
            });
            this.inspect(this.endpoint);
        }
        return this.deaths.filter(death => death.hour <= horizon);
    }
    predict(game: Game): readonly PredictedDeath[] {
        const work = this.predictSteps(game);
        let step = work.next();
        while (!step.done)
            step = work.next();
        return step.value;
    }
    private inspect(game: Readonly<Game>): void {
        const present = presentUnits(game);
        for (const specialistId of this.present)
            if (!present.has(specialistId)) {
                const report = this.reports.get(specialistId);
                this.deaths.push({ specialistId, hour: game.hour, ...(report?.hour === game.hour ? { report } : {}) });
            }
        this.present = present;
    }
}
