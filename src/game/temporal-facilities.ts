/**
 * ---
 * purpose: Anchor stasis, held arrivals, and site-owned Overclock repayment at exact clock boundaries.
 * ---
 */
import { clonePulse } from './pulse';
import type { Faction, Fleet, Game, Rock } from './simulation';
import { TEMPORAL, inStasis, temporalEnabled } from './temporal';
import { afterWork, workBetween } from './opening-clock';
import { cloneUnits } from './specialists';
import { defendWithPreparations } from './transport';
import { withUnitEffects } from './specialist-effects';
import { recentEvents } from './events';
import { observers } from './sensors';
import { fleetPosition } from './flight';

export function requireUnfrozen(game: { hour: number }, site: { stasisUntil?: number }): void {
  if (inStasis(game, site)) throw new Error('This site is in Anchor stasis. Wait until it lifts.');
}
export function activateTemporal(input: Game, owner: Faction, id: string): Game {
  if (!temporalEnabled(input) || input.winner || input.draw || input.eliminated.includes(owner)) throw new Error('Temporal abilities require an active new operation.');
  const game: Game = { ...input, ...(input.pulse ? { pulse: clonePulse(input.pulse) } : {}), rocks: input.rocks.map(cloneUnits), fleets: input.fleets.map(cloneUnits), events: [...input.events] };
  const site = game.rocks.find(r => r.owner === owner && !r.destroyed && r.specialists?.some(u => u.id === id && u.owner === owner && !u.captive));
  const unit = site?.specialists?.find(u => u.id === id);
  if (!site || !unit || !['anchor', 'overclock'].includes(unit.kind)) throw new Error('Choose a docked Anchor or Overclock at your controlled site.');
  requireUnfrozen(game, site);
  if ((unit.temporalReadyAt ?? 0) > game.hour) throw new Error('This specialist is on cooldown.');
  if (unit.kind === 'anchor') {
    if ((site.anchorReadyAt ?? 0) > game.hour) throw new Error('This site is on its Anchor cooldown.');
    site.anchorReadyAt = game.hour + TEMPORAL.anchorCooldown;
    defendWithPreparations(game, site.id);
    site.stasisUntil = game.hour + TEMPORAL.stasisHours;
    if (site.shieldAt !== undefined) site.shieldAt = afterWork(game, site.stasisUntil, Math.max(0, workBetween(game, game.hour, site.shieldAt)));
    if (site.miningAt !== undefined) {
      const resumes = Math.max(game.hour, site.miningDisabledUntil ?? 0);
      site.miningAt = Math.max(site.stasisUntil, resumes) + Math.max(0, site.miningAt - resumes);
    }
    if (site.supplyAt !== undefined) site.supplyAt = Math.max(game.hour, site.supplyAt) + TEMPORAL.stasisHours;
    for (const charge of game.pulse?.tactical?.charges ?? []) if (charge.siteId === site.id) charge.readyAt += TEMPORAL.stasisHours;
    for (const local of site.specialists ?? []) if (local.nextActionAt !== undefined) local.nextActionAt += TEMPORAL.stasisHours;
    if (site.overclock) {
      if (site.overclock.boostUntil > game.hour) site.overclock.boostUntil += TEMPORAL.stasisHours;
      site.overclock.debtUntil += TEMPORAL.stasisHours;
    }
    unit.temporalReadyAt = game.hour + TEMPORAL.anchorCooldown;
  } else {
    if (site.kind !== 'factory') throw new Error('Overclock needs a controlled factory.');
    if (site.overclock) throw new Error('This site already has an Overclock loan to repay.');
    site.overclock = { boostUntil: game.hour + TEMPORAL.overclockHours, debtUntil: game.hour + 2 * TEMPORAL.overclockHours };
    unit.temporalReadyAt = site.overclock.debtUntil;
  }
  game.events = recentEvents([{ hour: game.hour, audience: observers(game, site), message: unit.kind === 'anchor'
    ? `${site.name}: Anchor stasis until hour ${site.stasisUntil}. Incoming haulers wait; local clocks are paused.`
    : `${site.name}: Overclock production until hour ${site.overclock!.boostUntil}, then no production until hour ${site.overclock!.debtUntil}.` }, ...game.events]);
  return withUnitEffects(game);
}
export function nextTemporalFacilityEvent(game: Game): number {
  return Math.min(...game.rocks.flatMap(r => [r.stasisUntil, r.overclock?.boostUntil, r.overclock?.debtUntil].filter((t): t is number => t !== undefined && t > game.hour)));
}
export function settleTemporalFacilities(game: Game): void {
  for (const site of game.rocks) {
    if (site.stasisUntil !== undefined && site.stasisUntil <= game.hour) delete site.stasisUntil;
    if (site.overclock) {
      if (site.overclock.debtUntil <= game.hour) delete site.overclock;
      else if (site.overclock.boostUntil <= game.hour) site.overclock.repaying = true;
    }
  }
}
export function refreshTemporalProduction(game: Game, site: Rock, interval: number): void {
  const oldInterval = site.productionInterval ?? 8;
  const pause = Math.max(site.stasisUntil ?? 0, site.overclock?.repaying ? site.overclock.debtUntil : 0);
  const oldBase = Math.max(game.hour, site.productionPausedUntil ?? 0), base = Math.max(game.hour, pause);
  if (interval !== oldInterval || (site.productionPausedUntil ?? 0) !== (pause > game.hour ? pause : 0)) {
    const progress = Math.max(0, workBetween(game, oldBase, site.productionAt!) / oldInterval);
    site.productionAt = afterWork(game, base, progress * interval);
  }
  site.productionInterval = interval;
  if (pause > game.hour) site.productionPausedUntil = pause; else delete site.productionPausedUntil;
}
export function holdStasisArrival(game: Game, fleet: Fleet, site: Rock): boolean {
  if (!inStasis(game, site)) { delete fleet.heldAt; return false; }
  const point = fleetPosition(game, fleet);
  fleet.route = { from: point, to: point };
  fleet.departed = game.hour;
  fleet.arrives = site.stasisUntil!;
  fleet.heldAt = site.id;
  if (fleet.pendingCourse) {
    delete fleet.pendingCourse;
    game.events.unshift({ hour: game.hour, audience: [fleet.owner], message: `${site.name}: Anchor stasis canceled a pending course change.` });
  }
  return true;
}
