/** Inherited corporate restrictions and the exact authority delegated to the local council. */
export const COMPACT_POLICIES = {
  transit: { name: 'Transit safety limits', motion: 'Authorize high-thrust transit', reason: 'After the Kessler cascade, corporate navigation services locked high-thrust flight plans.', restriction: 'High-thrust authorization is withheld. Ordinary routing bonuses still apply.', effect: 'New hauler missions receive 50% more speed. Existing missions keep their authorization until arrival.' },
  replication: { name: 'Replication moratorium', motion: 'Suspend the replication moratorium', reason: 'An uncontrolled fabrication cycle consumed the Ceres concession. Replication quotas remain mandatory.', restriction: 'Factories operate at their normal output.', effect: 'Factory cycles produce 50% more drones, rounded down, within existing power capacity.' },
  sensors: { name: 'Sensor sovereignty', motion: 'Permit extended-range surveillance', reason: 'The corporate privacy settlement limits the power available to station sensor arrays.', restriction: 'Station sensors operate at their normal range.', effect: 'Station sensor range increases by 50% for every intelligence. This may expose previously hidden contacts.' },
  infrastructure: { name: 'Protected infrastructure', motion: 'Suspend infrastructure protection', reason: 'Industrial installations remain corporate property, even when local operators are in conflict.', restriction: 'Self-destruct blasts can destroy garrisons and haulers, but leave installations standing.', effect: 'Authorized self-destruct blasts can also permanently destroy installations. Weapons authorization is separately required.' },
  weapons: { name: 'Strategic weapons prohibition', motion: 'Release strategic weapons interlocks', reason: 'The Vesta incident left a permanent exclusion zone. Self-destruct interlocks require council authorization.', restriction: 'Self-destruct specialists cannot be recruited, promoted, or detonated. King pulses are outside this convention.', effect: 'Self-destruct specialists may be recruited and detonated while the waiver is active. Infrastructure remains protected unless separately waived.' },
  salvage: { name: 'Salvage protection', motion: 'Open combat salvage rights', reason: 'Corporate title to drone wreckage survives the loss of its operating intelligence.', restriction: 'Combat winners cannot claim opposing drone wreckage. Engineering repairs remain available.', effect: 'Combat winners recover 25% of the opposing drones lost in direct drone combat, rounded down. No salvage follows a mutual destruction or self-destruct blast.' },
} as const;
export type CompactPolicy = keyof typeof COMPACT_POLICIES;
export const COMPACT_POLICY_IDS = Object.keys(COMPACT_POLICIES) as CompactPolicy[];
export const COUNCIL_DAY = 24;
export const COUNCIL_WAIVER_HOURS = 48;
export const COUNCIL_HISTORY = 128;
export const COUNCIL_VOTE_CHANGES = 256;
export function isCompactPolicy(value: unknown): value is CompactPolicy { return typeof value === 'string' && Object.hasOwn(COMPACT_POLICIES, value); }
