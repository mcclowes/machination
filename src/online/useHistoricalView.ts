import { useEffect, useState } from 'react';
import { historicalApi } from './network';
import type { HistorySnapshot } from './protocol';

type Seat = { url: string; token: string; id: string; faction: HistorySnapshot['faction'] };
type Result = { key: string; frame?: HistorySnapshot; error?: string };
export function historyKey(seat: Seat, hour: number): string {
  return JSON.stringify([seat.url, seat.id, seat.token, seat.faction, hour]);
}
export function useHistoricalView(seat: Seat | undefined, hour: number | null) {
  const key = seat && hour !== null ? historyKey(seat, hour) : undefined;
  const [result, setResult] = useState<Result>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!seat || hour === null || !key) return;
    setResult(undefined);
    return requestHistoricalView(seat, hour, value => setResult(value));
  }, [key, attempt]);
  const current = result?.key === key ? result : undefined;
  return { frame: current?.frame, error: current?.error, retry: () => { setResult(undefined); setAttempt(value => value + 1); } };
}

export function requestHistoricalView(seat: Seat, hour: number, receive: (result: Result) => void, fetchFrame = historicalApi) {
  const key = historyKey(seat, hour);
  let active = true;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    void fetchFrame(seat, hour, controller.signal).then(frame => {
      if (frame.faction !== seat.faction) throw new Error('Historical response belongs to another seat.');
      if (active) receive({ key, frame });
    }).catch(error => {
      if (active) receive({ key, error: (error as Error).message });
    });
  }, 150);
  return () => { active = false; clearTimeout(timer); controller.abort(); };
}
