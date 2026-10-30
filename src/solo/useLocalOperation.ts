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
    const tick = () => {
      const now = Date.now(),
        delta = Math.max(0, now - lastTick.current) / HOUR_MS;
      lastTick.current = now;
      const op = current.current;
      if (!op.game.winner && !op.game.draw)
        replace(policy.advance(op, op.game.hour + delta, 'clock'));
    };
    const timer = setInterval(tick, 15_000);
    const subscription = AppState.addEventListener('change', tick);
    return () => {
      clearInterval(timer);
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
