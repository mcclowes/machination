/**
 * ---
 * purpose: Module catalog and pure effects shared by simulation, mobile controls, and command validation.
 * ---
 */
export const MODULES = {
  routing: { name: 'Routing daemon', code: 'RD', cost: 24, description: 'Loaded haulers travel 50% faster. Survives a successful arrival.' },
  virus: { name: 'Conversion virus', code: 'CV', cost: 36, description: 'Before hostile combat, converts 20% of opposing drones, up to 20. Survives a successful arrival.' },
  scavenger: { name: 'Scavenger rig', code: 'SR', cost: 28, description: 'Can intercept observed enemy haulers and return home. Winning combat recovers 25% of drone losses.' },
  charge: { name: 'Self-destruct charge', code: 'SC', cost: 20, description: 'On hostile contact, sacrifices its hauler to destroy up to twice its drone payload. Cannot claim a rock or destroy a core.' },
} as const;
export type ModuleKind = keyof typeof MODULES;
export const isModule = (value: unknown): value is ModuleKind => typeof value === 'string' && Object.prototype.hasOwnProperty.call(MODULES, value);
export const ROUTING_SPEED = 1.5;
export const CONVERSION_FRACTION = 0.2;
export const CONVERSION_LIMIT = 20;
export const SALVAGE_FRACTION = 0.25;
export const BLAST_MULTIPLIER = 2;
