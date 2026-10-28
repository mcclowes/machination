import { api } from './network';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { CancelSchedule, RecoverSeat, RecoverySetup, InterceptOrder, ModuleOrder, Order, GiftOrder, ScheduleOrder, Snapshot, Transmission } from './protocol';
export type Pending = { kind: 'gifts'; body: GiftOrder } | { kind: 'recover'; body: RecoverSeat } | { kind: 'recovery'; body: RecoverySetup } | { kind: 'intercepts'; body: InterceptOrder } | { kind: 'schedules'; body: ScheduleOrder } | { kind: 'cancel-schedule'; body: CancelSchedule } | { kind: 'modules'; body: ModuleOrder } | { kind: 'orders'; body: Order } | { kind: 'messages'; body: Transmission };
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
  return { url: normalized.origin, token: await newCredential(), invite: invite?.trim() };
}
export async function connect(session: Session): Promise<{ session: Session; snapshot: Snapshot }> {
  const snapshot = session.id ? await api(session, `games/${session.id}`)
    : session.invite ? await api(session, 'join', { invite: session.invite }) : await api(session, 'games', {});
  const connected = { ...session, id: snapshot.id };
  await storeSession(connected);
  return { session: connected, snapshot };
}
export const commandId = () => Crypto.randomUUID();

export async function newCredential(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
