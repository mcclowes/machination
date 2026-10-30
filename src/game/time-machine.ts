/**
 * ---
 * purpose: Stable inspected time and future-order timing shared by both operation screens.
 * ---
 */
import { MAX_PLAN_DELAY } from './orders';

export function inspectionMode(liveHour: number, inspectedHour: number | null): 'live' | 'past' | 'future' {
  return inspectedHour === null || inspectedHour === liveHour ? 'live' : inspectedHour < liveHour ? 'past' : 'future';
}
export function timelineHour(liveHour: number, historyStart: number | undefined, fraction: number): number | null {
  const start = Math.min(liveHour, historyStart ?? liveHour);
  const offset = Math.round((start + Math.max(0, Math.min(1, fraction)) * (liveHour + MAX_PLAN_DELAY - start) - liveHour) * 60) / 60;
  return offset === 0 ? null : Math.max(start, Math.min(liveHour + MAX_PLAN_DELAY, liveHour + offset));
}

export function inspectionOffset(liveHour: number, inspectedHour: number | null): number {
  return inspectedHour === null ? 0 : Math.max(0, inspectedHour - liveHour);
}
export function arrivalInspection(liveHour: number, historyStart: number | undefined, arrival: number): number | null | undefined {
  const first = Math.min(liveHour, historyStart ?? liveHour);
  if (!Number.isFinite(liveHour) || !Number.isFinite(first) || !Number.isFinite(arrival) || arrival < first || arrival > liveHour + MAX_PLAN_DELAY) return undefined;
  return arrival === liveHour ? null : arrival;
}
type ArrivalContact = { id: number; owner: string; to: string; arrives: number; intercept?: { target?: number } };
/** Rival combat that resolves before this hauler docks: an earlier arrival at its destination, or an interception aimed at it. */
export function arrivalAtRisk(fleets: readonly ArrivalContact[], hauler: ArrivalContact): boolean {
  return fleets.some(f => f.id !== hauler.id && f.owner !== hauler.owner
    && (f.intercept ? f.intercept.target === hauler.id : f.to === hauler.to && f.arrives <= hauler.arrives));
}
export function orderHour(liveHour: number, inspectedHour: number | null, delay: number): number {
  if (inspectionMode(liveHour, inspectedHour) === 'past') throw new Error('Historical views are read-only. Return to live time or inspect the future to issue an order.');
  const hour = Math.max(liveHour, inspectedHour ?? liveHour) + delay;
  if (!Number.isFinite(hour) || !Number.isFinite(delay) || delay < 0 || hour > liveHour + MAX_PLAN_DELAY) {
    throw new Error('Choose a launch within seven days of live time.');
  }
  return hour;
}
export function gameClock(hour: number): string {
  const minutes = Math.floor((hour + 1e-9) * 60);
  return `D${String(Math.floor(minutes / 1440) + 1).padStart(2, '0')} · ${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function relativeInspectionTime(liveHour: number, inspectedHour: number): string {
  const hours = Math.abs(inspectedHour - liveHour);
  const direction = inspectedHour < liveHour ? 'ago' : 'from now';
  if (hours < 1 / 60) return `Less than 1 minute ${direction}`;
  const amount = (hours < 1 ? hours * 60 : hours).toFixed(1);
  const unit = hours < 1 ? 'minute' : 'hour';
  return `${amount} ${unit}${amount === '1.0' ? '' : 's'} ${direction}`;
}
