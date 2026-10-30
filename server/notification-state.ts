/**
 * ---
 * purpose: Own persisted notification metadata, capacity limits, and restart validation.
 * related:
 *   - ./notifications.ts - transaction-local binding and delivery transitions
 *   - ./database.ts - atomic persistence and startup loading
 * ---
 */
import type { Faction } from '../src/game/players';
import type { Database } from './database';

export const NOTIFICATION_LIMITS = {
  devicesPerSeat: 4, bindings: 40_000, jobs: 5_000, jobsPerBinding: 8, incomingJobsPerBinding: 8, requestsPerBinding: 16, sendBatch: 100, receiptBatch: 1_000,
  incomingKeysPerSeat: 4_096, incomingKeyLength: 256,
} as const;
// Expo publishes no character set for the bracketed part, so accept any non-whitespace content, as the client does.
export const EXPO_TOKEN = /^Expo(?:nent)?PushToken\[[^\]\s]{1,200}\]$/;

export type Binding = {
  id: string; roomId: string; faction: Faction; deviceId: string; generation: string;
  revision: number; enabled: boolean; token?: string; updatedAt: number; requests: { id: string; payload: string }[];
  /** Incoming-attack consent; stored only while enabled, and cleared with the binding. */
  incoming?: true;
};
/** Server-only canonical reference to an observed incoming threat; never sent to a device. */
export type IncomingAlert = { faction: Faction; fleet: number; key: string };
type Lease = { owner: string; token: string; until: number };
export type Job = {
  id: string; bindingId: string; roomId: string; createdAt: number; expiresAt: number; attempts: number;
  state: 'queued' | 'sending' | 'ticketed' | 'checking'; availableAt: number;
  lease?: Lease; ticketId?: string; ticketAt?: number; tokenHash?: string;
  /** Absent for message jobs, so older files load unchanged. */
  kind?: 'incoming'; alert?: IncomingAlert;
};
/** A seat's revision floor rises above every evicted record, so no request issued before an eviction can apply afterwards. */
export type RevisionFloor = { roomId: string; faction: Faction; revision: number };
/** Each consenting seat's currently observed incoming threats, so only first observations notify. */
export type IncomingLedger = { roomId: string; faction: Faction; keys: string[] };
export type NotificationState = { bindings: Binding[]; jobs: Job[]; floors?: RevisionFloor[]; incoming?: IncomingLedger[] };

export function validateNotifications(database: Database): void {
  const state = database.notifications;
  if (state === undefined) return;
  const damaged = () => new Error('Damaged notification metadata.');
  const hex = (value: unknown, length: number) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
  const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
  const time = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (!state || !Array.isArray(state.bindings) || !Array.isArray(state.jobs)
    || state.bindings.length > NOTIFICATION_LIMITS.bindings || state.jobs.length > NOTIFICATION_LIMITS.jobs) throw damaged();
  const keys = new Set<string>(); const tokens = new Set<string>(); const ids = new Map<string, Binding>();
  for (const b of state.bindings) {
    const room = database.rooms.find(r => r.id === b?.roomId);
    if (!b || !hex(b.id, 32) || ids.has(b.id) || !room || !room.seats.some(s => s.faction === b.faction) || !hex(b.deviceId, 64) || !hex(b.generation, 64)
      || !count(b.revision) || typeof b.enabled !== 'boolean' || !time(b.updatedAt)
      || (b.token === undefined ? b.enabled : typeof b.token !== 'string' || !EXPO_TOKEN.test(b.token) || !b.enabled || tokens.has(b.token))
      || b.incoming !== undefined && (b.incoming !== true || !b.enabled)
      || !Array.isArray(b.requests) || b.requests.length > NOTIFICATION_LIMITS.requestsPerBinding
      || !b.requests.every(r => r && typeof r.id === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(r.id) && typeof r.payload === 'string')) throw damaged();
    const key = `${b.roomId}:${b.faction}:${b.deviceId}`;
    if (keys.has(key)) throw damaged();
    keys.add(key); ids.set(b.id, b); if (b.token) tokens.add(b.token);
  }
  if (state.floors !== undefined) {
    const seats = new Set<string>();
    if (!Array.isArray(state.floors) || !state.floors.every(f => f && database.rooms.find(r => r.id === f.roomId)?.seats.some(s => s.faction === f.faction) && count(f.revision) && f.revision > 0)) throw damaged();
    for (const f of state.floors) { const key = `${f.roomId}:${f.faction}`; if (seats.has(key)) throw damaged(); seats.add(key); }
  }
  if (state.incoming !== undefined) {
    const seats = new Set<string>();
    if (!Array.isArray(state.incoming) || state.incoming.length > NOTIFICATION_LIMITS.bindings) throw damaged();
    for (const l of state.incoming) {
      const key = `${l?.roomId}:${l?.faction}`;
      if (!l || !database.rooms.find(r => r.id === l.roomId)?.seats.some(s => s.faction === l.faction) || seats.has(key)
        || !Array.isArray(l.keys) || l.keys.length > NOTIFICATION_LIMITS.incomingKeysPerSeat || new Set(l.keys).size !== l.keys.length
        || !l.keys.every(k => typeof k === 'string' && k.length > 0 && k.length <= NOTIFICATION_LIMITS.incomingKeyLength)) throw damaged();
      seats.add(key);
    }
  }
  const jobs = new Set<string>();
  for (const j of state.jobs) {
    const binding = ids.get(j?.bindingId);
    const leasedState = j?.state === 'sending' || j?.state === 'checking';
    const ticketed = j?.state === 'ticketed' || j?.state === 'checking';
    if (!j || !hex(j.id, 32) || jobs.has(j.id) || !binding || j.roomId !== binding.roomId || !time(j.createdAt) || !time(j.expiresAt) || !count(j.attempts) || !time(j.availableAt)
      || !['queued', 'sending', 'ticketed', 'checking'].includes(j.state)
      || (leasedState ? !j.lease || typeof j.lease.owner !== 'string' || !hex(j.lease.token, 32) || !time(j.lease.until) : j.lease !== undefined)
      || (ticketed ? typeof j.ticketId !== 'string' || !j.ticketId || !time(j.ticketAt) : j.ticketId !== undefined || j.ticketAt !== undefined)
      || j.tokenHash !== undefined && !hex(j.tokenHash, 64)
      || (j.kind === undefined ? j.alert !== undefined : j.kind !== 'incoming' || !j.alert || j.alert.faction !== binding.faction
        || !Number.isSafeInteger(j.alert.fleet) || j.alert.fleet < 0 || typeof j.alert.key !== 'string' || !j.alert.key || j.alert.key.length > NOTIFICATION_LIMITS.incomingKeyLength
        || !j.alert.key.startsWith(`${j.alert.fleet}|`))) throw damaged();
    jobs.add(j.id);
  }
}
