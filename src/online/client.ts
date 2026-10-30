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
export type Session = RequestSession & { id?: string; invite?: string; requestId?: string; preferredColor?: PlayerColor; variant?: 'faction'; options?: GameOptions; pending?: Pending };
export const DEFAULT_GAME_SERVER = process.env.EXPO_PUBLIC_GAME_SERVER ?? 'http://localhost:8787';
const KEY = 'machination.online.v1';
const OPERATION_ID = /^[a-f0-9]{24}$/;
/** Device seats keep one slot. Account seats keep a draft slot for a creation in flight plus one slot per operation. */
function sessionKey(accountId?: string, id?: string) {
  if (accountId && !/^user_[a-zA-Z0-9]+$/.test(accountId)) throw new Error('Invalid account identity.');
  if (id !== undefined && !OPERATION_ID.test(id)) throw new Error('Invalid operation identity.');
  return accountId ? `${KEY}.${accountId}${id ? `.${id}` : ''}` : KEY;
}
async function readSlot(key: string): Promise<string | null> {
  return Platform.OS === 'web' ? sessionStorage.getItem(key) : SecureStore.getItemAsync(key);
}
async function writeSlot(key: string, value: string | null) {
  if (Platform.OS === 'web') {
    if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key);
  } else if (value) await SecureStore.setItemAsync(key, value);
  else await SecureStore.deleteItemAsync(key);
}
export async function storeSession(session: Session | null, accountId?: string, id?: string) {
  const owner = session?.accountId ?? accountId;
  const operation = owner ? (session ? session.id : id) : undefined;
  await writeSlot(sessionKey(owner, operation), session ? JSON.stringify(session) : null);
  if (!owner || !operation) return;
  // The draft that produced this operation (or an older single-slot save of it) is now redundant.
  const draft = await readSlot(sessionKey(owner)).catch(() => null);
  let draftId: string | undefined;
  try { draftId = draft ? (JSON.parse(draft) as Session).id : undefined; } catch { /* Damaged drafts are replaced. */ }
  if (draft && (session ? draftId === undefined || draftId === operation : draftId === operation)) await writeSlot(sessionKey(owner), null);
}
function parseSession(raw: string, accountId?: string): Session {
  const s = JSON.parse(raw) as Session;
  if (!s || typeof s.url !== 'string' || !/^[a-f0-9]{64}$/.test(s.token)) throw new Error('Saved connection is invalid.');
  if (s.accountId !== accountId) throw new Error('Saved connection belongs to another account.');
  if (s.id !== undefined && !OPERATION_ID.test(s.id)) throw new Error('Saved connection is invalid.');
  if (s.requestId !== undefined && !/^[A-Za-z0-9_-]{16,64}$/.test(s.requestId)) throw new Error('Saved connection is invalid.');
  if (s.preferredColor !== undefined && !isPlayerColor(s.preferredColor)) throw new Error('Saved player color is invalid.');
  if (s.options !== undefined) s.options = validateOptions(s.options);
  if (s.variant !== undefined && s.variant !== 'faction') throw new Error('Saved operation variant is invalid.');
  return s;
}
/** Without `id`, returns the device seat or the account's draft; with it, that operation's account slot. */
export async function restoreSession(accountId?: string, id?: string): Promise<Session | null> {
  const raw = await readSlot(sessionKey(accountId, accountId ? id : undefined));
  if (raw) return parseSession(raw, accountId);
  if (!accountId || !id) return null;
  const draft = await readSlot(sessionKey(accountId));
  const legacy = draft ? parseSession(draft, accountId) : null;
  return legacy?.id === id ? legacy : null;
}
/** Whether this device holds a device-token seat, without contacting the server. */
export async function hasStoredOperation(): Promise<boolean> {
  return !!(await restoreSession().catch(() => null))?.id;
}
export async function newSession(url: string, invite?: string, options?: GameOptions, variant?: 'faction'): Promise<Session> {
  const normalized = new URL(url.trim());
  if (!['http:', 'https:'].includes(normalized.protocol) || normalized.username || normalized.password || normalized.search || normalized.hash || normalized.pathname !== '/') throw new Error('Use a server origin, such as https://belt.example.com.');
  if (normalized.protocol !== 'https:' && !['localhost', '127.0.0.1', '10.0.2.2'].includes(normalized.hostname)) throw new Error('Use HTTPS for remote operations.');
  if (normalized.origin.length > 250) throw new Error('Server address is too long.');
  if (invite && !/^[a-f0-9]{24}$/.test(invite.trim())) throw new Error('Invitation codes contain 24 lowercase letters and digits.');
  return { url: normalized.origin, token: await newCredential(), invite: invite?.trim(), ...(!invite ? { requestId: commandId() } : {}), ...(!invite && variant ? { variant } : {}), ...(!invite && options !== undefined ? { options: validateOptions(options) } : {}) };
}
export async function connect(session: Session): Promise<{ session: Session; snapshot: Snapshot }> {
  const snapshot = session.id ? await api(session, `games/${session.id}`)
    : session.invite ? await api(session, 'join', { invite: session.invite, ...(session.preferredColor ? { preferredColor: session.preferredColor } : {}) }) : await api(session, 'games', creationPayload(session.options, session.variant, session.preferredColor, session.requestId));
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
