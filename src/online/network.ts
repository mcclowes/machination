import { authorization, type RequestSession } from './account-auth';
import { abortable, throwIfAborted } from './request-abort';
import { validateOptions, type GameOptions } from '../game/rules';
import type { HistorySnapshot, Snapshot } from './protocol';
import { snapshotResponse, historicalResponse } from './snapshot-response';
import type { MessageNotificationSettings, SetMessageNotifications } from './notification-contract';

export class RejectedCommand extends Error { constructor(public status: number, message: string, public issue?: string) { super(message); } }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function rejection(data: unknown): { detail: string; issue?: string } {
  const first = record(data) && Array.isArray(data.issues) ? data.issues[0] as unknown : undefined;
  const message = record(first) && record(first.message) ? first.message : undefined;
  return { detail: typeof message?.detail === 'string' ? message.detail : 'Command was not accepted.',
    ...(record(first) && typeof first.issue === 'string' ? { issue: first.issue } : {}) };
}
async function request(session: RequestSession, path: string, payload?: unknown, signal?: AbortSignal): Promise<unknown> {
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
    const data: unknown = await response.json();
    if (!response.ok) {
      const { detail, issue } = rejection(data);
      if (response.status >= 400 && response.status < 500 && response.status !== 429) throw new RejectedCommand(response.status, detail, issue);
      throw new Error(detail);
    }
    return data;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export async function api(session: RequestSession & { id?: string }, path: string, payload?: unknown): Promise<Snapshot> {
  const data = await request(session, path, payload);
  return snapshotResponse(session.id, data);
}
export async function accountSessionApi(session: RequestSession & { id?: string }): Promise<Snapshot | null> {
  const data = await request(session, 'account/session');
  const snapshot = record(data) ? data.snapshot : undefined;
  return snapshot === null ? null : snapshotResponse(session.id, snapshot);
}
export async function historicalApi(session: RequestSession & { id: string }, hour: number, signal?: AbortSignal): Promise<HistorySnapshot> {
  if (!Number.isFinite(hour)) throw new Error('Choose a finite historical hour.');
  const data = await request(session, `games/${session.id}/history?hour=${encodeURIComponent(hour)}`, undefined, signal);
  return historicalResponse(session.id, hour, data);
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
function notificationSettings(gameId: string, deviceId: string, data: unknown): MessageNotificationSettings {
  if (!record(data)) throw new Error('Unsupported notification settings response.');
  const keys = Object.keys(data);
  if (!keys.length || keys.some(key => !['gameId', 'deviceId', 'revision', 'available', 'enabled', 'bindingId', 'incoming'].includes(key)) || data.gameId !== gameId || data.deviceId !== deviceId
    || typeof data.revision !== 'number' || !Number.isSafeInteger(data.revision) || data.revision < 0 || typeof data.available !== 'boolean' || typeof data.enabled !== 'boolean'
    || data.enabled !== (data.bindingId !== undefined)
    || data.incoming !== undefined && (typeof data.incoming !== 'boolean' || data.incoming && !data.enabled)
    || data.bindingId !== undefined && (typeof data.bindingId !== 'string' || !OPAQUE_ID.test(data.bindingId))) throw new Error('Unsupported notification settings response.');
  return { gameId, deviceId, revision: data.revision, available: data.available, enabled: data.enabled, ...(data.bindingId === undefined ? {} : { bindingId: data.bindingId }), ...(data.incoming === undefined ? {} : { incoming: data.incoming }) };
}
