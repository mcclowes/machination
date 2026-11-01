/**
 * ---
 * purpose: Lets a full-screen operation take over the app's top bar, moving its exits into Setup.
 * ---
 */
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';

export type ChromeExit = { label: string; onPress: () => void };
type Chrome = { exits: readonly ChromeExit[]; tools?: ReactNode; claim: () => () => void };

export const AppChromeContext = createContext<Chrome>({ exits: [], claim: () => () => undefined });

/**
 * Hosts a top bar that an operation shell can claim. While claimed the host hides its bar,
 * and the shell offers `exits` (innermost first) and the bar's `tools` from its Setup panel instead.
 */
export function useChromeHost(exits: readonly ChromeExit[], tools?: ReactNode) {
  const parent = useContext(AppChromeContext);
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => {
    const release = parent.claim();
    setClaims(n => n + 1);
    return () => { release(); setClaims(n => n - 1); };
  }, [parent]);
  const shared = tools ?? parent.tools;
  const value = useMemo<Chrome>(
    () => ({ exits: [...exits, ...parent.exits], tools: shared, claim }),
    [exits, parent.exits, shared, claim],
  );
  return { claimed: claims > 0, value };
}
