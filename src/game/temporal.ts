/**
 * ---
 * purpose: Versioned temporal specialist balance and the shared local-clock state contract.
 * related:
 *   - ./temporal-travel.ts - exact Dilation field crossings
 *   - ./temporal-intelligence.ts - delayed discoveries and conditional death warnings
 * ---
 */
import type { GameRules } from './rules';

export const TEMPORAL = {
  stasisHours: 2, anchorCooldown: 12, overclockHours: 4,
  dilationMultiplier: 0.5, hindsightDelay: 2, hindsightRangeMultiplier: 2, foresightHorizon: 24,
} as const;
export const TEMPORAL_KINDS = ['dilation', 'anchor', 'overclock', 'hindsight', 'foresight', 'hastener'] as const;
export const isTemporalKind = (kind: string): boolean => (TEMPORAL_KINDS as readonly string[]).includes(kind);
export const temporalEnabled = (game: { rules?: Pick<GameRules, 'mechanicsVersion'> }): boolean => (game.rules?.mechanicsVersion ?? 1) >= 18;
export type OverclockLoan = { boostUntil: number; debtUntil: number; repaying?: true };
export const inStasis = (game: { hour: number }, site: { stasisUntil?: number }): boolean => (site.stasisUntil ?? 0) > game.hour;
export const repayingProduction = (game: { hour: number }, site: { overclock?: OverclockLoan }): boolean => !!site.overclock?.repaying && site.overclock.debtUntil > game.hour;
