import { validateOptions, type GameOptions } from '../game/rules';
import { isFaction, playersIn } from '../game/players';
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
export async function api(session: { url: string; token: string; id?: string }, path: string, payload?: unknown): Promise<Snapshot> {
  const data = await request(session, path, payload);
  if (!data || data.visibility !== 'sensors.v1' || typeof data.id !== 'string' || session.id !== undefined && data.id !== session.id || !data.game || !Array.isArray(data.game.scheduled) || !Array.isArray(data.messages) || !validSeat(data) || !validReferences(data)) throw new Error('Unsupported server response.');
  return data as Snapshot;
}
export async function historicalApi(session: { url: string; token: string; id: string }, hour: number, signal?: AbortSignal): Promise<HistorySnapshot> {
  if (!Number.isFinite(hour)) throw new Error('Choose a finite historical hour.');
  const data = await request(session, `games/${session.id}/history?hour=${encodeURIComponent(hour)}`, undefined, signal);
  const bounds = data?.history;
  if (!data || data.visibility !== 'sensors.v1' || data.id !== session.id || !validSeat(data) || !data.game || !Array.isArray(data.game.scheduled) || !bounds || ![bounds.from, bounds.through, bounds.at].every(Number.isFinite) || bounds.from > bounds.at || bounds.at > bounds.through || bounds.at !== hour || !validReferences(data)) throw new Error('Unsupported historical server response.');
  return data as HistorySnapshot;
}

function validSeat(data: any): boolean {
  return isFaction(data.faction) && !!data.game && (!data.game.rules || Array.isArray(data.game.rules.players)) && playersIn(data.game).includes(data.faction);
}

function validReferences(data: any): boolean {
  const refs = data.references;
  if (refs === undefined) return true;
  if (!refs || refs.version !== 1 || Object.keys(refs).sort().join(',') !== 'haulers,outposts,version' || !Array.isArray(refs.outposts) || !Array.isArray(refs.haulers) || !Array.isArray(data.game?.rocks) || !Array.isArray(data.game?.fleets)) return false;
  const rocks = new Set(data.game.rocks.map((r: any) => r.id));
  const fleets = new Set(data.game.fleets.map((f: any) => f.id));
  const seen = new Set<string>();
  for (const [kind, entries, ids] of [['outpost', refs.outposts, rocks], ['hauler', refs.haulers, fleets]] as const) {
    if (entries.length > ids.size) return false;
    const used = new Set();
    for (const item of entries) {
      if (!item || Object.keys(item).sort().join(',') !== 'id,ref' || !ids.has(item.id) || used.has(item.id) || typeof item.ref !== 'string' || !/^[a-f0-9]{64}$/.test(item.ref) || seen.has(item.ref)
        || (kind === 'outpost' ? typeof item.id !== 'string' : !Number.isSafeInteger(item.id) || item.id <= 0)) return false;
      used.add(item.id); seen.add(item.ref);
    }
  }
  return true;
}

export function creationPayload(options?: GameOptions): { options?: GameOptions } {
  return options === undefined ? {} : { options: validateOptions(options) };
}
