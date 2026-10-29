/**
 * ---
 * purpose: Durable message-notification bindings and delivery jobs, applied inside database transactions.
 * related:
 *   - ./push-worker.ts - claims jobs, sends outside transactions, and records tickets and receipts
 *   - ../src/online/notification-contract.ts - shared client contract
 * ---
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Faction } from '../src/game/players';
import { INCOMING_NOTIFICATION_CHANNEL, INCOMING_NOTIFICATION_KIND, MESSAGE_NOTIFICATION_CHANNEL, MESSAGE_NOTIFICATION_KIND, type IncomingNotificationData, type MessageNotificationData } from '../src/online/notification-contract';
import type { Database, Room } from './database';

const HOUR_MS = 3_600_000;
export const NOTIFICATION_LIMITS = {
  devicesPerSeat: 4, bindings: 40_000, jobs: 5_000, jobsPerBinding: 8, incomingJobsPerBinding: 8, requestsPerBinding: 16, sendBatch: 100, receiptBatch: 1_000,
  incomingKeysPerSeat: 4_096, incomingKeyLength: 256,
} as const;
export const NOTIFICATION_TIMING = {
  leaseMs: 60_000, sendWindowMs: 24 * HOUR_MS, receiptDelayMs: 15 * 60_000, receiptRetentionMs: 24 * HOUR_MS,
  backoffBaseMs: 30_000, backoffMaxMs: HOUR_MS, maxAttempts: 8,
} as const;
export const NOTIFICATION_TITLE = 'Machination';
export const NOTIFICATION_BODY = 'New transmission received.';
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
export const revisionFloor = (state: NotificationState | undefined, roomId: string, faction: Faction) =>
  state?.floors?.find(f => f.roomId === roomId && f.faction === faction)?.revision ?? 0;
/** Removes a disabled record, raising its seat's floor first. Unknown devices then start from the floor. */
export function evict(state: NotificationState, binding: Binding): void {
  detach(state, binding);
  const floors = state.floors ??= [];
  const floor = floors.find(f => f.roomId === binding.roomId && f.faction === binding.faction);
  if (floor) floor.revision = Math.max(floor.revision, binding.revision + 1);
  else floors.push({ roomId: binding.roomId, faction: binding.faction, revision: binding.revision + 1 });
  state.bindings = state.bindings.filter(b => b !== binding);
}
export type PushMessage = {
  to: string; title: string; body: string; data: MessageNotificationData | IncomingNotificationData;
  channelId: string; collapseId: string; tag: string; ttl: number;
};
export type SendResult = { kind: 'ticket'; id: string } | { kind: 'retry'; delayMs?: number } | { kind: 'drop' } | { kind: 'unregistered' };
export type ReceiptResult = { kind: 'ok' } | { kind: 'unregistered' } | { kind: 'resend' } | { kind: 'drop' } | { kind: 'missing' } | { kind: 'retry'; delayMs?: number };
export type SendClaim = { lease: string; items: { jobId: string; message: PushMessage }[] };
export type ReceiptClaim = { lease: string; items: { jobId: string; ticketId: string }[] };

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
/** Changes whenever the seat's credential changes: legacy recovery replaces the hash, and linking adds an account. */
export const seatGeneration = (seat: Room['seats'][number]) =>
  digest(`machination.notification-generation:${seat.accountId ? `account:${seat.accountId}` : `seat:${seat.hash}`}`);
export const notificationId = (bindingId: string, messageRef: string) => digest(`machination.notification:v1:${bindingId}:${messageRef}`).slice(0, 32);
export const newBindingId = () => randomBytes(16).toString('hex');
export const tokenHash = (token: string) => digest(`machination.push-token:${token}`);

export function backoff(attempts: number): number {
  return Math.min(NOTIFICATION_TIMING.backoffMaxMs, NOTIFICATION_TIMING.backoffBaseMs * 2 ** Math.max(0, attempts - 1));
}
function generationOf(db: Database, binding: Binding): string | undefined {
  const seat = db.rooms.find(r => r.id === binding.roomId)?.seats.find(s => s.faction === binding.faction);
  return seat && seatGeneration(seat);
}
export const isCurrent = (db: Database, binding: Binding) => binding.generation === generationOf(db, binding);
const deliverable = (db: Database, binding: Binding | undefined): binding is Binding & { token: string } =>
  !!binding && binding.enabled && !!binding.token && isCurrent(db, binding);
export const acceptsIncoming = (db: Database, binding: Binding | undefined): binding is Binding & { token: string; incoming: true } =>
  deliverable(db, binding) && binding.incoming === true;
const jobDeliverable = (db: Database, job: Job, binding: Binding | undefined) => job.kind === 'incoming' ? acceptsIncoming(db, binding) : deliverable(db, binding);
export const incomingLedger = (state: NotificationState | undefined, roomId: string, faction: Faction) =>
  state?.incoming?.find(l => l.roomId === roomId && l.faction === faction);
