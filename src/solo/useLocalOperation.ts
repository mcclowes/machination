/** @format */
/** Own local restoration, atomic publication, persistence, and elapsed-time advancement. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { localLifecycle } from '../game/local-lifecycle';
import type { LocalOperation } from '../game/operation-save';
import type { GameCommand } from '../game/replay';
import { HOUR_MS } from '../game/retirement';
import { OperationExecution, runSteps } from './execution';

export function useLocalOperation(
  policy: ReturnType<typeof localLifecycle>,
  onLoaded: (operation: LocalOperation) => void,
) {
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;
  const [operation, setOperation] = useState<LocalOperation>(policy.initial);
  const current = useRef(operation);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [executor] = useState(() => new OperationExecution(setBusy));
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState('');
  const lastTick = useRef(Date.now());
  const publish = useCallback((next: LocalOperation) => {
    current.current = next;
    setOperation(next);
  }, []);
  const replace = useCallback(
    (next: LocalOperation) => {
      executor.cancel();
      publish(next);
      setReady(true);
    },
    [executor, publish],
  );
  const restartClock = useCallback(() => {
    lastTick.current = Date.now();
  }, []);
  useEffect(() => {
    let active = true;
    setReady(false);
    setLoadFailed(false);
    const restoreStarted = Date.now();
    void executor
      .run(
        (signal) => policy.load(signal, restoreStarted),
        (next) => {
          publish(next);
          loaded.current(next);
        },
      )
      .then((completed) => {
        if (active && completed) {
          lastTick.current = restoreStarted;
          setReady(true);
        }
      })
      .catch((error) => {
        if (active) {
          setError(String(error.message));
          setLoadFailed(true);
          setReady(true);
        }
      });
    return () => {
      active = false;
      executor.cancel(false);
    };
  }, [policy, executor, publish, restartClock]);
  useEffect(() => {
    if (!ready || loadFailed) return;
    let active = true;
    void policy.save(operation, lastTick.current).catch(() => {
      if (active) setError('Could not save this operation. Keep the app open and retry.');
    });
    return () => {
      active = false;
    };
  }, [operation, ready, loadFailed, policy]);
  const retrySave = useCallback(() => policy.save(current.current, lastTick.current), [policy]);
  const advance = useCallback(
    (hours: number, source: 'clock' | 'manual' = 'manual') => {
      if (executor.busy || !ready || loadFailed) return Promise.resolve();
      return executor
        .run(
          (signal) =>
            runSteps(
              policy.advanceSteps(current.current, current.current.game.hour + hours, source),
              signal,
            ),
          publish,
        )
        .catch((error) => setError(String(error.message)));
    },
    [executor, ready, loadFailed, policy, publish],
  );
  const submit = useCallback(
    (command: GameCommand) => {
      if (executor.busy || !ready || loadFailed)
        throw new Error('Wait for the current operation to finish.');
      void executor
        .run((signal) => runSteps(policy.submitSteps(current.current, command), signal), publish)
        .catch((error) => setError(String(error.message)));
    },
    [executor, ready, loadFailed, policy, publish],
  );
  useEffect(() => {
    if (!ready || loadFailed || !policy.automaticClock) return;
    const tick = () => {
      if (executor.busy) return;
      const now = Date.now();
      const delta = Math.max(0, now - lastTick.current) / HOUR_MS;
      const op = current.current;
      if (!op.game.winner && !op.game.draw && delta > 0) {
        void executor
          .run(
            (signal) => runSteps(policy.advanceSteps(op, op.game.hour + delta, 'clock'), signal),
            (next) => {
              lastTick.current = now;
              publish(next);
            },
          )
          .catch((error) => setError(String(error.message)));
      }
    };
    const timer = setInterval(tick, 15_000);
    const subscription = AppState.addEventListener('change', tick);
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [ready, loadFailed, policy, executor, publish]);
  return {
    operation,
    current,
    replace,
    ready,
    busy,
    advance,
    submit,
    loadFailed,
    setLoadFailed,
    error,
    setError,
    restartClock,
    retrySave,
  };
}
