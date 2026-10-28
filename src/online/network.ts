import type { Snapshot } from './protocol';

export class RejectedCommand extends Error { constructor(public status: number, message: string) { super(message); } }
export async function api(session: { url: string; token: string }, path: string, payload?: unknown): Promise<Snapshot> {
  const controller = new AbortController();
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
    if (!data || data.visibility !== 'sensors.v1' || typeof data.id !== 'string' || !data.game || !Array.isArray(data.game.scheduled) || !Array.isArray(data.messages) || !['you', 'vesper', 'null'].includes(data.faction)) throw new Error('Unsupported server response.');
    return data as Snapshot;
  } finally { clearTimeout(timer); }
}