export function setIncomingLedger(state: NotificationState, roomId: string, faction: Faction, keys: string[] | undefined): void {
  const others = (state.incoming ?? []).filter(l => l.roomId !== roomId || l.faction !== faction);
  state.incoming = keys ? [...others, { roomId, faction, keys }] : others;
}

/** Turns a binding off and removes its queued work; the caller's revision is kept. */
export function detach(state: NotificationState, binding: Binding): void {
  binding.enabled = false; delete binding.token; delete binding.incoming;
  state.jobs = state.jobs.filter(job => job.bindingId !== binding.id);
}
export function invalidateSeat(db: Database, roomId: string, faction: Faction): void {
  const state = db.notifications;
  if (!state) return;
  for (const binding of state.bindings) if (binding.roomId === roomId && binding.faction === faction && !isCurrent(db, binding)) detach(state, binding);
}

/** Adds at most one queued message job per binding; full queues skip delivery instead of rejecting chat. Incoming jobs never coalesce messages. */
export function enqueue(db: Database, room: Room, audience: readonly Faction[], messageRef: string, now: number): number {
  const state = db.notifications;
  if (!state) return 0;
  const targets = state.bindings.filter(b => b.roomId === room.id && audience.includes(b.faction) && deliverable(db, b));
  const additions: Job[] = [];
  for (const binding of targets) {
    const own = state.jobs.filter(job => job.bindingId === binding.id && job.kind !== 'incoming');
    const id = notificationId(binding.id, messageRef);
    if (own.some(job => job.state === 'queued' || job.id === id) || own.length >= NOTIFICATION_LIMITS.jobsPerBinding) continue;
    if (state.jobs.length + additions.length >= NOTIFICATION_LIMITS.jobs) break;
    additions.push({ id, bindingId: binding.id, roomId: room.id, createdAt: now, expiresAt: now + NOTIFICATION_TIMING.sendWindowMs, attempts: 0, state: 'queued', availableAt: now });
  }
  state.jobs.push(...additions);
  return additions.length;
}

/** One job per consenting binding and first observation. Expiry never outlasts the threat's arrival. */
export function enqueueIncoming(db: Database, roomId: string, alerts: readonly (IncomingAlert & { firstHour: number; arrivesAt: number })[], now: number): number {
  const state = db.notifications;
  if (!state) return 0;
  const additions: Job[] = [];
  for (const alert of alerts) {
    if (alert.arrivesAt <= now) continue;
    for (const binding of state.bindings.filter(b => b.roomId === roomId && b.faction === alert.faction && acceptsIncoming(db, b))) {
      const id = notificationId(binding.id, `incoming:${alert.key}:${alert.firstHour}`);
      const own = [...state.jobs, ...additions].filter(job => job.bindingId === binding.id && job.kind === 'incoming');
      if (own.some(job => job.id === id) || own.length >= NOTIFICATION_LIMITS.incomingJobsPerBinding) continue;
      if (state.jobs.length + additions.length >= NOTIFICATION_LIMITS.jobs) break;
      additions.push({ id, bindingId: binding.id, roomId, createdAt: now, expiresAt: Math.min(now + NOTIFICATION_TIMING.sendWindowMs, alert.arrivesAt),
        attempts: 0, state: 'queued', availableAt: now, kind: 'incoming', alert: { faction: alert.faction, fleet: alert.fleet, key: alert.key } });
    }
  }
  state.jobs.push(...additions);
  return additions.length;
}

function prune(db: Database, state: NotificationState, now: number): void {
  const bindings = new Map(state.bindings.map(b => [b.id, b]));
  state.jobs = state.jobs.filter(job => {
    const binding = bindings.get(job.bindingId);
    if (job.state === 'queued' || job.state === 'sending') return jobDeliverable(db, job, binding) && job.expiresAt > now;
    return job.ticketAt! + NOTIFICATION_TIMING.receiptRetentionMs > now;
  });
}
const leased = (job: Job, now: number) => !job.lease || job.lease.until <= now;

