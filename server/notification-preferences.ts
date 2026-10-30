/**
 * ---
 * purpose: Validate notification preferences and apply revisioned binding and consent changes inside a transaction.
 * related:
 *   - ./service.ts - authorization, atomic transactions, and incoming-threat seeding
 *   - ./notifications.ts - durable binding and delivery invariants
 * ---
 */
import type { Database, Room } from './database';
import type { Faction } from '../src/game/players';
import type { MessageNotificationSettings } from '../src/contracts/notifications';
import { Failure, requireThat } from './failure';
import { detach, evict, EXPO_TOKEN, isCurrent, newBindingId, NOTIFICATION_LIMITS, revisionFloor, seatAcceptsIncoming, seatGeneration, setIncomingLedger, tokenHash } from './notifications';

const SETTING_KEYS = ['requestId', 'deviceId', 'revision', 'enabled', 'expoPushToken'];
export type NotificationVersion = 1 | 2;
export function canonicalNotificationSetting(input: unknown, version: NotificationVersion = 1) {
  const invalid = () => new Failure(400, 'notification.validation.payload', version === 2
    ? 'Provide a device, revision, request ID, incoming consent, and a valid push token only when enabling.'
    : 'Provide a device, revision, request ID, and a valid push token only when enabling.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const value = input as Record<string, unknown>;
  const keys = version === 2 ? [...SETTING_KEYS, 'incoming'] : SETTING_KEYS;
  if (version === 2 && (typeof value.incoming !== 'boolean' || value.incoming && value.enabled !== true)) throw invalid();
  if (Object.keys(value).some(key => !keys.includes(key)) || !['requestId', 'deviceId', 'revision', 'enabled'].every(key => Object.hasOwn(value, key))
    || typeof value.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(value.requestId)
    || typeof value.deviceId !== 'string' || !/^[a-f0-9]{64}$/.test(value.deviceId)
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || typeof value.enabled !== 'boolean') throw invalid();
  const hasToken = Object.hasOwn(value, 'expoPushToken');
  if (!value.enabled && hasToken) throw invalid();
  const requiresToken = value.enabled && (version !== 2 || hasToken);
  if (requiresToken && (typeof value.expoPushToken !== 'string' || !EXPO_TOKEN.test(value.expoPushToken))) throw invalid();
  return { requestId: value.requestId, deviceId: value.deviceId, revision: value.revision as number, enabled: value.enabled,
    ...(value.enabled && typeof value.expoPushToken === 'string' ? { expoPushToken: value.expoPushToken as string } : {}), ...(version === 2 ? { incoming: value.incoming as boolean } : {}) };
}
type PreferenceOptions = { version: NotificationVersion; available: boolean };

export function notificationPreferenceView(db: Database, roomId: string, faction: Faction, deviceId: string, options: PreferenceOptions): MessageNotificationSettings {
  const binding = db.notifications?.bindings.find(b => b.roomId === roomId && b.faction === faction && b.deviceId === deviceId);
  const enabled = !!binding?.enabled && isCurrent(db, binding);
  return { gameId: roomId, deviceId, revision: binding?.revision ?? revisionFloor(db.notifications, roomId, faction), available: options.available, enabled,
    ...(options.version === 2 ? { incoming: enabled && binding!.incoming === true } : {}), ...(enabled ? { bindingId: binding!.id } : {}) };
}

/** Mutates only notification metadata; the service seeds threats when consent is newly granted. */
export function setNotificationPreferences(db: Database, room: Room, faction: Faction, command: ReturnType<typeof canonicalNotificationSetting>, options: PreferenceOptions & { now: () => number }): { settings: MessageNotificationSettings; seedIncoming: boolean } {
  const seat = room.seats.find(s => s.faction === faction)!;
  const state = db.notifications ??= { bindings: [], jobs: [] };
  let binding = state.bindings.find(b => b.roomId === room.id && b.faction === faction && b.deviceId === command.deviceId);
  const payload = JSON.stringify(['notifications', command.revision, command.enabled, command.expoPushToken ? tokenHash(command.expoPushToken) : command.enabled ? 'retain-token' : null,
    ...(command.incoming === undefined ? [] : ['incoming', command.incoming])]);
  const prior = binding?.requests.find(r => r.id === command.requestId);
  requireThat(!prior || prior.payload === payload, 409, 'command.conflict.reused_id', 'This command ID was used for different content.');
  if (prior) return { settings: notificationPreferenceView(db, room.id, faction, command.deviceId, options), seedIncoming: false };
  const hadConsent = seatAcceptsIncoming(db, room.id, faction);
  requireThat(command.revision === (binding?.revision ?? revisionFloor(state, room.id, faction)), 409, 'notification.conflict.stale', 'Notification settings changed. Refresh before changing them.');
  // A version-2 consent change without a token only edits an existing enabled, current binding; it never attaches a device.
  const flagOnly = command.enabled && command.expoPushToken === undefined;
  if (flagOnly) requireThat(binding?.enabled && binding.token && isCurrent(db, binding), 409, 'notification.conflict.unbound', 'Enable notifications on this device before changing attack alerts.');
  requireThat(!command.enabled || options.available || flagOnly && command.incoming === false, 503, 'notification.unavailable.delivery', 'This server does not deliver notifications.');
  if (!binding) {
    const own = state.bindings.filter(b => b.roomId === room.id && b.faction === faction);
    if (own.length >= NOTIFICATION_LIMITS.devicesPerSeat) {
      const oldest = own.filter(b => !b.enabled || !isCurrent(db, b)).sort((a, b) => a.updatedAt - b.updatedAt)[0];
      requireThat(oldest, 409, 'notification.capacity.devices', `Message notifications are limited to ${NOTIFICATION_LIMITS.devicesPerSeat} devices per seat. Disable one first.`);
      evict(state, oldest);
    }
    requireThat(state.bindings.length < NOTIFICATION_LIMITS.bindings, 503, 'notification.capacity.reached', 'This server has reached its notification device limit.');
    binding = { id: newBindingId(), roomId: room.id, faction, deviceId: command.deviceId, generation: seatGeneration(seat), revision: command.revision, enabled: false, updatedAt: options.now(), requests: [] };
    state.bindings.push(binding);
  }
  if (!isCurrent(db, binding)) { detach(state, binding); binding.generation = seatGeneration(seat); }
  if (command.enabled) {
    const token = command.expoPushToken ?? binding.token!;
    for (const other of state.bindings) if (other !== binding && other.token === token) detach(state, other);
    if (!binding.enabled) binding.id = newBindingId();
    binding.enabled = true; binding.token = token;
    if (command.incoming === true) binding.incoming = true;
    else if (command.incoming === false) { delete binding.incoming; state.jobs = state.jobs.filter(job => job.bindingId !== binding!.id || job.kind !== 'incoming'); }
  } else detach(state, binding);
  binding.revision++; binding.updatedAt = options.now();
  binding.requests = [...binding.requests, { id: command.requestId, payload }].slice(-NOTIFICATION_LIMITS.requestsPerBinding);
  const hasConsent = seatAcceptsIncoming(db, room.id, faction);
  if (!hasConsent) setIncomingLedger(state, room.id, faction, undefined);
  return { settings: notificationPreferenceView(db, room.id, faction, command.deviceId, options), seedIncoming: hasConsent && !hadConsent };
}
