/**
 * ---
 * purpose: Expo push transport and operator configuration. Tickets and receipts only show provider handoff, not delivery.
 * related:
 *   - ./push-worker.ts - maps transport results onto durable jobs
 * ---
 */
import type { PushMessage } from './notifications';

export const EXPO_ENDPOINTS = { send: 'https://exp.host/--/api/v2/push/send', receipts: 'https://exp.host/--/api/v2/push/getReceipts' } as const;
export type Ticket = { status: 'ok'; id: string } | { status: 'error'; error: string } | { status: 'malformed' };
export type Receipt = { status: 'ok' } | { status: 'error'; error: string };
export type RequestFailure = { kind: 'retry'; reason: string; retryAfterMs?: number } | { kind: 'reject'; reason: string };
export type PushProvider = {
  send(messages: PushMessage[], signal: AbortSignal): Promise<{ kind: 'tickets'; tickets: Ticket[] } | RequestFailure>;
  receipts(ids: string[], signal: AbortSignal): Promise<{ kind: 'receipts'; receipts: Record<string, Receipt> } | RequestFailure>;
};
export type PushConfiguration = { enabled: false } | { enabled: true; accessToken?: string };

export function pushConfiguration(env: Record<string, string | undefined>): PushConfiguration {
  const flag = env.MACHINATION_PUSH_ENABLED?.trim() ?? '';
  if (flag === '' || flag === '0') return { enabled: false };
  if (flag !== '1') throw new Error('MACHINATION_PUSH_ENABLED must be 1 to enable message notifications, or 0/unset to disable them.');
  const accessToken = env.EXPO_ACCESS_TOKEN?.trim();
  return { enabled: true, ...(accessToken ? { accessToken } : {}) };
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const errorCode = (value: Record<string, unknown>) => record(value.details) && typeof value.details.error === 'string' ? value.details.error : 'unknown';

export function expoPushProvider(options: { accessToken?: string; endpoints?: { send: string; receipts: string }; timeoutMs?: number; fetch?: typeof fetch } = {}): PushProvider {
  const endpoints = options.endpoints ?? EXPO_ENDPOINTS;
  const request = options.fetch ?? fetch;
  async function post(url: string, payload: unknown, signal: AbortSignal): Promise<{ data: unknown } | RequestFailure> {
    let response: Response;
    try {
      response = await request(url, { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? 10_000)]),
        headers: { accept: 'application/json', 'content-type': 'application/json', ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}) },
        body: JSON.stringify(payload) });
    } catch { return { kind: 'retry', reason: signal.aborted ? 'aborted' : 'network' }; }
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }
    const code = record(body) && Array.isArray(body.errors) && record(body.errors[0]) && typeof body.errors[0].code === 'string' ? body.errors[0].code : `http_${response.status}`;
    if (response.status === 429 || response.status >= 500) {
      const seconds = Number(response.headers.get('retry-after'));
      return { kind: 'retry', reason: code, ...(Number.isFinite(seconds) && seconds > 0 ? { retryAfterMs: seconds * 1000 } : {}) };
    }
    if (response.status !== 200) return { kind: 'reject', reason: code };
    if (!record(body) || body.data === undefined) return { kind: 'retry', reason: 'malformed' };
    return { data: body.data };
  }
  return {
    async send(messages, signal) {
      const result = await post(endpoints.send, messages, signal);
      if (!('data' in result)) return result;
      const data = Array.isArray(result.data) ? result.data : messages.length === 1 ? [result.data] : undefined;
      if (!data || data.length !== messages.length) return { kind: 'retry', reason: 'malformed' };
      return { kind: 'tickets', tickets: data.map((t): Ticket => !record(t) ? { status: 'malformed' }
        : t.status === 'ok' && typeof t.id === 'string' && t.id ? { status: 'ok', id: t.id }
        : t.status === 'error' ? { status: 'error', error: errorCode(t) } : { status: 'malformed' }) };
    },
    async receipts(ids, signal) {
      const result = await post(endpoints.receipts, { ids }, signal);
      if (!('data' in result)) return result;
      if (!record(result.data)) return { kind: 'retry', reason: 'malformed' };
      const receipts: Record<string, Receipt> = {};
      for (const id of ids) {
        const r = result.data[id];
        if (record(r) && r.status === 'ok') receipts[id] = { status: 'ok' };
        else if (record(r) && r.status === 'error') receipts[id] = { status: 'error', error: errorCode(r) };
      }
      return { kind: 'receipts', receipts };
    },
  };
}