/** Renders an incoming job from fresh authorized state, or returns undefined when the threat is obsolete. */
export type IncomingRenderer = (job: Job & { alert: IncomingAlert }) => { body: string } | undefined;
export function claimSends(db: Database, owner: string, now: number, limit: number = NOTIFICATION_LIMITS.sendBatch, render: IncomingRenderer = () => undefined): SendClaim {
  const lease = randomBytes(16).toString('hex');
  const state = db.notifications;
  if (!state) return { lease, items: [] };
  prune(db, state, now);
  const bindings = new Map(state.bindings.map(b => [b.id, b]));
  // Lost leases and shutdown releases have already spent an attempt; never claim past the limit.
  const exhausted = (job: Job) => (job.state === 'queued' || job.state === 'sending' && leased(job, now)) && job.attempts >= NOTIFICATION_TIMING.maxAttempts;
  state.jobs = state.jobs.filter(job => !exhausted(job));
  const due = state.jobs.filter(job => job.state === 'queued' && job.availableAt <= now || job.state === 'sending' && leased(job, now))
    .sort((a, b) => a.availableAt - b.availableAt || a.createdAt - b.createdAt);
  const items: SendClaim['items'] = [];
  for (const job of due) {
    if (items.length >= limit) break;
    const binding = bindings.get(job.bindingId) as Binding & { token: string };
    const incoming = job.kind === 'incoming' ? render(job as Job & { alert: IncomingAlert }) : undefined;
    if (job.kind === 'incoming' && !incoming) { state.jobs = state.jobs.filter(j => j !== job); continue; }
    Object.assign(job, { state: 'sending', attempts: job.attempts + 1, tokenHash: tokenHash(binding.token), lease: { owner, token: lease, until: now + NOTIFICATION_TIMING.leaseMs } });
    const data = { version: 1 as const, gameId: job.roomId, bindingId: binding.id, notificationId: job.id };
    items.push({ jobId: job.id, message: {
      to: binding.token, title: NOTIFICATION_TITLE, body: incoming?.body ?? NOTIFICATION_BODY,
      data: incoming ? { kind: INCOMING_NOTIFICATION_KIND, ...data } : { kind: MESSAGE_NOTIFICATION_KIND, ...data },
      channelId: incoming ? INCOMING_NOTIFICATION_CHANNEL : MESSAGE_NOTIFICATION_CHANNEL, collapseId: job.id, tag: job.id, ttl: Math.max(1, Math.ceil((job.expiresAt - now) / 1000)),
    } });
  }
  return { lease, items };
}

function cleanupToken(state: NotificationState, job: Job): void {
  const binding = state.bindings.find(b => b.id === job.bindingId);
  if (binding?.token && job.tokenHash === tokenHash(binding.token)) detach(state, binding);
}
function requeue(state: NotificationState, job: Job, now: number, delayMs = 0): void {
  const availableAt = now + Math.max(delayMs, backoff(job.attempts));
  if (job.attempts >= NOTIFICATION_TIMING.maxAttempts || availableAt >= job.expiresAt) { state.jobs = state.jobs.filter(j => j !== job); return; }
  Object.assign(job, { state: 'queued', availableAt });
  delete job.lease; delete job.ticketId; delete job.ticketAt;
}

export function finishSends(db: Database, lease: string, results: ReadonlyMap<string, SendResult>, now: number): void {
  const state = db.notifications;
  if (!state) return;
  for (const [jobId, result] of results) {
    const job = state.jobs.find(j => j.id === jobId && j.state === 'sending' && j.lease?.token === lease);
    if (!job) continue;
    if (result.kind === 'ticket') {
      Object.assign(job, { state: 'ticketed', ticketId: result.id, ticketAt: now, availableAt: now + NOTIFICATION_TIMING.receiptDelayMs });
      delete job.lease;
    } else if (result.kind === 'retry') requeue(state, job, now, result.delayMs);
    else {
      if (result.kind === 'unregistered') cleanupToken(state, job);
      state.jobs = state.jobs.filter(j => j !== job);
    }
  }
}

export function claimReceipts(db: Database, owner: string, now: number, limit: number = NOTIFICATION_LIMITS.receiptBatch): ReceiptClaim {
  const lease = randomBytes(16).toString('hex');
  const state = db.notifications;
  if (!state) return { lease, items: [] };
  prune(db, state, now);
  const due = state.jobs.filter(job => job.state === 'ticketed' && job.availableAt <= now || job.state === 'checking' && leased(job, now))
    .sort((a, b) => a.availableAt - b.availableAt).slice(0, limit);
  return { lease, items: due.map(job => {
    Object.assign(job, { state: 'checking', lease: { owner, token: lease, until: now + NOTIFICATION_TIMING.leaseMs } });
    return { jobId: job.id, ticketId: job.ticketId! };
  }) };
}

export function finishReceipts(db: Database, lease: string, results: ReadonlyMap<string, ReceiptResult>, now: number): void {
  const state = db.notifications;
  if (!state) return;
  for (const [jobId, result] of results) {
    const job = state.jobs.find(j => j.id === jobId && j.state === 'checking' && j.lease?.token === lease);
    if (!job) continue;
    if (result.kind === 'resend') { requeue(state, job, now); continue; }
    if (result.kind === 'missing' || result.kind === 'retry') {
      const availableAt = now + Math.max(result.kind === 'retry' ? result.delayMs ?? 0 : 0, NOTIFICATION_TIMING.receiptDelayMs);
      if (availableAt >= job.ticketAt! + NOTIFICATION_TIMING.receiptRetentionMs) { state.jobs = state.jobs.filter(j => j !== job); continue; }
      Object.assign(job, { state: 'ticketed', availableAt }); delete job.lease;
      continue;
    }
    if (result.kind === 'unregistered') cleanupToken(state, job);
    state.jobs = state.jobs.filter(j => j !== job);
  }
}

/** Returns leased work to the queue without waiting for lease expiry, for shutdown. */
export function release(db: Database, lease: string, now: number): void {
  for (const job of db.notifications?.jobs ?? []) {
    if (job.lease?.token !== lease) continue;
    Object.assign(job, { state: job.state === 'sending' ? 'queued' : 'ticketed', availableAt: now });
    delete job.lease;
  }
}

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
