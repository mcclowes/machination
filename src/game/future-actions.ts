/**
 * ---
 * purpose: Private future site and specialist actions with execution-time requirements and stable planned hires.
 * ---
 */
import { playersIn, isFaction } from './players';
import { hireSpecialist, promoteSpecialist } from './specialists';
import { releaseSpecialist } from './specialist-travel';
import { drillMine, setShields } from './economy';
import { setFunding } from './funding';
import { hireAmount, isSpecialistKind, SPECIALISTS, type SpecialistKind } from './specialist-catalog';
import type { Faction, Game } from './simulation';
import { MAX_PLAN_DELAY, MAX_PLANS_PER_FACTION, type ScheduledOrder } from './orders';
import { recentEvents } from './events';

export type FutureAction = { type: 'hire'; kind: SpecialistKind } | { type: 'promote' | 'release'; id: string }
  | { type: 'drill-mine'; rock: string } | { type: 'shields'; rock: string; disabled: boolean } | { type: 'funding'; to: Faction; enabled: boolean };
export type ActionPlan = { id: string; owner: Faction; executeAt: number; action: FutureAction };
export type ScheduledAction = ActionPlan & { hireCycle?: number; hireUnits?: string[] };
export function isActionPlan(plan: ScheduledOrder): plan is ScheduledAction { return 'action' in plan; }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9:-]{1,80}$/.test(v);
export function validateFutureAction(value: unknown): FutureAction {
  if (!record(value)) throw new Error('Choose a supported future action.');
  const keys = (required: string[]) => required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key));
  const base = ['type'];
  const valid = value.type === 'hire' ? keys([...base, 'kind']) && isSpecialistKind(value.kind)
    : value.type === 'promote' || value.type === 'release' ? keys([...base, 'id']) && id(value.id)
    : value.type === 'drill-mine' ? keys([...base, 'rock']) && id(value.rock)
    : value.type === 'shields' ? keys([...base, 'rock', 'disabled']) && id(value.rock) && typeof value.disabled === 'boolean'
    : value.type === 'funding' && keys([...base, 'to', 'enabled']) && isFaction(value.to) && typeof value.enabled === 'boolean';
  if (!valid) throw new Error('Choose a supported future action.');
  switch (value.type) {
    case 'hire': return { type: 'hire', kind: value.kind as SpecialistKind };
    case 'promote': case 'release': return { type: value.type, id: value.id as string };
    case 'drill-mine': return { type: 'drill-mine', rock: value.rock as string };
    case 'shields': return { type: 'shields', rock: value.rock as string, disabled: value.disabled as boolean };
    default: return { type: 'funding', to: value.to as Faction, enabled: value.enabled as boolean };
  }
}
export function actionLabel(action: FutureAction, rocks: readonly { id: string; name: string }[] = []): string {
  const name = (site: string) => rocks.find(r => r.id === site)?.name ?? site;
  switch (action.type) {
    case 'hire': return `Recruit ${SPECIALISTS[action.kind].name}`;
    case 'promote': return 'Promote specialist';
    case 'release': return 'Release captive';
    case 'drill-mine': return `Drill mine at ${name(action.rock)}`;
    case 'shields': return `${action.disabled ? 'Disable' : 'Enable'} shields at ${name(action.rock)}`;
    case 'funding': return `${action.enabled ? 'Fund' : 'Stop funding'} ${action.to}`;
  }
}
export function scheduleAction(game: Game, plan: ActionPlan): Game {
  if (game.version !== 2 || !playersIn(game).includes(plan.owner) || game.winner || game.draw || game.eliminated.includes(plan.owner)) throw new Error('This intelligence is no longer operational.');
  if (typeof plan.id !== 'string' || !/^[a-zA-Z0-9-]{16,60}$/.test(plan.id)) throw new Error('Provide a unique future action ID.');
  if (!Number.isFinite(plan.executeAt) || plan.executeAt <= game.hour || plan.executeAt > game.hour + MAX_PLAN_DELAY) throw new Error('Schedule a future action within seven days.');
  const existing = game.scheduled ?? [];
  if (existing.some(p => p.id === plan.id && p.owner === plan.owner)) throw new Error('This plan ID is already in use.');
  if (existing.filter(p => p.owner === plan.owner).length >= MAX_PLANS_PER_FACTION) throw new Error('An intelligence can queue at most 20 orders.');
  const action = validateFutureAction(plan.action);
  if (('rock' in action) && !game.rocks.some(r => r.id === action.rock)) throw new Error('Choose a known chart site.');
  if (game.rules?.mode === 'domination' && (action.type === 'drill-mine' || action.type === 'funding')) throw new Error('Mining and funding are unavailable in domination operations.');
  if (action.type === 'funding' && (action.to === plan.owner || !playersIn(game).includes(action.to))) throw new Error('Choose another participant to fund.');
  const state = game.recruitment?.[plan.owner];
  if (action.type === 'hire' && (!state || !state.offers.includes(action.kind))) throw new Error('Choose one of the current recruitment offers.');
  const scheduled: ScheduledAction = { id: plan.id, owner: plan.owner, executeAt: plan.executeAt, action,
    ...(action.type === 'hire' ? { hireCycle: state!.used, hireUnits: Array.from({ length: hireAmount(action.kind) }, (_, index) => `hire:${plan.owner}:${plan.id}:${index}`) } : {}) };
  return { ...game, scheduled: [...existing, scheduled], events: recentEvents([{ hour: game.hour, audience: [plan.owner], message: `${actionLabel(action, game.rocks)} planned for hour ${plan.executeAt.toFixed(2)}. Requirements are checked at execution.` }, ...game.events]) };
}
export function executeScheduledAction(game: Game, plan: ScheduledAction): Game {
  const { owner, action } = plan;
  switch (action.type) {
    case 'hire': {
      if (game.recruitment?.[owner]?.used !== plan.hireCycle) throw new Error('The planned recruitment offer has changed.');
      return hireSpecialist(game, owner, action.kind, plan.hireUnits);
    }
    case 'promote': return promoteSpecialist(game, owner, action.id);
    case 'release': return releaseSpecialist(game, owner, action.id);
    case 'drill-mine': return drillMine(game, action.rock, owner);
    case 'shields': return setShields(game, action.rock, owner, action.disabled);
    case 'funding': return setFunding(game, owner, action.to, action.enabled);
  }
}

