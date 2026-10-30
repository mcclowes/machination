/** Each specialist is introduced once, in the briefing of the first exercise that features it. */
import { SPECIALISTS, type SpecialistKind } from './specialist-catalog';
import type { TrainingId } from './training';
import { SPECIALIST_DRILLS } from './specialist-drills';

export const SPECIALIST_INTRODUCTIONS: Partial<Record<TrainingId, readonly SpecialistKind[]>> = {
  'first-launch': ['queen'],
  'factory-specialist': ['infiltrator'],
  'hiring-specialists': ['saboteur'],
  'combat-priority': ['martyr', 'elder'],
  promotion: ['lieutenant', 'general'],
  'global-abilities': ['foreman', 'engineer'],
  'electrical-output': ['tinkerer'],
  'losing-mine': ['doubleAgent', 'pirate'],
  'losing-core': ['smuggler', 'assassin'],
  'captive-specialists': ['warHero'],
  'against-the-odds': ['helmsman'],
  'test-of-character': ['intelligence'],
  ...Object.fromEntries(SPECIALIST_DRILLS.map(drill => [drill.id, [drill.introduces]])),
};

export function specialistIntroduction(kind: SpecialistKind): string {
  return `Specialist profile: ${SPECIALISTS[kind].name}. ${SPECIALISTS[kind].description}`;
}
