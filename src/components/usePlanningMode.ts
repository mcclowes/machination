/** @format */

import { useCallback, useState, type SetStateAction } from 'react';
import { planningTransition, type PlanningMode } from './planning-mode';

export function usePlanningMode() {
  const [mode, setMode] = useState<PlanningMode>({ kind: 'idle' });
  const setPlanning = useCallback(
    (enabled: boolean) =>
      setMode((current) => planningTransition(current, { type: 'transfer', enabled })),
    [],
  );
  const setNavigating = useCallback(
    (value: SetStateAction<number | undefined>) =>
      setMode((current) =>
        planningTransition(current, {
          type: 'course',
          fleet:
            typeof value === 'function'
              ? value(current.kind === 'course' ? current.fleet : undefined)
              : value,
        }),
      ),
    [],
  );
  return {
    planning: mode.kind === 'transfer',
    navigating: mode.kind === 'course' ? mode.fleet : undefined,
    setPlanning,
    setNavigating,
  };
}
