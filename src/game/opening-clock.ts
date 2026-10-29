/** Normal-rate work accrues faster during the opening; stored deadlines remain actual game hours. */
export type OpeningWorld = { rules?: { mechanicsVersion?: number } };
export const OPENING_HOURS = 12;
export const OPENING_RATE = 1.5;
export const openingEnabled = (world: OpeningWorld): boolean => (world.rules?.mechanicsVersion ?? 1) >= 9;
export const openingRate = (world: OpeningWorld, hour: number): number => openingEnabled(world) && hour < OPENING_HOURS ? OPENING_RATE : 1;

export function workClock(world: OpeningWorld, hour: number): number {
  return openingEnabled(world) ? hour <= OPENING_HOURS ? hour * OPENING_RATE : hour + OPENING_HOURS * (OPENING_RATE - 1) : hour;
}
export function workHour(world: OpeningWorld, work: number): number {
  return openingEnabled(world) ? work <= OPENING_HOURS * OPENING_RATE ? work / OPENING_RATE : work - OPENING_HOURS * (OPENING_RATE - 1) : work;
}
export function workBetween(world: OpeningWorld, from: number, through: number): number {
  if (!openingEnabled(world) || from >= OPENING_HOURS && through >= OPENING_HOURS) return through - from;
  if (through < from) return -workBetween(world, through, from);
  return through <= OPENING_HOURS ? (through - from) * OPENING_RATE : (OPENING_HOURS - from) * OPENING_RATE + (through - OPENING_HOURS);
}
export function afterWork(world: OpeningWorld, from: number, work: number): number {
  if (!openingEnabled(world) || from >= OPENING_HOURS) return from + work;
  const openingWork = (OPENING_HOURS - from) * OPENING_RATE;
  return work <= openingWork ? from + work / OPENING_RATE : OPENING_HOURS + (work - openingWork);
}
export function travelProgress(world: OpeningWorld, departed: number, arrives: number, hour: number): number {
  return Math.max(0, Math.min(1, workBetween(world, departed, hour) / workBetween(world, departed, arrives)));
}
