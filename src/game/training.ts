/** Original tactical exercises using ordinary commands and private replay history. */
import { createConfiguredGame } from './world';
import { createArchive, exportArchive, replayTo, restoreArchive } from './replay';
import type { LocalOperation } from './operation-save';
import { dispatch, type Game, type Rock } from './simulation';
import { activeUnits } from './specialists';
import { TUTORIAL_MISSIONS, configureTutorialMission, tutorialMissionFailure, tutorialMissionPassed, type TutorialMissionId } from './training-missions';
import { SPECIALIST_DRILLS, configureSpecialistDrill, isSpecialistDrill, specialistDrillPassed, type SpecialistDrillId } from './specialist-drills';

export type TrainingId = 'first-launch' | 'shield-combat' | 'unit-transport' | 'future-production' | 'interception' | TutorialMissionId | SpecialistDrillId;
export type TrainingScenario = { id: TrainingId; reference?: string; title: string; instruction: string; objective: string; hints: readonly string[]; deadline: number; focus: string };
const originalScenarios: readonly TrainingScenario[] = [
  { id: 'first-launch', reference: 'Combat 1', title: 'Open a foothold', instruction: 'Launch drones from Foundry to Quiet landing.', objective: 'Capture Quiet landing with surviving drones.', hints: ['A tied battle leaves the defender in control.', 'Allow ten minutes for launch preparation.'], deadline: 6, focus: 'works' },
  { id: 'shield-combat', title: 'Break the perimeter', instruction: 'Take Quiet landing from its shielded garrison.', objective: 'Overcome both shields and defenders with drones left over.', hints: ['The ten shield points absorb drones before the eight defenders fight.', 'Send more than eighteen drones.'], deadline: 6, focus: 'works' },
  { id: 'unit-transport', title: 'A quiet passenger', instruction: 'Move the designated thruster from Core berth to Foundry, carrying no drones or other specialists.', objective: 'Deliver the thruster alone while keeping your core at home.', hints: ['Select the thruster in the manifest and set drones to zero.', 'Leave the intelligence core at Core berth.'], deadline: 6, focus: 'home' },
  { id: 'future-production', title: 'Borrow tomorrow', instruction: 'Before hour 8, queue Foundry’s first six drones for Quiet landing at hour 8.', objective: 'Use a transfer queued before first production to capture Quiet landing by hour 10.', hints: ['Queued transfers do not reserve drones.', 'Production at hour 8 happens before the queued launch.'], deadline: 10, focus: 'works' },
  { id: 'interception', title: 'Cut the approach', instruction: 'Use Foundry’s interceptor to intercept the inbound raid before it reaches Core berth.', objective: 'Stop the raid with an interception order and keep your core safe.', hints: ['Select Foundry, set the drone manifest, and use its Interceptor targets list.', 'The interceptor travels twice as fast on its interception leg.'], deadline: 6, focus: 'works' },
];
export const TRAINING_SCENARIOS: readonly TrainingScenario[] = [originalScenarios[0]!, ...TUTORIAL_MISSIONS, ...originalScenarios.slice(1), ...SPECIALIST_DRILLS];

/** Completed launches and site actions can still have unresolved mission outcomes. */
export function canResolveTrainingOrders({ game, archive }: LocalOperation): boolean {
  if (game.fleets.some(f => f.owner === 'you') || game.scheduled?.some(p => p.owner === 'you')) return true;
  const entries = exportArchive(archive).entries.filter(e => 'owner' in e.command && e.command.owner === 'you');
  const last = entries.at(-1)?.command;
  return entries.some(e => ['drill-mine', 'funding', 'hire', 'promote', 'shields', 'release'].includes(e.command.type))
    || ['dispatch', 'gift', 'intercept', 'schedule', 'schedule-action'].includes(last?.type ?? '')
    || last?.type === 'hauler' && last.change.action === 'gift';
}

function isTutorialMission(id: TrainingId): id is TutorialMissionId { return TUTORIAL_MISSIONS.some(s => s.id === id); }
const isScriptedExercise = (id: TrainingId) => isTutorialMission(id) || isSpecialistDrill(id);

export function createTrainingAttempt(id: TrainingId): LocalOperation {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 18);
  const site = (siteId: string, name: string, x: number, y: number, owner: Rock['owner'], drones: number, core = false): Rock => ({
    id: siteId, name, x, y, owner, drones, kind: siteId === 'works' ? 'factory' : 'generator',
    shield: owner ? core ? 30 : 10 : 0, shieldMax: 10, shieldAt: 48 / (core ? 30 : 10), shieldsDisabled: false, productionAt: 8,
    specialists: core && owner ? [{ id: `core-${owner}`, owner, kind: 'queen' }] : [], ...(core && owner ? { coreOf: owner } : {}),
  });
  game.rocks = [site('home', 'Core berth', 10, 10, 'you', 0, true), site('works', 'Foundry', 10, 18, 'you', id === 'future-production' ? 0 : id === 'interception' ? 60 : 30),
    site('relay', 'Quiet landing', 18, 18, id === 'shield-combat' ? 'vesper' : null, id === 'shield-combat' ? 8 : 4),
    site('rival-home', 'Distant anchor', 50, 10, 'vesper', 0, true),
    ...Array.from({ length: 16 }, (_, i) => site(`remote-${i}`, `Silent buoy ${i + 1}`, 40 + i % 4 * 8, 40 + Math.floor(i / 4) * 8, null, 0))];
  if (isScriptedExercise(id)) {
    const configured = isTutorialMission(id) ? configureTutorialMission(game, id) : configureSpecialistDrill(game, id as SpecialistDrillId);
    return { game: configured, archive: createArchive(configured, { rivals: false }) };
  }
  if (id === 'unit-transport') game.rocks[0]!.specialists!.push({ id: 'training-helmsman', owner: 'you', kind: 'helmsman' });
  if (id === 'interception') {
    game.rocks[1]!.specialists!.push({ id: 'training-pirate', owner: 'you', kind: 'pirate' });
    game.rocks[3]!.drones = 40;
    const raid = dispatch(game, 'rival-home', 'home', 40, 'vesper');
    // The scripted raid is already traveling at the hour-zero baseline.
    const incoming = raid.fleets[0]!;
    incoming.arrives -= incoming.departed;
    incoming.departed = 0;
    delete incoming.preparing;
    return { game: raid, archive: createArchive(raid, { rivals: false }) };
  }
  return { game, archive: createArchive(game, { rivals: false }) };
}

