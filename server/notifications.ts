/**
 * ---
 * purpose: Apply notification binding changes, enqueue work, and transition delivery leases inside transactions.
 * related:
 *   - ./notification-state.ts - persisted metadata and restart validation
 *   - ./push-worker.ts - claims jobs, sends outside transactions, and records tickets and receipts
 *   - ../src/online/notification-contract.ts - shared client contract
 * ---
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Faction } from '../src/game/players';
import { INCOMING_NOTIFICATION_CHANNEL, INCOMING_NOTIFICATION_KIND, MESSAGE_NOTIFICATION_CHANNEL, MESSAGE_NOTIFICATION_KIND, type IncomingNotificationData, type MessageNotificationData } from '../src/online/notification-contract';
import type { Database, Room } from './database';
import { NOTIFICATION_LIMITS, type Binding, type IncomingAlert, type Job, type NotificationState } from './notification-state';
export { EXPO_TOKEN, NOTIFICATION_LIMITS, validateNotifications } from './notification-state';
export type { Binding, IncomingAlert, IncomingLedger, Job, NotificationState, RevisionFloor } from './notification-state';

const HOUR_MS = 3_600_000;
export const NOTIFICATION_TIMING = {
  leaseMs: 60_000, sendWindowMs: 24 * HOUR_MS, receiptDelayMs: 15 * 60_000, receiptRetentionMs: 24 * HOUR_MS,
  backoffBaseMs: 30_000, backoffMaxMs: HOUR_MS, maxAttempts: 8,
} as const;
export const NOTIFICATION_TITLE = 'Machination';
export const NOTIFICATION_BODY = 'New transmission received.';
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
export const seatAcceptsIncoming = (db: Database, roomId: string, faction: Faction): boolean =>
  !!db.notifications?.bindings.some(b => b.roomId === roomId && b.faction === faction && acceptsIncoming(db, b));
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
type NotificationContent = { body: string; kind: PushMessage['data']['kind']; channelId: string };
function notificationContent(job: Job, render: IncomingRenderer): NotificationContent | undefined {
  if (job.kind !== 'incoming') return { body: NOTIFICATION_BODY, kind: MESSAGE_NOTIFICATION_KIND, channelId: MESSAGE_NOTIFICATION_CHANNEL };
  const incoming = render(job as Job & { alert: IncomingAlert });
  if (!incoming) return undefined;
  return { body: incoming.body ?? NOTIFICATION_BODY, kind: INCOMING_NOTIFICATION_KIND, channelId: INCOMING_NOTIFICATION_CHANNEL };
}

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
    const content = notificationContent(job, render);
    if (!content) { state.jobs = state.jobs.filter(j => j !== job); continue; }
    Object.assign(job, { state: 'sending', attempts: job.attempts + 1, tokenHash: tokenHash(binding.token), lease: { owner, token: lease, until: now + NOTIFICATION_TIMING.leaseMs } });
    const data = { version: 1 as const, gameId: job.roomId, bindingId: binding.id, notificationId: job.id };
    items.push({ jobId: job.id, message: {
      to: binding.token, title: NOTIFICATION_TITLE, body: content.body, data: { kind: content.kind, ...data },
      channelId: content.channelId, collapseId: job.id, tag: job.id, ttl: Math.max(1, Math.ceil((job.expiresAt - now) / 1000)),
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
    switch (result.kind) {
      case 'ticket':
        Object.assign(job, { state: 'ticketed', ticketId: result.id, ticketAt: now, availableAt: now + NOTIFICATION_TIMING.receiptDelayMs });
        delete job.lease;
        continue;
      case 'retry': requeue(state, job, now, result.delayMs); continue;
      case 'unregistered': cleanupToken(state, job); break;
      case 'drop': break;
    }
    state.jobs = state.jobs.filter(j => j !== job);
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
    switch (result.kind) {
      case 'resend': requeue(state, job, now); continue;
      case 'missing': recheckReceipt(state, job, now); continue;
      case 'retry': recheckReceipt(state, job, now, result.delayMs); continue;
      case 'unregistered': cleanupToken(state, job); break;
      case 'ok': case 'drop': break;
    }
    state.jobs = state.jobs.filter(j => j !== job);
  }
}

function recheckReceipt(state: NotificationState, job: Job, now: number, delayMs = 0): void {
  const availableAt = now + Math.max(delayMs, NOTIFICATION_TIMING.receiptDelayMs);
  if (availableAt >= job.ticketAt! + NOTIFICATION_TIMING.receiptRetentionMs) { state.jobs = state.jobs.filter(j => j !== job); return; }
  Object.assign(job, { state: 'ticketed', availableAt }); delete job.lease;
}

/** Returns leased work to the queue without waiting for lease expiry, for shutdown. */
export function release(db: Database, lease: string, now: number): void {
  for (const job of db.notifications?.jobs ?? []) {
    if (job.lease?.token !== lease) continue;
    Object.assign(job, { state: job.state === 'sending' ? 'queued' : 'ticketed', availableAt: now });
    delete job.lease;
  }
}
