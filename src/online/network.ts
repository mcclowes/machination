import type { HistorySnapshot, Snapshot } from './protocol';

export class RejectedCommand extends Error { constructor(public status: number, message: string) { super(message); } }
async function request(session: { url: string; token: string }, path: string, payload?: unknown, signal?: AbortSignal): Promise<any> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${session.url}/v1/${path}`, { method: payload === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload), signal: controller.signal });
    const data = await response.json();
    if (!response.ok) {
      const detail = data.issues?.[0]?.message?.detail ?? 'Command was not accepted.';
      if (response.status >= 400 && response.status < 500 && response.status !== 429) throw new RejectedCommand(response.status, detail);
      throw new Error(detail);
    }
    return data;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export async function api(session: { url: string; token: string }, path: string, payload?: unknown): Promise<Snapshot> {
  const data = await request(session, path, payload);
  if (!data || data.visibility !== 'sensors.v1' || typeof data.id !== 'string' || !data.game || !Array.isArray(data.game.scheduled) || !Array.isArray(data.messages) || !['you', 'vesper', 'null'].includes(data.faction)) throw new Error('Unsupported server response.');
  return data as Snapshot;
}
export async function historicalApi(session: { url: string; token: string; id: string }, hour: number, signal?: AbortSignal): Promise<HistorySnapshot> {
  if (!Number.isFinite(hour)) throw new Error('Choose a finite historical hour.');
  const data = await request(session, `games/${session.id}/history?hour=${encodeURIComponent(hour)}`, undefined, signal);
  const bounds = data?.history;
  if (!data || data.visibility !== 'sensors.v1' || data.id !== session.id || !['you', 'vesper', 'null'].includes(data.faction) || !data.game || !Array.isArray(data.game.scheduled) || !bounds || ![bounds.from, bounds.through, bounds.at].every(Number.isFinite) || bounds.from > bounds.at || bounds.at > bounds.through || bounds.at !== hour) throw new Error('Unsupported historical server response.');
  return data as HistorySnapshot;
}