type Assessment = { status: 'active' | 'passed' | 'failed'; message: string };
export function assessTrainingAttempt(id: TrainingId, operation: LocalOperation): Assessment {
  const scenario = TRAINING_SCENARIOS.find(s => s.id === id)!;
  const { game, archive } = operation;
  const history = exportArchive(archive);
  const at = (hour: number): Game => replayTo(archive, hour, { rivals: false, knownThrough: game.hour });
  const safe = (state: Game) => !state.eliminated.includes('you') && activeUnits(state, 'you').some(u => u.kind === 'queen')
    && (id !== 'unit-transport' || state.rocks.some(r => r.id === 'home' && r.owner === 'you' && r.specialists?.some(u => u.id === 'core-you' && !u.captive)));
  if (!safe(game)) return { status: 'failed', message: id === 'unit-transport' ? 'Your intelligence core must remain at Core berth. Retry the exercise.' : 'Keep your intelligence core safe. Retry the exercise.' };
  if (isScriptedExercise(id)) {
    const failure = isTutorialMission(id) ? tutorialMissionFailure(id, operation) : undefined;
    if (failure) return { status: 'failed', message: failure };
    const actual = game.hour > scenario.deadline ? {
      game: at(scenario.deadline),
      archive: restoreArchive({ ...history, entries: history.entries.filter(e => e.hour <= scenario.deadline) }),
    } : operation;
    if (isTutorialMission(id) ? tutorialMissionPassed(id, actual) : isSpecialistDrill(id) && specialistDrillPassed(id, actual)) return { status: 'passed', message: 'Objective complete. Your orders succeeded in the actual operation.' };
    if (game.hour >= scenario.deadline || game.winner || game.draw) return { status: 'failed', message: 'The objective was not completed before the exercise ended. Retry with a new plan.' };
    return { status: 'active', message: scenario.objective };
  }
  const horizon = Math.min(game.hour, scenario.deadline);
  let passed = false;
  for (const [index, entry] of history.entries.entries()) {
    const c = entry.command;
    if (entry.hour > horizon || !('owner' in c) || c.owner !== 'you') continue;
    const prefix = restoreArchive({ ...history, entries: history.entries.slice(0, index + 1) });
    const submitted = replayTo(prefix, entry.hour, { rivals: false, knownThrough: entry.hour });
    if (!safe(submitted)) return { status: 'failed', message: id === 'unit-transport' ? 'Keep your intelligence core at Core berth throughout this exercise.' : 'Keep your intelligence core safe throughout the exercise.' };
    const expectedId = c.type === 'schedule' ? submitted.scheduled?.find(p => p.id === c.plan.id && !('action' in p)) : undefined;
    let launched: Game;
    if (c.type === 'schedule' && id === 'future-production' && entry.hour < 8 && c.plan.executeAt === 8 && c.plan.from === 'works' && c.plan.to === 'relay' && c.plan.drones === 6 && horizon >= 8) launched = at(8);
    else if (c.type === 'dispatch' && id !== 'future-production' && id !== 'interception') launched = at(entry.hour);
    else if (c.type === 'intercept' && id === 'interception') launched = at(entry.hour);
    else continue;
    for (const fleet of launched.fleets.filter(f => f.owner === 'you' && f.id === (c.type === 'schedule' && expectedId && 'fleetId' in expectedId ? expectedId.fleetId : submitted.nextId - 1))) {
      if (fleet.arrives > horizon) continue;
      const approaching = at(Math.max(launched.hour, fleet.arrives - 1e-7)).fleets.find(f => f.id === fleet.id);
      if (!approaching || approaching.to !== fleet.to || approaching.arrives !== fleet.arrives) continue;
      const arrived = at(fleet.arrives);
      if (!safe(arrived)) continue;
      if (id === 'interception') {
        const raid = history.baseline.fleets[0]!;
        passed ||= c.type === 'intercept' && c.target === raid.id && fleet.intercept?.target === raid.id && fleet.arrives < raid.arrives && !arrived.fleets.some(f => f.id === raid.id);
      } else if (id === 'unit-transport') {
        passed ||= fleet.from === 'home' && fleet.to === 'works' && fleet.drones === 0 && fleet.specialists?.length === 1 && fleet.specialists[0]!.id === 'training-helmsman' && arrived.rocks.some(r => r.id === 'works' && r.specialists?.some(u => u.id === 'training-helmsman' && !u.captive));
      } else passed ||= fleet.from === 'works' && fleet.to === 'relay' && arrived.rocks.some(r => r.id === 'relay' && r.owner === 'you' && r.drones > 0);
    }
  }
  if (passed) return { status: 'passed', message: 'Objective complete. Your orders succeeded in the actual operation.' };
  if (game.hour >= scenario.deadline || game.winner || game.draw) return { status: 'failed', message: 'The objective was not completed before the exercise ended. Retry with a new plan.' };
  return { status: 'active', message: scenario.objective };
}
