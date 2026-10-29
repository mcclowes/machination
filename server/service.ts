/**
 * ---
 * purpose: Authorize multiplayer seats, settle server time, and orchestrate durable game and diplomacy commands.
 * ---
 */
import { generateSharedReplay, SharedReplayCapacityError } from '../src/replay/generate';
import { UnsupportedVisibilityNumericError } from '../src/replay/numeric-support';
import type { SharedReplay } from '../src/replay/timeline';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseStore, type Database, type Room } from './database';
import { createConfiguredGame } from '../src/game/world';
import { DEFAULT_GAME_OPTIONS, driftingBasesEnabled, validateOptions, type GameOptions } from '../src/game/rules';
import { ALL_PLAYERS, playersIn } from '../src/game/players';
import { DEFAULT_PORTRAITS } from '../src/game/characters';
import { advance, createGame, type Faction } from '../src/game/simulation';
import { type Specialist } from '../src/game/specialists';
import { isSpecialistKind } from '../src/game/specialist-catalog';
import type { HaulerChange } from '../src/game/transport';
import { mapActionFleets, mapActionUnits, plannedFleetIds, plannedUnitIds, validateFutureAction } from '../src/game/future-actions';
import { isScheduledLaunch, validateLaunchEdit } from '../src/game/orders';
import { observe } from '../src/game/visibility';
import { applyCommand, createArchive, exportArchive, replayTo, restoreArchive, type GameCommand } from '../src/game/replay';
import { INACTIVITY_HOURS, HOUR_MS } from '../src/game/retirement';
import { replayFits } from '../src/game/replay-save';
import type { HistorySnapshot } from '../src/online/protocol';
import type { FundingOrder } from '../src/online/protocol';
import { DIPLOMACY_LIMITS } from '../src/online/protocol';
import type { MessageNotificationSettings } from '../src/online/notification-contract';
import { claimReceipts, claimSends, detach, enqueue, EXPO_TOKEN, finishReceipts, finishSends, invalidateSeat, isCurrent, newBindingId, NOTIFICATION_LIMITS, release, evict, revisionFloor, seatGeneration, tokenHash, type ReceiptClaim, type ReceiptResult, type SendClaim, type SendResult } from './notifications';
import type { CreateGroup, ChannelTransmission, ResignOrder, EditSchedule, SpecialistOrder, HaulerOrder, SiteOrder, CancelSchedule, RecoverSeat, RecoverySetup, InterceptOrder, ModuleOrder, Order, GiftOrder, ScheduleOrder, Snapshot, Transmission } from '../src/online/protocol';
const FACTIONS = ALL_PLAYERS;
export type AccountCredential = { accountId: string };
type Credential = string | AccountCredential;
export class Failure extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
function requireThat(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new Failure(status, code, message);
}
const matchesHash = (expected: string | undefined, actual: string) => expected !== undefined && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
function canonicalSchedule(input: unknown): ScheduleOrder {
  const invalid = () => new Failure(400, 'schedule.validation.payload', 'Provide a supported future order.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const value = input as Record<string, unknown>;
  const action = Object.hasOwn(value, 'action');
  const required = ['requestId', 'revision', 'executeAt', ...(action ? ['action'] : ['from', 'to', 'drones'])];
  const allowed = [...required, ...(action ? [] : ['specialists', 'carryModule'])];
  if (!required.every(key => Object.hasOwn(value, key)) || Object.keys(value).some(key => !allowed.includes(key))
    || typeof value.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(value.requestId)
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0
    || typeof value.executeAt !== 'number' || !Number.isFinite(value.executeAt)) throw invalid();
  const base = { requestId: value.requestId, revision: value.revision as number, executeAt: value.executeAt };
  if (action) {
    try {
      const action = validateFutureAction(value.action);
      const manifest = 'specialists' in action && action.specialists !== undefined ? { specialists: [...action.specialists] } : {};
      if (action.type === 'gift') return { ...base, action: { type: 'gift', from: action.from, to: action.to, drones: action.drones, recipient: action.recipient,
        ...(action.carryModule !== undefined ? { carryModule: action.carryModule } : {}), ...manifest } };
      if (action.type === 'intercept') return { ...base, action: { type: 'intercept', from: action.from, target: action.target, drones: action.drones, ...manifest } };
      if (action.type === 'hauler') {
        const c = action.change;
        const change: HaulerChange = c.action === 'edit-launch' ? { action: c.action, fleet: c.fleet, drones: c.drones,
          ...(c.specialists !== undefined ? { specialists: [...c.specialists] } : {}) }
          : c.action === 'course' ? { action: c.action, fleet: c.fleet, to: c.to } : { action: c.action, fleet: c.fleet };
        return { ...base, action: { type: 'hauler', change } };
      }
      return { ...base, action };
    }
    catch { throw invalid(); }
  }
  if (typeof value.from !== 'string' || typeof value.to !== 'string' || !Number.isSafeInteger(value.drones)
    || value.carryModule !== undefined && typeof value.carryModule !== 'boolean'
    || value.specialists !== undefined && (!Array.isArray(value.specialists) || value.specialists.length > 10000
      || value.specialists.some(id => typeof id !== 'string') || new Set(value.specialists).size !== value.specialists.length)) throw invalid();
  return { ...base, from: value.from, to: value.to, drones: value.drones as number,
    ...(value.carryModule !== undefined ? { carryModule: value.carryModule as boolean } : {}),
    ...(value.specialists !== undefined ? { specialists: [...value.specialists as string[]] } : {}) };
}
export type ServiceOptions = { notifications?: boolean };
export type NotificationQueue = {
  claimSends(owner: string): Promise<SendClaim>;
  finishSends(lease: string, results: ReadonlyMap<string, SendResult>): Promise<void>;
  claimReceipts(owner: string): Promise<ReceiptClaim>;
  finishReceipts(lease: string, results: ReadonlyMap<string, ReceiptResult>): Promise<void>;
  release(lease: string): Promise<void>;
};
const SETTING_KEYS = ['requestId', 'deviceId', 'revision', 'enabled', 'expoPushToken'];
function canonicalNotificationSetting(input: unknown) {
  const invalid = () => new Failure(400, 'notification.validation.payload', 'Provide a device, revision, request ID, and a valid push token only when enabling.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !SETTING_KEYS.includes(key)) || !['requestId', 'deviceId', 'revision', 'enabled'].every(key => Object.hasOwn(value, key))
    || typeof value.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(value.requestId)
    || typeof value.deviceId !== 'string' || !/^[a-f0-9]{64}$/.test(value.deviceId)
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || typeof value.enabled !== 'boolean'
    || (value.enabled ? typeof value.expoPushToken !== 'string' || !EXPO_TOKEN.test(value.expoPushToken) : Object.hasOwn(value, 'expoPushToken'))) throw invalid();
  return { requestId: value.requestId, deviceId: value.deviceId, revision: value.revision as number, enabled: value.enabled,
    ...(value.enabled ? { expoPushToken: value.expoPushToken as string } : {}) };
}
export class GameService {
  private constructor(private store: DatabaseStore, private now: () => number, private initialGame?: typeof createGame, private pushAvailable = false) {}
  static async open(file: string, now = Date.now, initialGame?: typeof createGame, options: ServiceOptions = {}): Promise<GameService> {
    return new GameService(await DatabaseStore.open(file), now, initialGame, !!options.notifications);
  }
  private transaction<T>(run: (db: Database) => T): Promise<T> {
    return this.store.transaction(run);
  }
  private credential(token: Credential): string {
    if (typeof token !== 'string') {
      requireThat(/^user_[a-zA-Z0-9]+$/.test(token.accountId), 401, 'account.unauthorized.identity', 'A valid account is required.');
      return hash(`clerk:${token.accountId}`);
    }
    requireThat(/^[a-f0-9]{64}$/.test(token), 401, 'seat.unauthorized.token', 'A valid seat token is required.');
    return hash(token);
  }
  private matchesCredential(seat: Room['seats'][number], token: Credential): boolean {
    const credential = this.credential(token);
    return typeof token === 'string' ? !seat.accountId && seat.hash === credential : seat.accountId === token.accountId;
  }
  private room(db: Database, id: string): Room {
    const room = db.rooms.find(r => r.id === id);
    requireThat(room, 404, 'game.not_found', 'Operation not found.');
    return room;
  }
  private seat(room: Room, token: Credential): Faction {
    const seat = room.seats.find(s => this.matchesCredential(s, token));
    requireThat(seat, 401, 'seat.unauthorized.token', 'This token does not control a seat in this operation.');
    return seat.faction;
  }
  private settle(room: Room) {
    if (room.startedAt !== null) {
      room.replay ??= exportArchive(createArchive(room.game));
      const target = Math.max(room.game.hour, (this.now() - room.startedAt) / HOUR_MS);
      while (room.game.version === 2 && !room.game.winner && !room.game.draw) {
        const active = room.seats.filter(s => !room.game.eliminated.includes(s.faction) && s.lastActiveHour !== undefined);
        const deadline = Math.min(...active.map(s => s.lastActiveHour! + INACTIVITY_HOURS));
        if (deadline > target) break;
        room.game = advance(room.game, Math.max(room.game.hour, deadline), { rivals: false });
        if (room.game.winner || room.game.draw) break;
        const owners = active.filter(s => !room.game.eliminated.includes(s.faction) && s.lastActiveHour! + INACTIVITY_HOURS <= deadline).map(s => s.faction);
        if (owners.length) this.act(room, { type: 'inactivity', owners });
      }
      room.game = advance(room.game, target, { rivals: false });
      if (room.game.version === 2) for (const seat of room.seats) seat.lastActiveHour ??= room.game.hour;
    }
  }
  private act(room: Room, command: GameCommand): void {
    const result = applyCommand(room.replay ? restoreArchive(room.replay) : createArchive(room.game), command, { rivals: false, knownThrough: room.game.hour });
    const data = exportArchive(result.archive);
    requireThat(replayFits(data, command.type === 'inactivity'), 409, 'history.capacity.reached', 'This operation has reached its command history limit.');
    room.game = result.game; room.replay = data;
    if (command.type !== 'inactivity') this.touch(room, command.owner);
  }
  private touch(room: Room, faction: Faction): void {
    if (room.startedAt !== null && room.game.version === 2 && !room.game.winner && !room.game.draw && !room.game.eliminated.includes(faction)) room.seats.find(s => s.faction === faction)!.lastActiveHour = room.game.hour;
  }
  private revision(room: Room, faction: Faction): number { return room.seats.find(s => s.faction === faction)!.revision ?? 0; }
  private reviseOrders(room: Room, owners: readonly Faction[]): void {
    room.revision++;
    for (const seat of room.seats) if (owners.includes(seat.faction)) seat.revision = (seat.revision ?? 0) + 1;
  }
  private identify(room: Room, faction: Faction, kind: 'hauler' | 'message' | 'unit', id: number | string): number {
    const seat = room.seats.find(s => s.faction === faction)!;
    const key = seat.identityHash ?? seat.hash;
    return createHmac('sha256', key).update(`${kind}:${id}`).digest().readUIntBE(0, 6);
  }
  private observation(room: Room, faction: Faction, source = room.game) {
    const canonical = new Map<number, number>();
    const game = observe(source, faction, id => {
      const alias = this.identify(room, faction, 'hauler', id);
      canonical.set(alias, id);
      return alias;
    }, id => String(this.identify(room, faction, 'unit', id)));
    const reference = (kind: 'outpost' | 'hauler', id: string | number) =>
      createHmac('sha256', Buffer.from(room.referenceKey!, 'hex'))
        .update(JSON.stringify(['machination.object-reference', 1, room.id, kind, id])).digest('hex');
    return { game, references: { version: 1 as const,
      outposts: game.rocks.map(r => ({ id: r.id, ref: reference('outpost', r.id) })),
      haulers: game.fleets.map(f => ({ id: f.id, ref: reference('hauler', canonical.get(f.id)!) })),
    } };
  }
  private view(room: Room, faction: Faction): Snapshot {
    return { id: room.id, invite: room.invite, status: room.startedAt === null ? 'game.lobby' : room.game.winner || room.game.draw ? 'game.finished' : 'game.active',
      faction, host: faction === 'you', members: room.seats.map(s => s.faction), revision: this.revision(room, faction),
      groups: (room.diplomacy?.groups ?? []).filter(g => g.members.includes(faction)).map(({ messages, ...g }) => g),
      channels: [{ id: 'public', kind: 'public', messages: room.diplomacy?.publicMessages ?? [] },
        ...(room.diplomacy?.groups ?? []).filter(g => g.members.includes(faction)).map(g => ({ id: g.id, kind: 'private' as const, messages: g.messages }))],
      recoveryEnabled: !!room.seats.find(s => s.faction === faction)!.recoveryHash,
      ...(room.startedAt !== null && room.game.version === 2 && !room.game.winner && !room.game.draw && !room.game.eliminated.includes(faction) && room.seats.find(s => s.faction === faction)!.lastActiveHour !== undefined ? { inactivity: { expiresAt: room.startedAt + (room.seats.find(s => s.faction === faction)!.lastActiveHour! + INACTIVITY_HOURS) * HOUR_MS } } : {}),
      ...(room.replay ? { history: { from: room.replay.baseline.hour, through: room.game.hour } } : {}),
      visibility: 'sensors.v1', ...this.observation(room, faction), messages: room.messages.filter(m => m.from === faction || m.to === faction).map(m => ({ ...m, id: this.identify(room, faction, 'message', m.id) })), serverTime: this.now() };
  }
  accountSession(account: AccountCredential): Promise<Snapshot | null> {
    return this.transaction(db => {
      this.credential(account);
      const room = db.rooms.find(r => r.seats.some(s => this.matchesCredential(s, account)));
      if (!room) return null;
      this.settle(room); return this.view(room, this.seat(room, account));
    });
  }
  linkAccount(id: string, token: string, account: AccountCredential): Promise<Snapshot> {
    return this.transaction(db => {
      this.credential(account);
      const room = this.room(db, id);
      const seat = room.seats.find(s => s.hash === this.credential(token));
      requireThat(seat, 401, 'seat.unauthorized.token', 'The existing seat credential is required.');
      requireThat(!seat.accountId || seat.accountId === account.accountId, 409, 'account.conflict.owner', 'This seat belongs to another account.');
      requireThat(!db.rooms.some(r => r.seats.some(s => s !== seat && s.accountId === account.accountId)), 409, 'account.conflict.assigned', 'Your account already controls another operation.');
      seat.accountId = account.accountId;
      delete seat.recoveryHash; delete seat.recoveryReceipt;
      invalidateSeat(db, room.id, seat.faction);
      this.settle(room); return this.view(room, seat.faction);
    });
  }
  create(token: Credential, options?: unknown): Promise<Snapshot> {
    let requested: GameOptions | undefined;
    try { requested = options === undefined ? undefined : validateOptions(options); }
    catch (e) { return Promise.reject(new Failure(400, 'game.validation.options', (e as Error).message)); }
    return this.transaction(db => {
      const credential = this.credential(token);
      const existing = db.rooms.find(r => r.seats.some(s => this.matchesCredential(s, token)));
      if (existing) {
        requireThat(!requested || requested.playerCount === playersIn(existing.game).length && requested.mode === (existing.game.rules?.mode ?? 'mining') && !!requested.driftingBases === driftingBasesEnabled(existing.game) && JSON.stringify(requested.portraits ?? DEFAULT_PORTRAITS.slice(0, requested.playerCount)) === JSON.stringify(existing.game.rules?.portraits ?? DEFAULT_PORTRAITS.slice(0, playersIn(existing.game).length)), 409, 'game.conflict.options', 'This credential already belongs to an operation with different settings.');
        this.settle(existing); return this.view(existing, this.seat(existing, token));
      }
      requireThat(db.rooms.length < 1000, 503, 'game.capacity.reached', 'This server has reached its operation limit.');
      const room: Room = { id: randomBytes(12).toString('hex'), invite: randomBytes(12).toString('hex'), startedAt: null,
        referenceKey: randomBytes(32).toString('hex'), revision: 0, game: this.initialGame && !requested ? this.initialGame(this.now(), Object.fromEntries(FACTIONS.map(f => [f, randomBytes(4).readUInt32BE()]))) : createConfiguredGame(requested ?? DEFAULT_GAME_OPTIONS, this.now(), randomBytes(4).readUInt32BE(), Object.fromEntries(FACTIONS.map(f => [f, randomBytes(4).readUInt32BE()]))), seats: [{ faction: 'you', hash: credential, ...(typeof token !== 'string' ? token : {}) }], messages: [], receipts: {} };
      db.rooms.push(room);
      return this.view(room, 'you');
    });
  }
  join(invite: string, token: Credential): Promise<Snapshot> {
    return this.transaction(db => {
      const credential = this.credential(token);
      const room = db.rooms.find(r => r.invite === invite);
      requireThat(room, 404, 'game.not_found.invite', 'Invitation not found.');
      const existing = room.seats.find(s => this.matchesCredential(s, token));
      if (existing) { this.settle(room); return this.view(room, existing.faction); }
      requireThat(!db.rooms.some(r => r.seats.some(s => this.matchesCredential(s, token))), 409, 'seat.conflict.assigned', 'This token already belongs to another operation.');
      requireThat(room.startedAt === null && room.seats.length < playersIn(room.game).length, 409, 'game.conflict.closed', 'This operation is no longer accepting players.');
      const faction = playersIn(room.game)[room.seats.length]!;
      room.seats.push({ faction, hash: credential, ...(typeof token !== 'string' ? token : {}) }); room.revision++;
      return this.view(room, faction);
    });
  }
  setRecovery(id: string, token: Credential, command: RecoverySetup): Promise<Snapshot> {
    return this.transaction(db => {
      requireThat(typeof token === 'string', 409, 'recovery.conflict.account', 'Sign in to restore an account seat.');
      const room = this.room(db, id); const faction = this.seat(room, token); this.settle(room);
      requireThat(typeof command.secret === 'string' && /^[a-f0-9]{64}$/.test(command.secret), 400, 'recovery.validation.secret', 'Provide a valid recovery secret.');
      const secretHash = hash(command.secret); const seat = room.seats.find(s => s.faction === faction)!;
      const prior = this.receipt(room, faction, command.requestId, JSON.stringify(['recovery', secretHash]));
      if (prior) {
        requireThat(seat.recoveryHash === secretHash, 409, 'recovery.conflict.superseded', 'This recovery code was replaced or consumed. Generate a new code.');
        return this.view(room, faction);
      }
      requireThat(!db.rooms.some(r => r.seats.some(s => (s !== seat && s.recoveryHash === secretHash) || s.recoveryReceipt?.secretHash === secretHash)), 409, 'recovery.conflict.used', 'Generate a new recovery code.');
      seat.recoveryHash = secretHash;
      return this.view(room, faction);
    });
  }
  recover(id: string, token: Credential, command: RecoverSeat): Promise<Snapshot> {
    return this.transaction(db => {
      requireThat(typeof token === 'string', 409, 'recovery.conflict.account', 'Restore a device seat before linking it to your account.');
      const credential = this.credential(token);
      requireThat(typeof command.secret === 'string' && /^[a-f0-9]{64}$/.test(command.secret), 401, 'recovery.unauthorized.code', 'Recovery code is invalid, replaced, or already used.');
      const secretHash = hash(command.secret); const room = db.rooms.find(r => r.id === id);
      const seat = room?.seats.find(s => !s.accountId && (matchesHash(s.recoveryHash, secretHash) || matchesHash(s.recoveryReceipt?.secretHash, secretHash) && s.recoveryReceipt?.credentialHash === credential && s.hash === credential));
      requireThat(room && seat, 401, 'recovery.unauthorized.code', 'Recovery code is invalid, replaced, or already used.');
      if (seat.recoveryReceipt?.secretHash === secretHash && seat.hash === credential) { this.settle(room); return this.view(room, seat.faction); }
      requireThat(credential !== seat.hash && !db.rooms.some(r => r.seats.some(s => this.matchesCredential(s, token))), 409, 'recovery.conflict.credential', 'Restore with a fresh connection credential.');
      seat.identityHash ??= seat.hash;
      seat.hash = credential; delete seat.recoveryHash;
      seat.recoveryReceipt = { secretHash, credentialHash: credential };
      invalidateSeat(db, room.id, seat.faction);
      this.settle(room); return this.view(room, seat.faction);
    });
  }
  snapshot(id: string, token: Credential): Promise<Snapshot> {
    return this.transaction(db => { const r = this.room(db, id); const f = this.seat(r, token); this.settle(r); return this.view(r, f); });
  }
  async sharedReplay(id: string, token: Credential, from: number, through: number): Promise<SharedReplay> {
    requireThat(Number.isFinite(from) && Number.isFinite(through) && from >= 0 && through >= from,
      400, 'replay.validation.bounds', 'Choose a finite, ordered historical interval.');
    const frozen = await this.transaction(db => {
      const room = this.room(db, id); const perspective = this.seat(room, token);
      this.settle(room);
      requireThat(room.startedAt !== null && room.replay, 409, 'replay.conflict.lobby', 'Replay history begins when the operation starts.');
      // Return validation failures as data so normal engine settling still persists.
      if (from < room.replay.baseline.hour || through > room.game.hour) return null;
      return { game: room.game, replay: room.replay, perspective };
    });
    requireThat(frozen, 400, 'replay.validation.bounds', 'Choose an interval within the available operation history.');
    try {
      return generateSharedReplay({ game: frozen.game, archive: restoreArchive(frozen.replay) }, frozen.perspective, from, through);
    } catch (error) {
      if (error instanceof SharedReplayCapacityError) throw new Failure(413, error.code, 'This observed timeline is too large. Choose a shorter interval.');
      if (error instanceof UnsupportedVisibilityNumericError) throw new Failure(422, error.code, 'This server cannot safely export the requested visibility timeline.');
      throw error;
    }
  }
  history(id: string, token: Credential, hour: number): Promise<HistorySnapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      requireThat(r.replay, 409, 'history.conflict.lobby', 'History begins when the operation starts.');
      requireThat(Number.isFinite(hour) && hour >= r.replay.baseline.hour && hour <= r.game.hour, 400, 'history.validation.hour', 'Choose a time within the available operation history.');
      const game = replayTo(restoreArchive(r.replay), hour, { rivals: false, knownThrough: r.game.hour });
      return { id: r.id, faction: f, visibility: 'sensors.v1', history: { from: r.replay.baseline.hour, through: r.game.hour, at: hour },
        ...this.observation(r, f, game) };
    });
  }
  activity(id: string, token: Credential): Promise<Snapshot> {
    return this.transaction(db => { const r = this.room(db, id); const f = this.seat(r, token); this.settle(r); this.touch(r, f); return this.view(r, f); });
  }
  resign(id: string, token: Credential, command: ResignOrder): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      if (this.receipt(r, f, command.requestId, JSON.stringify(['resign', command.revision]))) return this.view(r, f);
      requireThat(r.startedAt !== null, 409, 'game.conflict.lobby', 'The operation has not started.');
      requireThat(Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f), 409, 'resign.conflict.stale', 'Your orders changed. Refresh before resigning.');
      try { this.act(r, { type: 'resign', owner: f }); }
      catch (e) { throw new Failure(409, 'resign.conflict.invalid', (e as Error).message); }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  start(id: string, token: Credential): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token);
      requireThat(f === 'you', 403, 'game.forbidden.host', 'Only the host can start the operation.');
      requireThat(r.seats.length === playersIn(r.game).length, 409, 'game.conflict.seats', `Wait for all ${playersIn(r.game).length} intelligences to join.`);
      if (r.startedAt === null) { r.startedAt = this.now(); r.game.epoch = r.startedAt; if (r.game.version === 2) for (const seat of r.seats) seat.lastActiveHour = r.game.hour; this.reviseOrders(r, [f]); }
      this.settle(r); return this.view(r, f);
    });
  }
  private receipt(room: Room, faction: Faction, requestId: string, payload: string): boolean {
    requireThat(typeof requestId === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(requestId), 400, 'command.validation.request_id', 'Provide a unique command ID.');
    const key = `${faction}:${requestId}`;
    const prior = room.receipts[key];
    requireThat(!prior || prior === payload, 409, 'command.conflict.reused_id', 'This command ID was used for different content.');
    if (prior) return true;
    requireThat(Object.keys(room.receipts).length < 10000, 409, 'command.capacity.reached', 'This operation has reached its command limit.');
    room.receipts[key] = payload;
    return false;
  }
  private manifest(room: Room, owner: Faction, from: string, ids?: string[], carried: Specialist[] = []): string[] {
    if (ids === undefined) return [];
    requireThat(Array.isArray(ids) && ids.length <= 10000 && ids.every(id => typeof id === 'string') && new Set(ids).size === ids.length, 400, 'module.validation.manifest', 'Choose each module once.');
    const available = [...(room.game.rocks.find(r => r.id === from && r.owner === owner)?.specialists ?? []), ...carried];
    return ids.map(id => {
      const unit = available.find(u => u.owner === owner && !u.captive && String(this.identify(room, owner, 'unit', u.id)) === id);
      requireThat(unit, 409, 'module.conflict.unavailable', 'A selected module is no longer at the departure site.');
      return unit.id;
    });
  }
  private futureUnit(room: Room, owner: Faction, id: string, ownedOnly = false): string {
    const visible = observe(room.game, owner);
    const available = [...visible.rocks, ...visible.fleets].flatMap(asset => asset.specialists ?? [])
      .filter(unit => !ownedOnly || unit.owner === owner).map(unit => unit.id);
    const canonical = [...available, ...plannedUnitIds(room.game, owner)]
      .find(unit => String(this.identify(room, owner, 'unit', unit)) === id);
    requireThat(canonical, 409, 'schedule.conflict.unit', 'Choose a currently observed module or one of your planned recruits.');
    return canonical;
  }
  private futureFleet(room: Room, owner: Faction, alias: number, enemy: boolean): number {
    const available = enemy
      ? observe(room.game, owner).fleets.filter(fleet => fleet.owner !== owner).map(fleet => fleet.id)
      : [...room.game.fleets.filter(fleet => fleet.owner === owner).map(fleet => fleet.id), ...plannedFleetIds(room.game, owner)];
    const canonical = available.find(id => this.identify(room, owner, 'hauler', id) === alias);
    requireThat(canonical !== undefined, 409, 'schedule.conflict.fleet', enemy
      ? 'Choose a currently observed enemy hauler.' : 'Choose one of your haulers or queued launches.');
    return canonical;
  }
  specialist(id: string, token: Credential, command: SpecialistOrder): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      const payload = JSON.stringify(['specialist', command.action, command.action === 'hire' ? command.kind : command.unit, command.revision]);
      if (this.receipt(r, f, command.requestId, payload)) return this.view(r, f);
      requireThat(r.startedAt !== null, 409, 'game.conflict.lobby', 'The operation has not started.');
      requireThat(Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f), 409, 'module.conflict.stale', 'Your orders changed. Refresh before managing modules.');
      try {
        if (command.action === 'hire') {
          if (!isSpecialistKind(command.kind)) throw new Error('Choose a recruitment offer.');
          this.act(r, { type: 'hire', owner: f, kind: command.kind });
        } else {
          const unit = r.game.rocks.filter(rock => rock.owner === f).flatMap(rock => rock.specialists ?? []).find(u => String(this.identify(r, f, 'unit', u.id)) === command.unit);
          if (!unit) throw new Error('Choose a module at a controlled site.');
          if (command.action === 'promote') this.act(r, { type: 'promote', owner: f, id: unit.id });
          else if (command.action === 'release') this.act(r, { type: 'release', owner: f, id: unit.id });
          else throw new Error('Unknown module command.');
        }
      } catch (e) { throw new Failure(409, 'module.conflict.invalid', (e as Error).message); }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  order(id: string, token: Credential, order: Order): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      if (this.receipt(r, f, order.requestId, JSON.stringify(['order', order.from, order.to, order.drones, order.revision, ...(order.carryModule === undefined || order.carryModule === false ? [] : [order.carryModule]), ...(order.specialists?.length ? [order.specialists] : [])]))) return this.view(r, f);
      requireThat(r.startedAt !== null, 409, 'game.conflict.lobby', 'The operation has not started.');
      requireThat(Number.isSafeInteger(order.revision) && order.revision === this.revision(r, f), 409, 'order.conflict.stale', 'The operation changed. Refresh before issuing this order.');
      try { this.act(r, { type: 'dispatch', owner: f, from: order.from, to: order.to, drones: order.drones, carryModule: order.carryModule, specialists: this.manifest(r, f, order.from, order.specialists) }); }
      catch (e) { throw new Failure(409, 'order.conflict.invalid', (e as Error).message); }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  gift(id: string, token: Credential, command: GiftOrder): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      if (this.receipt(r, f, command.requestId, JSON.stringify(['gift', command.from, command.to, command.drones, command.recipient, command.revision, command.carryModule ?? false, ...(command.specialists?.length ? [command.specialists] : [])]))) return this.view(r, f);
      requireThat(r.startedAt !== null, 409, 'game.conflict.lobby', 'The operation has not started.');
      requireThat(Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f), 409, 'gift.conflict.stale', 'Your orders changed. Refresh before gifting.');
      try { this.act(r, { type: 'gift', owner: f, from: command.from, to: command.to, drones: command.drones, recipient: command.recipient, carryModule: command.carryModule, specialists: this.manifest(r, f, command.from, command.specialists) }); }
      catch (e) { throw new Failure(409, 'gift.conflict.invalid', (e as Error).message); }
      this.reviseOrders(r, r.game.version === 1 ? [f, command.recipient] : [f]);
      return this.view(r, f);
    });
  }
  install(id: string, token: Credential, command: ModuleOrder): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      if (this.receipt(r, f, command.requestId, JSON.stringify(['module', command.rock, command.module, command.revision]))) return this.view(r, f);
      requireThat(r.startedAt !== null, 409, 'game.conflict.lobby', 'The operation has not started.');
      requireThat(Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f), 409, 'module.conflict.stale', 'The operation changed. Refresh before building a module.');
      try { this.act(r, { type: 'install-module', owner: f, rock: command.rock, kind: command.module }); }
      catch (e) { throw new Failure(409, 'module.conflict.invalid', (e as Error).message); }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  hauler(id: string, token: Credential, command: HaulerOrder): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      const payload = JSON.stringify(['hauler', command.fleet, command.action, command.action === 'edit-launch' ? command.drones : null, command.revision, ...(command.action === 'course' ? [command.to] : []), ...(command.action === 'edit-launch' && command.specialists?.length ? [command.specialists] : [])]);
      if (this.receipt(r, f, command.requestId, payload)) return this.view(r, f);
      requireThat(r.startedAt !== null, 409, 'game.conflict.lobby', 'The operation has not started.');
      requireThat(Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f), 409, 'hauler.conflict.stale', 'Your orders changed. Refresh before changing this hauler.');
      const fleet = r.game.fleets.find(fleet => fleet.owner === f && this.identify(r, f, 'hauler', fleet.id) === command.fleet);
      requireThat(fleet, 409, 'hauler.conflict.target', 'Choose one of your haulers.');
      try {
        const change: HaulerChange = command.action === 'edit-launch'
          ? { action: 'edit-launch', fleet: fleet.id, drones: command.drones, ...(command.specialists !== undefined ? { specialists: this.manifest(r, f, fleet.from, command.specialists, fleet.specialists) } : {}) }
          : command.action === 'course' ? { action: 'course', fleet: fleet.id, to: command.to } : { action: command.action, fleet: fleet.id };
        this.act(r, { type: 'hauler', owner: f, change });
      }
      catch (e) { throw new Failure(409, 'hauler.conflict.invalid', (e as Error).message); }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  site(id: string, token: Credential, command: SiteOrder): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      const payload = JSON.stringify(['site', command.rock, command.action, command.action === 'shields' ? command.disabled : null, command.revision]);
      if (this.receipt(r, f, command.requestId, payload)) return this.view(r, f);
      requireThat(r.startedAt !== null, 409, 'game.conflict.lobby', 'The operation has not started.');
      requireThat(Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f), 409, 'site.conflict.stale', 'Your orders changed. Refresh before changing this site.');
      try {
        if (command.action === 'mine') this.act(r, { type: 'drill-mine', owner: f, rock: command.rock });
        else if (command.action === 'shields') this.act(r, { type: 'shields', owner: f, rock: command.rock, disabled: command.disabled });
        else throw new Error('Choose a mine or shield command.');
      } catch (e) { throw new Failure(409, 'site.conflict.invalid', (e as Error).message); }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  intercept(id: string, token: Credential, command: InterceptOrder): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      if (this.receipt(r, f, command.requestId, JSON.stringify(['intercept', command.from, command.target, command.drones, command.revision, ...(command.specialists?.length ? [command.specialists] : [])]))) return this.view(r, f);
      requireThat(r.startedAt !== null, 409, 'game.conflict.lobby', 'The operation has not started.');
      requireThat(Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f), 409, 'interception.conflict.stale', 'Your orders changed. Refresh before intercepting.');
      const visible = observe(r.game, f, fleetId => this.identify(r, f, 'hauler', fleetId));
      const contact = visible.fleets.find(fleet => fleet.id === command.target && fleet.owner !== f);
      requireThat(contact, 409, 'interception.conflict.target', 'Target is not an observed enemy hauler.');
      const target = r.game.fleets.find(fleet => this.identify(r, f, 'hauler', fleet.id) === contact.id)!;
      try { this.act(r, { type: 'intercept', owner: f, from: command.from, target: target.id, drones: command.drones, specialists: command.specialists === undefined ? undefined : this.manifest(r, f, command.from, command.specialists) }); }
      catch (e) { throw new Failure(409, 'interception.conflict.invalid', (e as Error).message); }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  async schedule(id: string, token: Credential, input: ScheduleOrder): Promise<Snapshot> {
    const command = canonicalSchedule(input);
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      const payload = 'action' in command
        ? JSON.stringify(['schedule-action', command.action, command.revision, command.executeAt])
        : JSON.stringify(['schedule', command.from, command.to, command.drones, command.revision, command.executeAt, command.carryModule ?? false, ...(command.specialists?.length ? [command.specialists] : [])]);
      if (this.receipt(r, f, command.requestId, payload)) return this.view(r, f);
      requireThat(r.startedAt !== null, 409, 'game.conflict.lobby', 'The operation has not started.');
      requireThat(Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f), 409, 'schedule.conflict.stale', 'Your orders changed. Refresh before scheduling.');
      try {
        if ('action' in command) this.act(r, { type: 'schedule-action', owner: f, plan: {
          id: command.requestId, executeAt: command.executeAt,
          action: mapActionFleets(mapActionUnits(command.action, unit => this.futureUnit(r, f, unit,
            command.action.type !== 'promote' && command.action.type !== 'release')),
            fleet => this.futureFleet(r, f, fleet, command.action.type === 'intercept')),
        } });
        else this.act(r, { type: 'schedule', owner: f, plan: { id: command.requestId, from: command.from, to: command.to, drones: command.drones, executeAt: command.executeAt, carryModule: command.carryModule,
          specialists: command.specialists?.map(unit => this.futureUnit(r, f, unit, true)) ?? [] } });
      }
      catch (e) { throw new Failure(409, 'schedule.conflict.invalid', (e as Error).message); }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  async editSchedule(id: string, token: Credential, input: EditSchedule): Promise<Snapshot> {
    const invalid = () => new Failure(400, 'schedule.validation.payload', 'Provide a queued launch manifest edit.');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
    const value = input as unknown as Record<string, unknown>;
    if (Object.keys(value).some(key => !['requestId', 'revision', 'planId', 'drones', 'specialists'].includes(key))
      || !Object.hasOwn(value, 'requestId') || !Object.hasOwn(value, 'revision')
      || typeof value.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(value.requestId)
      || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) throw invalid();
    let change;
    try {
      change = validateLaunchEdit({ planId: value.planId, drones: value.drones,
        ...(Object.hasOwn(value, 'specialists') ? { specialists: value.specialists } : {}) });
    } catch { throw invalid(); }
    const command = { requestId: value.requestId, revision: value.revision as number, ...change };
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      const payload = JSON.stringify(['edit-schedule', command.revision, command.planId, command.drones,
        ...(command.specialists === undefined ? [] : [command.specialists])]);
      if (this.receipt(r, f, command.requestId, payload)) return this.view(r, f);
      requireThat(r.startedAt !== null, 409, 'game.conflict.lobby', 'The operation has not started.');
      requireThat(command.revision === this.revision(r, f), 409, 'schedule.conflict.stale', 'Your orders changed. Refresh before editing.');
      const plan = r.game.scheduled?.find(plan => plan.id === command.planId && plan.owner === f && isScheduledLaunch(plan));
      requireThat(plan, 409, 'schedule.conflict.missing', 'Choose one of your queued launches.');
      const prior = 'action' in plan ? plan.action : plan;
      const existingUnits = 'specialists' in prior ? prior.specialists ?? [] : [];
      try {
        this.act(r, { type: 'edit-schedule', owner: f, change: { planId: command.planId, drones: command.drones,
          ...(command.specialists === undefined ? {} : { specialists: command.specialists.map(alias => existingUnits.find(unit => String(this.identify(r, f, 'unit', unit)) === alias) ?? this.futureUnit(r, f, alias, true)) }) } });
      } catch (error) { throw new Failure(409, 'schedule.conflict.invalid', (error as Error).message); }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  cancelSchedule(id: string, token: Credential, command: CancelSchedule): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      if (this.receipt(r, f, command.requestId, JSON.stringify(['cancel-schedule', command.planId, command.revision]))) return this.view(r, f);
      requireThat(Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f), 409, 'schedule.conflict.stale', 'Your orders changed. Refresh before canceling.');
      try { this.act(r, { type: 'cancel-schedule', owner: f, id: command.planId }); }
      catch (e) { throw new Failure(409, 'schedule.conflict.missing', (e as Error).message); }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  funding(id: string, token: Credential, command: FundingOrder): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      if (this.receipt(r, f, command.requestId, JSON.stringify(['funding', command.recipient, command.enabled, command.revision]))) return this.view(r, f);
      requireThat(r.startedAt !== null, 409, 'game.conflict.lobby', 'The operation has not started.');
      requireThat(Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f), 409, 'funding.conflict.stale', 'Your orders changed. Refresh before changing funding.');
      requireThat(r.seats.some(s => s.faction === command.recipient), 400, 'funding.validation.recipient', 'Choose a joined intelligence.');
      try { this.act(r, { type: 'funding', owner: f, to: command.recipient, enabled: command.enabled }); }
      catch (e) { throw new Failure(409, 'funding.conflict.invalid', (e as Error).message); }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  createGroup(id: string, token: Credential, command: CreateGroup): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      requireThat(typeof command.name === 'string' && command.name.trim().length > 0 && command.name.length <= DIPLOMACY_LIMITS.name,
        400, 'group.validation.name', 'Group names must contain 1 to 60 characters.');
      requireThat(Array.isArray(command.members) && command.members.length >= 2 && command.members.length <= r.seats.length
        && new Set(command.members).size === command.members.length && command.members.includes(f)
        && command.members.every(member => r.seats.some(s => s.faction === member)),
        400, 'group.validation.members', 'Choose fixed members, including yourself and at least one other seat.');
      const members = FACTIONS.filter(member => command.members.includes(member));
      if (this.receipt(r, f, command.requestId, JSON.stringify(['group', command.name, members]))) return this.view(r, f);
      const d = r.diplomacy ??= { groups: [], publicMessages: [] };
      requireThat(members.every(member => d.groups.filter(g => g.members.includes(member)).length < DIPLOMACY_LIMITS.groupsPerParticipant),
        409, 'group.capacity.reached', 'A selected participant has reached the private group limit.');
      d.groups.push({ id: randomBytes(16).toString('hex'), name: command.name.trim(), members, createdBy: f, createdAt: this.now(), messages: [] });
      this.touch(r, f);
      return this.view(r, f);
    });
  }
  channelMessage(id: string, token: Credential, command: ChannelTransmission): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      const d = r.diplomacy ??= { groups: [], publicMessages: [] };
      const group = d.groups.find(g => g.id === command.channelId && g.members.includes(f));
      requireThat(command.channelId === 'public' || group, 404, 'channel.not_found', 'Channel not found.');
      requireThat(typeof command.text === 'string' && command.text.trim().length > 0 && command.text.length <= DIPLOMACY_LIMITS.text,
        400, 'message.validation.text', 'Transmissions must contain 1 to 1,000 characters.');
      if (this.receipt(r, f, command.requestId, JSON.stringify(['channel-message', command.channelId, command.text]))) return this.view(r, f);
      const messages = group ? group.messages : d.publicMessages;
      const messageId = randomBytes(16).toString('hex');
      messages.push({ id: messageId, from: f, text: command.text.trim(), sentAt: this.now() });
      this.notify(db, r, (group ? group.members : r.seats.map(s => s.faction)).filter(member => member !== f), `channel:${command.channelId}:${messageId}`);
      messages.splice(0, Math.max(0, messages.length - DIPLOMACY_LIMITS.messagesPerChannel));
      this.touch(r, f);
      return this.view(r, f);
    });
  }
  message(id: string, token: Credential, command: Transmission): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      requireThat(FACTIONS.includes(command.to) && command.to !== f && r.seats.some(s => s.faction === command.to), 400, 'message.validation.recipient', 'Choose another intelligence in this operation.');
      requireThat(typeof command.text === 'string' && command.text.trim().length > 0 && command.text.length <= 1000, 400, 'message.validation.text', 'Transmissions must contain 1 to 1,000 characters.');
      if (this.receipt(r, f, command.requestId, JSON.stringify(['message', command.to, command.text]))) return this.view(r, f);
      requireThat(r.messages.length < 5000, 409, 'message.capacity.reached', 'This operation has reached its transmission limit.');
      r.messages.push({ id: r.messages.length + 1, from: f, to: command.to, text: command.text.trim(), sentAt: this.now() });
      this.notify(db, r, [command.to], `message:${r.messages.length}`);
      this.touch(r, f);
      return this.view(r, f);
    });
  }
  // Notification enqueue shares the message transaction; any failure skips delivery and keeps the message.
  private notify(db: Database, room: Room, audience: Faction[], messageRef: string): void {
    if (!this.pushAvailable) return;
    try { enqueue(db, room, audience, messageRef, this.now()); }
    catch (error) { console.error('Notification enqueue skipped', (error as Error).name); }
  }
  private notificationView(db: Database, room: Room, faction: Faction, deviceId: string): MessageNotificationSettings {
    const binding = db.notifications?.bindings.find(b => b.roomId === room.id && b.faction === faction && b.deviceId === deviceId);
    const enabled = !!binding?.enabled && isCurrent(db, binding);
    return { gameId: room.id, deviceId, revision: binding?.revision ?? revisionFloor(db.notifications, room.id, faction), available: this.pushAvailable, enabled, ...(enabled ? { bindingId: binding!.id } : {}) };
  }
  // Preferences never settle time, renew activity, change order revisions, or enter replay.
  notificationSettings(id: string, token: Credential, deviceId: unknown): Promise<MessageNotificationSettings> {
    requireThat(typeof deviceId === 'string' && /^[a-f0-9]{64}$/.test(deviceId), 400, 'notification.validation.device', 'Provide this installation\'s device ID.');
    return this.transaction(db => { const room = this.room(db, id); return this.notificationView(db, room, this.seat(room, token), deviceId); });
  }
  async setNotifications(id: string, token: Credential, input: unknown): Promise<MessageNotificationSettings> {
    const command = canonicalNotificationSetting(input);
    return this.transaction(db => {
      const room = this.room(db, id); const faction = this.seat(room, token);
      const seat = room.seats.find(s => s.faction === faction)!;
      const state = db.notifications ??= { bindings: [], jobs: [] };
      let binding = state.bindings.find(b => b.roomId === room.id && b.faction === faction && b.deviceId === command.deviceId);
      const payload = JSON.stringify(['notifications', command.revision, command.enabled, command.expoPushToken ? tokenHash(command.expoPushToken) : null]);
      const prior = binding?.requests.find(r => r.id === command.requestId);
      requireThat(!prior || prior.payload === payload, 409, 'command.conflict.reused_id', 'This command ID was used for different content.');
      if (prior) return this.notificationView(db, room, faction, command.deviceId);
      requireThat(command.revision === (binding?.revision ?? revisionFloor(state, room.id, faction)), 409, 'notification.conflict.stale', 'Notification settings changed. Refresh before changing them.');
      requireThat(!command.enabled || this.pushAvailable, 503, 'notification.unavailable.delivery', 'This server does not deliver notifications.');
      if (!binding) {
        const own = state.bindings.filter(b => b.roomId === room.id && b.faction === faction);
        if (own.length >= NOTIFICATION_LIMITS.devicesPerSeat) {
          const oldest = own.filter(b => !b.enabled || !isCurrent(db, b)).sort((a, b) => a.updatedAt - b.updatedAt)[0];
          requireThat(oldest, 409, 'notification.capacity.devices', `Message notifications are limited to ${NOTIFICATION_LIMITS.devicesPerSeat} devices per seat. Disable one first.`);
          evict(state, oldest);
        }
        requireThat(state.bindings.length < NOTIFICATION_LIMITS.bindings, 503, 'notification.capacity.reached', 'This server has reached its notification device limit.');
        binding = { id: newBindingId(), roomId: room.id, faction, deviceId: command.deviceId, generation: seatGeneration(seat), revision: command.revision, enabled: false, updatedAt: this.now(), requests: [] };
        state.bindings.push(binding);
      }
      if (!isCurrent(db, binding)) { detach(state, binding); binding.generation = seatGeneration(seat); }
      if (command.enabled) {
        const token = command.expoPushToken!;
        for (const other of state.bindings) if (other !== binding && other.token === token) detach(state, other);
        if (!binding.enabled) binding.id = newBindingId();
        binding.enabled = true; binding.token = token;
      } else detach(state, binding);
      binding.revision++; binding.updatedAt = this.now();
      binding.requests = [...binding.requests, { id: command.requestId, payload }].slice(-NOTIFICATION_LIMITS.requestsPerBinding);
      return this.notificationView(db, room, faction, command.deviceId);
    });
  }
  notificationQueue(): NotificationQueue {
    return {
      claimSends: owner => this.transaction(db => claimSends(db, owner, this.now())),
      finishSends: (lease, results) => this.transaction(db => finishSends(db, lease, results, this.now())),
      claimReceipts: owner => this.transaction(db => claimReceipts(db, owner, this.now())),
      finishReceipts: (lease, results) => this.transaction(db => finishReceipts(db, lease, results, this.now())),
      release: lease => this.transaction(db => release(db, lease, this.now())),
    };
  }
}
