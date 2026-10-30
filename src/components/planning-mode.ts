/**
 * Transfer planning and course selection share one exclusive interaction mode.
 *
 * @format
 */

export type PlanningMode =
  { kind: 'idle' } | { kind: 'transfer' } | { kind: 'course'; fleet: number };
type Action = { type: 'transfer'; enabled: boolean } | { type: 'course'; fleet?: number };

export function planningTransition(mode: PlanningMode, action: Action): PlanningMode {
  if (action.type === 'transfer')
    return action.enabled
      ? { kind: 'transfer' }
      : mode.kind === 'transfer'
        ? { kind: 'idle' }
        : mode;
  return action.fleet !== undefined
    ? { kind: 'course', fleet: action.fleet }
    : mode.kind === 'course'
      ? { kind: 'idle' }
      : mode;
}
