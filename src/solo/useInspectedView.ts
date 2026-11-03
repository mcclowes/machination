/** @format */
/** Compute forecasts/history outside render and discard superseded inspections. */
import { useEffect, useRef, useState } from 'react';
import { replayToSteps, type ReplayArchive } from '../game/replay';
import { forecastObservationSteps, observe, type GameView } from '../game/visibility';
import { runSteps } from './execution';

type Inspection = { archive: ReplayArchive; live: GameView; hour: number; view: GameView | null };
export function useInspectedView(
  archive: ReplayArchive,
  live: GameView,
  hour: number | null,
  rivals: boolean,
  onError: (message: string) => void,
) {
  const [result, setResult] = useState<Inspection>();
  const historical = hour !== null && hour < live.hour;
  const inspecting = hour !== null && hour !== live.hour;
  const latestLive = useRef(live);
  latestLive.current = live;
  const forecastInput = historical ? null : live;
  const matching =
    result?.archive === archive && (historical || result.live === live) && result.hour === hour;
  useEffect(() => {
    const snapshot = forecastInput ?? latestLive.current;
    if (hour === null || hour === snapshot.hour) return;
    const abort = new AbortController();
    const work = historical
      ? (function* () {
          return observe(
            yield* replayToSteps(archive, hour, { rivals, knownThrough: snapshot.hour }),
            'you',
          );
        })()
      : forecastObservationSteps(snapshot, 'you', hour);
    void runSteps(work, abort.signal)
      .then((view) => {
        if (!abort.signal.aborted) setResult({ archive, live: snapshot, hour, view });
      })
      .catch((error) => {
        if (!abort.signal.aborted) {
          setResult({ archive, live: snapshot, hour, view: null });
          onError(String(error.message));
        }
      });
    return () => abort.abort();
  }, [archive, forecastInput, hour, historical, rivals, onError]);
  const view = inspecting && matching ? (result.view ?? live) : live;
  return {
    shown: view,
    past: historical && matching && result.view ? view : null,
    inspecting: inspecting && !matching,
    failed: inspecting && matching && !result.view,
  };
}
