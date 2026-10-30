/** Installation identity, opaque tap payloads, and authenticated notification navigation. */
import { INCOMING_NOTIFICATION_KIND, MESSAGE_NOTIFICATION_KIND, type IncomingNotificationData, type MessageNotificationData } from '../contracts/notifications';
import { OPAQUE_ID } from './network';

export type InstallationStore = { getItemAsync(key: string): Promise<string | null>; setItemAsync(key: string, value: string): Promise<void> };
const DEVICE_KEY = 'machination.notifications.v1.device';
const REGISTERED_KEY = 'machination.notifications.v1.registered';

let pendingDeviceId: Promise<string> | undefined;
/** One random 32-byte identifier per installation, created on first use and kept in secure storage. */
export function installationDeviceId(store: InstallationStore, randomBytes: (count: number) => Promise<Uint8Array>): Promise<string> {
  pendingDeviceId ??= (async () => {
    const stored = await store.getItemAsync(DEVICE_KEY);
    if (stored && /^[a-f0-9]{64}$/.test(stored)) return stored;
    const bytes = await randomBytes(32);
    if (bytes.length !== 32) throw new Error('Secure random bytes are unavailable.');
    const id = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    await store.setItemAsync(DEVICE_KEY, id);
    return id;
  })().catch(error => { pendingDeviceId = undefined; throw error; });
  return pendingDeviceId;
}
export function resetInstallationCache() { pendingDeviceId = undefined; }

// Taps are only handled once this installation has opted in somewhere, so offline-only players never load the SDK.
const registrationListeners = new Set<() => void>();
export async function wasRegistered(store: InstallationStore): Promise<boolean> { return await store.getItemAsync(REGISTERED_KEY) === '1'; }
export async function markRegistered(store: InstallationStore): Promise<void> {
  await store.setItemAsync(REGISTERED_KEY, '1');
  for (const listener of registrationListeners) listener();
}
export function onRegistered(listener: () => void): () => void { registrationListeners.add(listener); return () => { registrationListeners.delete(listener); }; }

export type NotificationRequest = Pick<MessageNotificationData | IncomingNotificationData, 'kind' | 'gameId' | 'bindingId' | 'notificationId'>;
export function parseNotificationData(data: unknown): NotificationRequest | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const d = data as Record<string, unknown>;
  if (Object.keys(d).sort().join(',') !== 'bindingId,gameId,kind,notificationId,version' || ![MESSAGE_NOTIFICATION_KIND, INCOMING_NOTIFICATION_KIND].includes(d.kind as string) || d.version !== 1) return undefined;
  if (typeof d.gameId !== 'string' || !/^[a-f0-9]{24}$/.test(d.gameId)) return undefined;
  if (typeof d.bindingId !== 'string' || !OPAQUE_ID.test(d.bindingId) || typeof d.notificationId !== 'string' || !OPAQUE_ID.test(d.notificationId)) return undefined;
  return { kind: d.kind as NotificationRequest['kind'], gameId: d.gameId, bindingId: d.bindingId, notificationId: d.notificationId };
}

export type NotificationTarget = {
  /** The restored operation has finished loading, successfully or not. */
  restored: boolean;
  gameId?: string;
  /** undefined while this seat's notification settings are still loading. null when settled without a binding. */
  bindingId?: string | null;
  incoming?: boolean;
};
/** Opens only for the restored operation and current binding, including fresh consent for detailed attacks. */
export function notificationDisposition(request: NotificationRequest, target: NotificationTarget): 'open' | 'wait' | 'ignore' {
  if (!target.restored) return 'wait';
  if (!target.gameId || target.gameId !== request.gameId) return 'ignore';
  if (target.bindingId === undefined) return 'wait';
  if (target.bindingId !== request.bindingId) return 'ignore';
  return request.kind === INCOMING_NOTIFICATION_KIND && target.incoming !== true ? 'ignore' : 'open';
}
