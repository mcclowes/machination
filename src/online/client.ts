import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { ModuleOrder, Order, Snapshot, Transmission } from './protocol';
export type Pending = { kind: 'modules'; body: ModuleOrder } | { kind: 'orders'; body: Order } | { kind: 'messages'; body: Transmission };
export type Session = { url: string; token: string; id?: string; invite?: string; pending?: Pending };
const KEY = 'machination.online.v1';
export async function storeSession(session: Session | null) {
  const value = session ? JSON.stringify(session) : null;
  if (Platform.OS === 'web') {
    if (value) sessionStorage.setItem(KEY, value); else sessionStorage.removeItem(KEY);
  } else if (value) await SecureStore.setItemAsync(KEY, value);
  else await SecureStore.deleteItemAsync(KEY);
}
export async function restoreSession(): Promise<Session | null> {
  const raw = Platform.OS === 'web' ? sessionStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  const s = JSON.parse(raw) as Session;
  if (!s || typeof s.url !== 'string' || !/^[a-f0-9]{64}$/.test(s.token)) throw new Error('Saved connection is invalid.');
  return s;
}
export async function newSession(url: string, invite?: string): Promise<Session> {
  const normalized = new URL(url.trim());
  if (!['http:', 'https:'].includes(normalized.protocol) || normalized.username || normalized.password || normalized.search || normalized.hash || normalized.pathname !== '/') throw new Error('Use a server origin, such as https://belt.example.com.');
  if (normalized.protocol !== 'https:' && !['localhost', '127.0.0.1', '10.0.2.2'].includes(normalized.hostname)) throw new Error('Use HTTPS for remote operations.');
  if (normalized.origin.length > 250) throw new Error('Server address is too long.');
  if (invite && !/^[a-f0-9]{24}$/.test(invite.trim())) throw new Error('Invitation codes contain 24 lowercase letters and digits.');
  const bytes = await Crypto.getRandomBytesAsync(32);
  return { url: normalized.origin, token: Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''), invite: invite?.trim() };
}
export class RejectedCommand extends Error { constructor(public status: number, message: string) { super(message); } }
export async function api(session: Session, path: string, payload?: unknown): Promise<Snapshot> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${session.url}/v1/${path}`, { method: payload === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload), signal: controller.signal });
    const data = await response.json();
    if (!response.ok) {
      const detail = data.issues?.[0]?.message?.detail ?? 'Command was not accepted.';
      if (response.status >= 400 && response.status < 500) throw new RejectedCommand(response.status, detail);
      throw new Error(detail);
    }
    if (!data || data.visibility !== 'sensors.v1' || typeof data.id !== 'string' || !data.game || !Array.isArray(data.messages) || !['you', 'vesper', 'null'].includes(data.faction)) throw new Error('Unsupported server response.');
    return data as Snapshot;
  } finally { clearTimeout(timer); }
}
export async function connect(session: Session): Promise<{ session: Session; snapshot: Snapshot }> {
  const snapshot = session.id ? await api(session, `games/${session.id}`)
    : session.invite ? await api(session, 'join', { invite: session.invite }) : await api(session, 'games', {});
  const connected = { ...session, id: snapshot.id };
  await storeSession(connected);
  return { session: connected, snapshot };
}
export const commandId = () => Crypto.randomUUID();
