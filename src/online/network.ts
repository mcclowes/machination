import { authorization, type RequestSession } from './account-auth';
import { abortable, throwIfAborted } from './request-abort';
import { validateOptions, type GameOptions } from '../game/rules';
import { isFaction, playersIn } from '../game/players';
import type { HistorySnapshot, Snapshot } from './protocol';
import type { MessageNotificationSettings, SetMessageNotifications } from './notification-contract';

export class RejectedCommand extends Error { constructor(public status: number, message: string, public issue?: string) { super(message); } }
async function request(session: RequestSession, path: string, payload?: unknown, signal?: AbortSignal): Promise<any> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const bearer = session.accountId ? await abortable(() => authorization(session), controller.signal) : `Bearer ${session.token}`;
    throwIfAborted(controller.signal);
    const response = await fetch(`${session.url}/v1/${path}`, { method: payload === undefined ? 'GET' : 'POST',
      headers: { Authorization: bearer, 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload), signal: controller.signal });
    const data = await response.json();
    if (!response.ok) {
      const detail = data.issues?.[0]?.message?.detail ?? 'Command was not accepted.';
      if (response.status >= 400 && response.status < 500 && response.status !== 429) throw new RejectedCommand(response.status, detail, data.issues?.[0]?.issue);
      throw new Error(detail);
    }
    return data;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export async function api(session: RequestSession & { id?: string }, path: string, payload?: unknown): Promise<Snapshot> {
  const data = await request(session, path, payload);
  return snapshotResponse(session, data);
}
export async function accountSessionApi(session: RequestSession): Promise<Snapshot | null> {
  const data = await request(session, 'account/session');
  return data?.snapshot === null ? null : snapshotResponse(session, data?.snapshot);
}
function snapshotResponse(session: RequestSession & { id?: string }, data: any): Snapshot {
  if (!data || data.visibility !== 'sensors.v1' || typeof data.id !== 'string' || session.id !== undefined && data.id !== session.id || !data.game || !Array.isArray(data.game.scheduled) || !Array.isArray(data.messages) || !validSeat(data) || !validReferences(data)) throw new Error('Unsupported server response.');
  return data as Snapshot;
}
export async function historicalApi(session: RequestSession & { id: string }, hour: number, signal?: AbortSignal): Promise<HistorySnapshot> {
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

type SeatSession = RequestSession & { id: string };
const DEVICE_ID = /^[a-f0-9]{64}$/;
export const OPAQUE_ID = /^[\x21-\x7e]{1,200}$/;
const EXPO_PUSH_TOKEN = /^Expo(?:nent)?PushToken\[[^\]\s]{1,200}\]$/;
export async function messageNotificationsApi(session: SeatSession, deviceId: string): Promise<MessageNotificationSettings> {
  if (!DEVICE_ID.test(deviceId)) throw new Error('Invalid notification device.');
  const path = `games/${session.id}/notifications?deviceId=${deviceId}`;
  let data: unknown;
  try { data = await request(session, `${path}&version=2`); }
  catch (error) {
    // Older servers reject every query key except deviceId.
    if (!(error instanceof RejectedCommand && error.status === 400 && error.issue === 'notification.validation.device')) throw error;
    data = await request(session, path);
  }
  return notificationSettings(session.id, deviceId, data);
}
export async function setMessageNotificationsApi(session: SeatSession, body: SetMessageNotifications): Promise<MessageNotificationSettings> {
  if (!DEVICE_ID.test(body.deviceId) || !Number.isSafeInteger(body.revision) || body.revision < 0 || typeof body.enabled !== 'boolean'
    || !body.enabled && body.expoPushToken !== undefined || body.enabled && body.expoPushToken === undefined && body.incoming === undefined
    || body.expoPushToken !== undefined && !EXPO_PUSH_TOKEN.test(body.expoPushToken)
    || body.incoming !== undefined && (typeof body.incoming !== 'boolean' || body.incoming && !body.enabled)) throw new Error('Invalid notification preference.');
  return notificationSettings(session.id, body.deviceId, await request(session, `games/${session.id}/notifications${body.incoming === undefined ? '' : '?version=2'}`, body));
}
function notificationSettings(gameId: string, deviceId: string, data: any): MessageNotificationSettings {
  const keys = data && typeof data === 'object' ? Object.keys(data) : [];
  if (!keys.length || keys.some(key => !['gameId', 'deviceId', 'revision', 'available', 'enabled', 'bindingId', 'incoming'].includes(key)) || data.gameId !== gameId || data.deviceId !== deviceId
    || !Number.isSafeInteger(data.revision) || data.revision < 0 || typeof data.available !== 'boolean' || typeof data.enabled !== 'boolean'
    || data.enabled !== (data.bindingId !== undefined)
    || data.incoming !== undefined && (typeof data.incoming !== 'boolean' || data.incoming && !data.enabled)
    || data.bindingId !== undefined && (typeof data.bindingId !== 'string' || !OPAQUE_ID.test(data.bindingId))) throw new Error('Unsupported notification settings response.');
  return { gameId, deviceId, revision: data.revision, available: data.available, enabled: data.enabled, ...(data.bindingId === undefined ? {} : { bindingId: data.bindingId }), ...(data.incoming === undefined ? {} : { incoming: data.incoming }) };
}
