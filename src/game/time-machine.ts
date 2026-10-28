/**
 * ---
 * purpose: Stable inspected time and future-order timing shared by both operation screens.
 * ---
 */
import { MAX_PLAN_DELAY } from './orders';

export function inspectionOffset(liveHour: number, inspectedHour: number | null): number {
  return inspectedHour === null ? 0 : Math.max(0, inspectedHour - liveHour);
}
export function orderHour(liveHour: number, inspectedHour: number | null, delay: number): number {
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
