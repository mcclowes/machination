/**
 * Own local restoration, serialized persistence, and elapsed-time advancement independently of the screen.
 *
 * @format
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { localLifecycle } from '../game/local-lifecycle';
import type { LocalOperation } from '../game/operation-save';
import { HOUR_MS } from '../game/retirement';

export function useLocalOperation(
  policy: ReturnType<typeof localLifecycle>,
  onLoaded: (operation: LocalOperation) => void,
) {
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;
  const [operation, setOperation] = useState<LocalOperation>(policy.initial);
  const current = useRef(operation);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState('');
  const lastTick = useRef(Date.now());
  const replace = useCallback((next: LocalOperation) => {
    current.current = next;
    setOperation(next);
  }, []);
  const restartClock = useCallback(() => {
    lastTick.current = Date.now();
  }, []);
  useEffect(() => {
    let active = true;
    void policy
      .load()
      .then((next) => {
        if (!active) return;
        replace(next);
        loaded.current(next);
      })
      .catch((error) => {
        if (active) {
          setError(String(error.message));
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (active) {
          restartClock();
          setReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [policy, replace, restartClock]);
  useEffect(() => {
    if (!ready || loadFailed) return;
    void policy
      .save(operation)
      .catch(() => setError('Could not save this operation. Keep the app open and retry.'));
  }, [operation, ready, loadFailed, policy]);
  useEffect(() => {
    if (!ready || loadFailed || !policy.automaticClock) return;
    // Returning after hours away is caught up one game hour per slice so the interface keeps responding.
    let pending = 0,
      slice: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      slice = undefined;
      const op = current.current;
      if (pending <= 0 || op.game.winner || op.game.draw) {
        pending = 0;
        return;
      }
      const hours = Math.min(pending, 1);
      pending -= hours;
      replace(policy.advance(op, op.game.hour + hours, 'clock'));
      if (pending > 0) slice = setTimeout(step, 0);
    };
    const tick = () => {
      const now = Date.now();
      pending += Math.max(0, now - lastTick.current) / HOUR_MS;
      lastTick.current = now;
      if (slice === undefined) step();
    };
    const timer = setInterval(tick, 15_000);
    const subscription = AppState.addEventListener('change', tick);
    return () => {
      clearInterval(timer);
      if (slice !== undefined) clearTimeout(slice);
      lastTick.current -= pending * HOUR_MS; // Unapplied time resumes with the next clock.
      subscription.remove();
    };
  }, [ready, loadFailed, policy, replace]);
  return {
    operation,
    current,
    replace,
    ready,
    loadFailed,
    setLoadFailed,
    error,
    setError,
    restartClock,
  };
}
