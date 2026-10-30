/**
 * Transfer planning and course selection share one exclusive interaction mode.
 *
 * @format
 */

export type PlanningMode =
  { kind: 'idle' } | { kind: 'transfer' } | { kind: 'course'; fleet: number };
type Action = { type: 'transfer'; enabled: boolean } | { type: 'course'; fleet?: number };

export function planningTransition(mode: PlanningMode, action: Action): PlanningMode {
  if (action.type === 'transfer') {
    if (action.enabled) return { kind: 'transfer' };
    return mode.kind === 'transfer' ? { kind: 'idle' } : mode;
  }
  if (action.fleet !== undefined) return { kind: 'course', fleet: action.fleet };
  return mode.kind === 'course' ? { kind: 'idle' } : mode;
}
