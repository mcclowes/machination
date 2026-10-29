/**
 * ---
 * purpose: Background message-notification delivery with durable leases. Delivery is at least once to the provider, never exactly once.
 * related:
 *   - ./notifications.ts - durable job transitions
 *   - ./expo-push.ts - provider transport
 * ---
 */
import { randomBytes } from 'node:crypto';
import type { NotificationQueue } from './service';
import type { PushProvider, Receipt, RequestFailure, Ticket } from './expo-push';
import type { ReceiptResult, SendResult } from './notifications';

const sendResult = (ticket: Ticket | undefined, retryAfterMs?: number): SendResult => {
  if (ticket?.status === 'ok') return { kind: 'ticket', id: ticket.id };
  if (ticket?.status === 'error') return ticket.error === 'DeviceNotRegistered' ? { kind: 'unregistered' }
    : ticket.error === 'MessageRateExceeded' ? { kind: 'retry' } : { kind: 'drop' };
  return { kind: 'retry', ...(retryAfterMs ? { delayMs: retryAfterMs } : {}) };
};
const receiptResult = (receipt: Receipt | undefined): ReceiptResult => !receipt ? { kind: 'missing' } : receipt.status === 'ok' ? { kind: 'ok' }
  : receipt.error === 'DeviceNotRegistered' ? { kind: 'unregistered' } : receipt.error === 'MessageRateExceeded' ? { kind: 'resend' } : { kind: 'drop' };

export class NotificationWorker {
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopping = false;
  private abort = new AbortController();
  private leases = new Set<string>();
  private settledAt = -Infinity;
  readonly owner: string;
  constructor(private queue: NotificationQueue, private provider: PushProvider, private options: { intervalMs?: number; settleIntervalMs?: number; now?: () => number; log?: (message: string) => void } = {}) {
    this.owner = `worker-${randomBytes(8).toString('hex')}`;
  }
  start(): void { this.schedule(0); }
  private schedule(delay: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.running = this.runOnce().then(() => undefined, error => this.log(`Notification cycle failed: ${(error as Error).name}`))
        .finally(() => { this.running = undefined; this.schedule(this.options.intervalMs ?? 5_000); });
    }, delay);
    this.timer.unref();
  }
  private log(message: string): void { (this.options.log ?? console.error)(message); }

  /** At most one zero-client settlement per interval, then one send pass and one receipt pass. Provider calls happen outside database transactions. */
  async runOnce(): Promise<{ sent: number; checked: number }> {
    let sent = 0, checked = 0;
    if (this.stopping) return { sent, checked };
    const now = (this.options.now ?? Date.now)();
    if (this.queue.settleIncoming && now - this.settledAt >= (this.options.settleIntervalMs ?? 60_000)) {
      this.settledAt = now;
      await this.queue.settleIncoming().catch(error => this.log(`Incoming settlement failed: ${(error as Error).name}`));
      if (this.stopping) return { sent, checked };
    }
    const sends = await this.queue.claimSends(this.owner);
    if (sends.items.length) {
      this.leases.add(sends.lease);
      try {
        const outcome = await this.provider.send(sends.items.map(item => item.message), this.abort.signal).catch((): RequestFailure => ({ kind: 'retry', reason: 'provider' }));
        if (outcome.kind !== 'tickets') this.log(`Notification send ${outcome.kind}: ${outcome.reason}`);
        const results = new Map(sends.items.map((item, i): [string, SendResult] => [item.jobId,
          outcome.kind === 'tickets' ? sendResult(outcome.tickets[i]) : outcome.kind === 'retry' ? sendResult(undefined, outcome.retryAfterMs) : { kind: 'drop' }]));
        await this.queue.finishSends(sends.lease, results);
        sent = sends.items.length;
      } finally { this.leases.delete(sends.lease); }
    }
    if (this.stopping) return { sent, checked };
    const receipts = await this.queue.claimReceipts(this.owner);
    if (receipts.items.length) {
      this.leases.add(receipts.lease);
      try {
        const outcome = await this.provider.receipts(receipts.items.map(item => item.ticketId), this.abort.signal).catch((): RequestFailure => ({ kind: 'retry', reason: 'provider' }));
        if (outcome.kind !== 'receipts') this.log(`Notification receipts ${outcome.kind}: ${outcome.reason}`);
        const results = new Map(receipts.items.map((item): [string, ReceiptResult] => [item.jobId,
          outcome.kind === 'receipts' ? receiptResult(outcome.receipts[item.ticketId]) : { kind: 'retry', ...(outcome.kind === 'retry' && outcome.retryAfterMs ? { delayMs: outcome.retryAfterMs } : {}) }]));
        await this.queue.finishReceipts(receipts.lease, results);
        checked = receipts.items.length;
      } finally { this.leases.delete(receipts.lease); }
    }
    return { sent, checked };
  }

  /** Stops new claims, lets current work finish within the grace period, then aborts it and releases its leases. */
  async stop(graceMs = 10_000): Promise<void> {
    this.stopping = true;
    clearTimeout(this.timer);
    const current = this.running;
    if (!current) return;
    const wait = (ms: number) => new Promise<false>(resolve => setTimeout(resolve, ms, false).unref());
    if (await Promise.race([current.then(() => true), wait(graceMs)])) return;
    const leases = [...this.leases];
    this.abort.abort();
    if (await Promise.race([current.then(() => true), wait(1_000)])) return;
    await Promise.all(leases.map(lease => this.queue.release(lease)));
  }
}
