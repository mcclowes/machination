/**
 * ---
 * purpose: Original machine identities mapped to the official Subterfuge specialist roster and promotion graph.
 * ---
 */
type Definition = { name: string; reference: string; category: 'attack' | 'defense' | 'other' | 'promotion' | 'core'; description: string; promotesTo?: string; amount?: number; priority?: number };
export const SPECIALISTS = {
  disruptor: { name: 'Disruptor', reference: 'Disruptor', category: 'attack', description: 'Available in new pulse operations. Spends 10–25 Pulse Material and charges for 30 minutes while stationed. Launches a fading tactical wave that jams sensors, disables engines and mining, damages pulse shields, and interrupts strong-hit King charges. Cannot destroy a King.' },
  queen: { name: 'Intelligence core', reference: 'Queen', category: 'core', description: 'Adds 20 local shield capacity. Recruits modules every 18h after hour four. An additional acquired core becomes a fallback core. Capture or destruction can end your operation.' },
  diplomat: { name: 'Envoy protocol', reference: 'Diplomat', category: 'other', description: 'Releases your captive modules held at sites within this site’s sensor range.' },
  elder: { name: 'Precedence kernel', reference: 'Revered Elder', category: 'defense', priority: 2, description: 'Suppresses other local combat abilities unless both sides carry a precedence kernel.' },
  foreman: { name: 'Assembler daemon', reference: 'Foreman', category: 'other', promotesTo: 'engineer', description: 'Adds 4 drones per cycle to your factories within half this site’s sensor range.' },
  engineer: { name: 'Repair mesh', reference: 'Engineer', category: 'promotion', description: 'Recovers 25% of drone losses after victories, rounded up. Adds another 25% locally.' },
  pirate: { name: 'Scavenger rig', reference: 'Pirate', category: 'attack', description: 'Targets moving haulers at double speed and returns to the nearest friendly site at quadruple speed.' },
  lieutenant: { name: 'Combat daemon', reference: 'Lieutenant', category: 'attack', priority: 8, promotesTo: 'general', description: 'Destroys 5 opposing drones in combat. Travels 50% faster.' },
  general: { name: 'War controller', reference: 'General', category: 'promotion', description: 'Destroys 10 opposing drones in battles where one of your modules remains after the specialist phase. Travels 50% faster.' },
  princess: { name: 'Fallback core', reference: 'Princess', category: 'other', description: 'Adds 50% local sensor range. The nearest fallback core becomes your core when the current one is lost.' },
  infiltrator: { name: 'Shield breaker', reference: 'Infiltrator', category: 'attack', priority: 5, description: 'Drains all defending shields when attacking a site. Ends hauler encounters without drone combat.' },
  warHero: { name: 'Siege unit', reference: 'War Hero', category: 'attack', priority: 8, promotesTo: 'sentry', description: 'Destroys 20 opposing drones in combat.' },
  sentry: { name: 'Sentry array', reference: 'Sentry', category: 'promotion', description: 'Every 2h, fires at the largest enemy hauler within half this site’s sensor range, destroying 5% rounded up.' },
  intelligence: { name: 'Sensor mesh', reference: 'Intelligence Officer', category: 'other', description: 'Adds 25% global sensor range and reveals distant site types.' },
  tinkerer: { name: 'Capacitor daemon', reference: 'Tinkerer', category: 'other', promotesTo: 'energy', description: 'Adds power capacity equal to three times local maximum shields. Drains 3 shield units per hour.' },
  energy: { name: 'Fusion controller', reference: 'Minister of Energy', category: 'promotion', description: 'Adds 300 power capacity. Each factory produces one fewer drone per cycle.' },
  saboteur: { name: 'Diversion worm', reference: 'Saboteur', category: 'defense', priority: 3, amount: 2, description: 'Redirects a surviving opposing hauler to its nearest friendly site after combat.' },
  assassin: { name: 'Kill protocol', reference: 'Assassin', category: 'attack', priority: 7, amount: 2, description: 'Destroys all opposing modules present in combat.' },
  inspector: { name: 'Shield servitor', reference: 'Inspector', category: 'defense', promotesTo: 'security', description: 'Fully charges local shields on friendly arrival and after combat.' },
  security: { name: 'Defense controller', reference: 'Security Chief', category: 'promotion', description: 'Adds 10 global shield capacity and another 10 at its site.' },
  doubleAgent: { name: 'Handoff virus', reference: 'Double Agent', category: 'defense', priority: 6, description: 'In a hauler encounter, destroys both drone manifests, swaps ownership of the haulers and their modules, then ends combat.' },
  thief: { name: 'Conversion virus', reference: 'Thief', category: 'attack', priority: 4, description: 'Converts 15% of opposing drones, rounded up, when attacking a site or fighting another hauler.' },
  smuggler: { name: 'Courier daemon', reference: 'Smuggler', category: 'defense', promotesTo: 'tycoon', description: 'Travels at triple speed toward a friendly site.' },
  tycoon: { name: 'Industrial controller', reference: 'Tycoon', category: 'promotion', description: 'Adds 50% global factory production speed and 3 drones per cycle locally.' },
  navigator: { name: 'Routing controller', reference: 'Navigator', category: 'other', promotesTo: 'admiral', description: 'Changes a carrying hauler’s course once every 8h.' },
  admiral: { name: 'Fleet controller', reference: 'Admiral', category: 'promotion', description: 'Adds 50% speed to your haulers carrying no modules. Travels 50% faster itself.' },
  martyr: { name: 'Self-destruct charge', reference: 'Martyr', category: 'defense', priority: 1, description: 'Destroys every site, hauler, and module within 20% of standard sensor range when participating in combat.' },
  helmsman: { name: 'Routing daemon', reference: 'Helmsman', category: 'other', description: 'Travels at double speed.' },
  hypnotist: { name: 'Assimilation daemon', reference: 'Hypnotist', category: 'other', promotesTo: 'king', description: 'Takes ownership of captive modules at its site. An acquired core becomes a fallback core.' },
  king: { name: 'Siege controller', reference: 'King', category: 'promotion', description: 'Destroys one enemy drone per four of your drones after the specialist phase. Reduces global shield capacity by 20.' },
} as const satisfies Record<string, Definition>;
export type SpecialistKind = keyof typeof SPECIALISTS;
export const isSpecialistKind = (value: unknown): value is SpecialistKind => typeof value === 'string' && Object.hasOwn(SPECIALISTS, value);
export function promotion(kind: SpecialistKind): SpecialistKind | undefined { return (SPECIALISTS[kind] as Definition).promotesTo as SpecialistKind | undefined; }
export function hireAmount(kind: SpecialistKind): number { return (SPECIALISTS[kind] as Definition).amount ?? 1; }
export const HIRE_CATEGORIES = ['attack', 'defense', 'other'] as const;
export const HIRE_KINDS = (Object.keys(SPECIALISTS) as SpecialistKind[]).filter(k => HIRE_CATEGORIES.some(c => c === SPECIALISTS[k].category));
