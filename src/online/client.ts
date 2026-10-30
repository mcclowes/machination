import { isPlayerColor, type PlayerColor } from '../game/player-colors';
import type { CouncilOrder, PulseOrder } from '../contracts/protocol';
import type { RequestSession } from './account-auth';
import { validateOptions, type GameOptions } from '../game/rules';
import type { ResignOrder, CreateGroup, ChannelTransmission } from '../contracts/protocol';
import type { FundingOrder } from '../contracts/protocol';
import { api, creationPayload } from './network';
import { AppState, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { EditSchedule, SpecialistOrder, HaulerOrder, SiteOrder, CancelSchedule, RecoverSeat, RecoverySetup, InterceptOrder, ModuleOrder, Order, GiftOrder, ScheduleOrder, Snapshot, Transmission } from '../contracts/protocol';
export type Pending = { kind: 'council'; body: CouncilOrder } | { kind: 'pulse'; body: PulseOrder } | { kind: 'edit-schedule'; body: EditSchedule } | { kind: 'resign'; body: ResignOrder } | { kind: 'funding'; body: FundingOrder } | { kind: 'groups'; body: CreateGroup } | { kind: 'channel-messages'; body: ChannelTransmission } | { kind: 'specialists'; body: SpecialistOrder } | { kind: 'haulers'; body: HaulerOrder } | { kind: 'sites'; body: SiteOrder } | { kind: 'gifts'; body: GiftOrder } | { kind: 'recover'; body: RecoverSeat } | { kind: 'recovery'; body: RecoverySetup } | { kind: 'intercepts'; body: InterceptOrder } | { kind: 'schedules'; body: ScheduleOrder } | { kind: 'cancel-schedule'; body: CancelSchedule } | { kind: 'modules'; body: ModuleOrder } | { kind: 'orders'; body: Order } | { kind: 'messages'; body: Transmission };
export type Session = RequestSession & { id?: string; invite?: string; preferredColor?: PlayerColor; variant?: 'faction'; options?: GameOptions; pending?: Pending };
const KEY = 'machination.online.v1';
function sessionKey(accountId?: string) {
  if (accountId && !/^user_[a-zA-Z0-9]+$/.test(accountId)) throw new Error('Invalid account identity.');
  return accountId ? `${KEY}.${accountId}` : KEY;
}
export async function storeSession(session: Session | null, accountId?: string) {
  const key = sessionKey(session?.accountId ?? accountId);
  const value = session ? JSON.stringify(session) : null;
  if (Platform.OS === 'web') {
    if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key);
  } else if (value) await SecureStore.setItemAsync(key, value);
  else await SecureStore.deleteItemAsync(key);
}
export async function restoreSession(accountId?: string): Promise<Session | null> {
  const key = sessionKey(accountId);
  const raw = Platform.OS === 'web' ? sessionStorage.getItem(key) : await SecureStore.getItemAsync(key);
  if (!raw) return null;
  const s = JSON.parse(raw) as Session;
  if (!s || typeof s.url !== 'string' || !/^[a-f0-9]{64}$/.test(s.token)) throw new Error('Saved connection is invalid.');
  if (s.accountId !== accountId) throw new Error('Saved connection belongs to another account.');
  if (s.preferredColor !== undefined && !isPlayerColor(s.preferredColor)) throw new Error('Saved player color is invalid.');
  if (s.options !== undefined) s.options = validateOptions(s.options);
  if (s.variant !== undefined && s.variant !== 'faction') throw new Error('Saved operation variant is invalid.');
  return s;
}
/** Whether this device holds a seat in an operation, without contacting the server. */
export async function hasStoredOperation(accountId?: string): Promise<boolean> {
  const stored = (accountId ? await restoreSession(accountId).catch(() => null) : null) ?? await restoreSession().catch(() => null);
  return !!stored?.id;
}
export async function newSession(url: string, invite?: string, options?: GameOptions, variant?: 'faction'): Promise<Session> {
  const normalized = new URL(url.trim());
  if (!['http:', 'https:'].includes(normalized.protocol) || normalized.username || normalized.password || normalized.search || normalized.hash || normalized.pathname !== '/') throw new Error('Use a server origin, such as https://belt.example.com.');
  if (normalized.protocol !== 'https:' && !['localhost', '127.0.0.1', '10.0.2.2'].includes(normalized.hostname)) throw new Error('Use HTTPS for remote operations.');
  if (normalized.origin.length > 250) throw new Error('Server address is too long.');
  if (invite && !/^[a-f0-9]{24}$/.test(invite.trim())) throw new Error('Invitation codes contain 24 lowercase letters and digits.');
  return { url: normalized.origin, token: await newCredential(), invite: invite?.trim(), ...(!invite && variant ? { variant } : {}), ...(!invite && options !== undefined ? { options: validateOptions(options) } : {}) };
}
export async function connect(session: Session): Promise<{ session: Session; snapshot: Snapshot }> {
  const snapshot = session.id ? await api(session, `games/${session.id}`)
    : session.invite ? await api(session, 'join', { invite: session.invite, ...(session.preferredColor ? { preferredColor: session.preferredColor } : {}) }) : await api(session, 'games', creationPayload(session.options, session.variant, session.preferredColor));
  const current = session.id && AppState.currentState === 'active' && snapshot.inactivity
    ? await api(session, `games/${snapshot.id}/activity`, {}) : snapshot;
  const connected = { ...session, id: snapshot.id };
  await storeSession(connected);
  return { session: connected, snapshot: current };
}
export const commandId = () => Crypto.randomUUID();

export async function newCredential(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function createGroup(session: Session, body: CreateGroup): Promise<Snapshot> {
  if (!session.id) throw new Error('Connect to an operation first.');
  return api(session, `games/${session.id}/groups`, body);
}
export async function sendChannelMessage(session: Session, body: ChannelTransmission): Promise<Snapshot> {
  if (!session.id) throw new Error('Connect to an operation first.');
  return api(session, `games/${session.id}/channel-messages`, body);
}

export { exportSharedReplay } from './shared-replay';
