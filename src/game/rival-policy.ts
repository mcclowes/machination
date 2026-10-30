/**
 * ---
 * purpose: Pinned rival policy versions; saved operations replay under the policy they started with.
 * ---
 */
export const RIVAL_POLICIES = [1, 2] as const;
export type RivalPolicy = typeof RIVAL_POLICIES[number];
export const CURRENT_RIVAL_POLICY: RivalPolicy = 2;
export const isRivalPolicy = (value: unknown): value is RivalPolicy => RIVAL_POLICIES.includes(value as RivalPolicy);