export function mapActionUnits(action: FutureAction, identify: (id: string) => string): FutureAction {
  return action.type === 'promote' || action.type === 'release' ? { ...action, id: identify(action.id) } : { ...action };
}
export function plannedUnitIds(game: Pick<Game, 'scheduled'>, owner: Faction): string[] {
  return (game.scheduled ?? []).filter(isActionPlan).filter(plan => plan.owner === owner).flatMap(plan => plan.hireUnits ?? []);
}

export function validateScheduledAction(value: unknown): ScheduledAction {
  if (!record(value) || typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{16,60}$/.test(value.id) || !isFaction(value.owner) || typeof value.executeAt !== 'number' || !Number.isFinite(value.executeAt)) throw new Error('Invalid scheduled action.');
  const action = validateFutureAction(value.action);
  const keys = ['id', 'owner', 'executeAt', 'action', ...(action.type === 'hire' ? ['hireCycle', 'hireUnits'] : [])];
  if (Object.keys(value).length !== keys.length || !Object.keys(value).every(key => keys.includes(key))) throw new Error('Invalid scheduled action.');
  if (action.type === 'hire') {
    const expected = Array.from({ length: hireAmount(action.kind) }, (_, index) => `hire:${value.owner}:${value.id}:${index}`);
    if (!Number.isSafeInteger(value.hireCycle) || (value.hireCycle as number) < 0 || !Array.isArray(value.hireUnits) || value.hireUnits.length !== expected.length || !value.hireUnits.every((id, index) => id === expected[index])) throw new Error('Invalid planned hire identity.');
  }
  return { ...value, action, ...(Array.isArray(value.hireUnits) ? { hireUnits: [...value.hireUnits] } : {}) } as ScheduledAction;
}
