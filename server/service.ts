/**
 * ---
 * purpose: Authorize multiplayer seats, settle server time, and orchestrate durable game and diplomacy commands.
 * related:
 *   - ./database.ts - serialized atomic persistence
 *   - ./notification-preferences.ts - notification binding and consent updates
 *   - ./schedule-payload.ts - queued-order decoding and canonicalization
 * ---
 *
 * @format
 */

import { assignPlayerColor, isPlayerColor } from '../src/game/player-colors';
import { councilCommand } from './council-command';
import { factionStandings, finished, profileId } from './factions';
import { isAllegiance, type FactionStandings } from '../src/game/factions';
import { factionOpening } from '../src/game/faction-opening';
import { isTacticalPulseCommand } from '../src/game/tactical-pulse';
import type { PulseCommand } from '../src/game/pulse';
import { createPulseSystem, validatePulseConfig, type PulseConfig } from '../src/game/pulse';
import type { PulseOrder } from '../src/contracts/protocol';
import { generateSharedReplay, SharedReplayCapacityError } from '../src/replay/generate';
import { UnsupportedVisibilityNumericError } from '../src/replay/numeric-support';
import type { SharedReplay } from '../src/replay/timeline';
import { createHmac, randomBytes } from 'node:crypto';
import {
  DatabaseStore,
  type Database,
  type DatabaseRecoveryMode,
  type Persistence,
  type Room,
} from './database';
import { assertOperationAvailable } from './operation-quarantine';
import { createConfiguredGame } from '../src/game/world';
import {
  DEFAULT_GAME_OPTIONS,
  driftingBasesEnabled,
  validateOptions,
  type GameOptions,
} from '../src/game/rules';
import { ALL_PLAYERS, playersIn } from '../src/game/players';
import { DEFAULT_PORTRAITS } from '../src/game/characters';
import { advance, createGame, type Faction } from '../src/game/simulation';
import { type Specialist } from '../src/game/specialists';
import { isSpecialistKind } from '../src/game/specialist-catalog';
import type { HaulerChange } from '../src/game/transport';
import {
  mapActionFleets,
  mapActionUnits,
  plannedFleetIds,
  plannedUnitIds,
} from '../src/game/future-actions';
import { isScheduledLaunch } from '../src/game/orders';
import { observe } from '../src/game/visibility';
import {
  applyCommand,
  createArchive,
  exportArchive,
  replayTo,
  restoreArchive,
  type GameCommand,
} from '../src/game/replay';
import { INACTIVITY_HOURS, HOUR_MS } from '../src/game/retirement';
import { replayFits } from '../src/game/replay-save';
import type { HistorySnapshot } from '../src/contracts/protocol';
import type { FundingOrder } from '../src/contracts/protocol';
import type { MessageNotificationSettings } from '../src/contracts/notifications';
import {
  claimReceipts,
  claimSends,
  enqueue,
  enqueueIncoming,
  finishReceipts,
  finishSends,
  incomingLedger,
  invalidateSeat,
  NOTIFICATION_LIMITS,
  release,
  seatAcceptsIncoming,
  setIncomingLedger,
  type IncomingAlert,
  type Job,
  type ReceiptClaim,
  type ReceiptResult,
  type SendClaim,
  type SendResult,
} from './notifications';
import { hostileIncoming, incomingBody } from './incoming';
import type {
  CreateGroup,
  ChannelTransmission,
  ResignOrder,
  SpecialistOrder,
  HaulerOrder,
  SiteOrder,
  CancelSchedule,
  RecoverSeat,
  RecoverySetup,
  InterceptOrder,
  ModuleOrder,
  Order,
  GiftOrder,
  Snapshot,
  Transmission,
} from '../src/contracts/protocol';
import { Failure, requireThat } from './failure';
import { canonicalSchedule, canonicalScheduleEdit } from './schedule-payload';
import {
  canonicalNotificationSetting,
  notificationPreferenceView,
  setNotificationPreferences,
  type NotificationVersion,
} from './notification-preferences';
export { Failure } from './failure';
export type { NotificationVersion } from './notification-preferences';
const FACTIONS = ALL_PLAYERS;
export type { AccountCredential } from './seat-credentials';
import {
  credentialHash,
  matchesCredential,
  hash,
  matchesHash,
  type AccountCredential,
  type Credential,
} from './seat-credentials';
import { receipt } from './command-receipts';
import { addGroup, addChannelMessage, addPrivateMessage } from './diplomacy';
export type ServiceOptions = {
  notifications?: boolean;
  pulse?: PulseConfig;
  databaseRecovery?: DatabaseRecoveryMode;
};
export type NotificationQueue = {
  claimSends(owner: string): Promise<SendClaim>;
  /** Advances rooms whose seats accept incoming alerts, with no client request. Returns the rooms settled. */
  settleIncoming?(): Promise<number>;
  finishSends(lease: string, results: ReadonlyMap<string, SendResult>): Promise<void>;
  claimReceipts(owner: string): Promise<ReceiptClaim>;
  finishReceipts(lease: string, results: ReadonlyMap<string, ReceiptResult>): Promise<void>;
  release(lease: string): Promise<void>;
};
export class GameService {
  private constructor(
    private store: DatabaseStore,
    private now: () => number,
    private initialGame?: typeof createGame,
    private pushAvailable = false,
    private pulseDefaults?: PulseConfig,
  ) {}
  static async open(
    source: string | Persistence,
    now = Date.now,
    initialGame?: typeof createGame,
    options: ServiceOptions = {},
  ): Promise<GameService> {
    return new GameService(
      await DatabaseStore.open(source, { recovery: options.databaseRecovery }),
      now,
      initialGame,
      !!options.notifications,
      options.pulse ? validatePulseConfig(options.pulse) : undefined,
    );
  }
  private transaction<T>(run: (db: Database) => T): Promise<T> {
    return this.store.transaction(run);
  }
  private room(db: Database, id: string): Room {
    const room = db.rooms.find((r) => r.id === id);
    if (!room) assertOperationAvailable(db, { id });
    requireThat(room, 404, 'game.not_found', 'Operation not found.');
    return room;
  }
  private seat(room: Room, token: Credential): Faction {
    const seat = room.seats.find((s) => matchesCredential(s, token));
    requireThat(
      seat,
      401,
      'seat.unauthorized.token',
      'This token does not control a seat in this operation.',
    );
    return seat.faction;
  }
  private profile(db: Database, token: Credential, requireSeat = false): string {
    const credential = credentialHash(token);
    const seat = db.rooms.flatMap((r) => r.seats).find((s) => matchesCredential(s, token));
    assertOperationAvailable(db, {
      credential: token,
      ...(seat ? { profileId: profileId(seat) } : {}),
    });
    requireThat(
      !requireSeat || typeof token !== 'string' || seat,
      401,
      'seat.unauthorized.token',
      'This device credential no longer controls an operation.',
    );
    return seat ? profileId(seat) : credential;
  }
  private newSeat(
    db: Database,
    token: Credential,
    faction: Faction,
    variant?: 'faction',
  ): Room['seats'][number] {
    const identity = this.profile(db, token);
    const allegiance = db.factions?.find((p) => p.id === identity)?.faction;
    requireThat(
      !variant || allegiance,
      409,
      'faction.conflict.required',
      'Complete an online operation and choose your faction before entering faction mode.',
    );
    return {
      faction,
      hash: credentialHash(token),
      profileId: identity,
      ...(variant ? { allegiance } : {}),
      ...(typeof token !== 'string' ? token : {}),
    };
  }
  factions(token: Credential): Promise<FactionStandings> {
    return this.transaction((db) => {
      const identity = this.profile(db, token, true);
      this.settleRooms(db, () => true);
      return factionStandings(db, identity);
    });
  }
  chooseFaction(token: Credential, faction: unknown): Promise<FactionStandings> {
    return this.transaction((db) => {
      const identity = this.profile(db, token, true);
      requireThat(
        isAllegiance(faction),
        400,
        'faction.validation.identity',
        'Choose a known faction.',
      );
      this.settleRooms(db, () => true);
      const current = factionStandings(db, identity);
      requireThat(
        current.completedGames > 0,
        409,
        'faction.conflict.locked',
        'Complete your first online operation before choosing a faction.',
      );
      requireThat(
        !current.faction || current.faction === faction,
        409,
        'faction.conflict.chosen',
        'Your faction choice is permanent.',
      );
      if (!current.faction) (db.factions ??= []).push({ id: identity, faction });
      return factionStandings(db, identity);
    });
  }
  /** Every settle path also records first observations of incoming threats, so no request can swallow one. */
  private settle(db: Database, room: Room) {
    this.advanceRoom(room);
    this.trackIncoming(db, room);
  }
  private advanceRoom(room: Room) {
    if (room.startedAt !== null) {
      room.replay ??= exportArchive(createArchive(room.game));
      const target = Math.max(room.game.hour, (this.now() - room.startedAt) / HOUR_MS);
      while (room.game.version === 2 && !room.game.winner && !room.game.draw) {
        const active = room.seats.filter(
          (s) => !room.game.eliminated.includes(s.faction) && s.lastActiveHour !== undefined,
        );
        const deadline = Math.min(...active.map((s) => s.lastActiveHour! + INACTIVITY_HOURS));
        if (deadline > target) break;
        room.game = advance(room.game, Math.max(room.game.hour, deadline), { rivals: false });
        if (room.game.winner || room.game.draw) break;
        const owners = active
          .filter(
            (s) =>
              !room.game.eliminated.includes(s.faction) &&
              s.lastActiveHour! + INACTIVITY_HOURS <= deadline,
          )
          .map((s) => s.faction);
        if (owners.length) this.act(room, { type: 'inactivity', owners });
      }
      room.game = advance(room.game, target, { rivals: false });
      if (room.game.version === 2)
        for (const seat of room.seats) seat.lastActiveHour ??= room.game.hour;
    }
  }
  /** Diffs each consenting seat's observed threats against its ledger. Seats without a ledger seed silently. */
  private trackIncoming(db: Database, room: Room): void {
    const state = db.notifications;
    if (!this.pushAvailable || !state || room.startedAt === null) return;
    try {
      const alerts: (IncomingAlert & { firstHour: number; arrivesAt: number })[] = [];
      const ledgers: [Faction, string[] | undefined][] = [];
      for (const seat of room.seats) {
        const ledger = incomingLedger(state, room.id, seat.faction);
        if (!seatAcceptsIncoming(db, room.id, seat.faction)) {
          if (ledger) ledgers.push([seat.faction, undefined]);
          continue;
        }
        const threats = [...hostileIncoming(room.game, seat.faction)].slice(
          0,
          NOTIFICATION_LIMITS.incomingKeysPerSeat,
        );
        if (ledger) {
          const known = new Set(ledger.keys);
          for (const [key, fleet] of threats)
            if (!known.has(key))
              alerts.push({
                faction: seat.faction,
                fleet: fleet.id,
                key,
                firstHour: room.game.hour,
                arrivesAt: room.startedAt + fleet.arrives * HOUR_MS,
              });
        }
        ledgers.push([seat.faction, threats.map(([key]) => key)]);
      }
      for (const [faction, keys] of ledgers) setIncomingLedger(state, room.id, faction, keys);
      enqueueIncoming(db, room.id, alerts, this.now());
    } catch (error) {
      console.error('Incoming notification tracking skipped', (error as Error).name);
    }
  }
  /** Seeds a newly consenting seat from its observation at the current instant, without persisting any game advance. */
  private seedIncoming(db: Database, room: Room, faction: Faction): void {
    const state = db.notifications!;
    let game = room.game;
    try {
      const transient = structuredClone(room);
      this.advanceRoom(transient);
      game = transient.game;
    } catch (error) {
      console.error('Incoming notification seed used stored time', (error as Error).name);
    }
    setIncomingLedger(
      state,
      room.id,
      faction,
      [...hostileIncoming(game, faction).keys()].slice(0, NOTIFICATION_LIMITS.incomingKeysPerSeat),
    );
  }
  /** Settles matching active rooms one at a time; a failing room is restored so the others still commit. */
  private settleRooms(db: Database, matches: (room: Room) => boolean): number {
    let settled = 0;
    db.rooms.forEach((room, index) => {
      if (
        room.startedAt === null ||
        room.game.version !== 2 ||
        room.game.winner ||
        room.game.draw ||
        !matches(room)
      )
        return;
      const backup = structuredClone(room);
      try {
        this.settle(db, room);
        settled++;
      } catch (error) {
        db.rooms[index] = backup;
        console.error('Background settlement skipped a room', (error as Error).name);
      }
    });
    return settled;
  }
  private acceptsIncomingRoom = (db: Database) => (room: Room) =>
    room.seats.some((seat) => seatAcceptsIncoming(db, room.id, seat.faction));
  /** Zero-client settlement for rooms with incoming consent; skips the write when none qualify. */
  async settleIncoming(): Promise<number> {
    if (!this.pushAvailable) return 0;
    const due = await this.store.read((db) =>
      db.rooms.some(
        (room) =>
          room.startedAt !== null &&
          room.game.version === 2 &&
          !room.game.winner &&
          !room.game.draw &&
          this.acceptsIncomingRoom(db)(room),
      ),
    );
    return due ? this.transaction((db) => this.settleRooms(db, this.acceptsIncomingRoom(db))) : 0;
  }
  private renderIncoming(
    db: Database,
    job: Job & { alert: IncomingAlert },
  ): { body: string } | undefined {
    const room = db.rooms.find((r) => r.id === job.roomId);
    if (!room || room.startedAt === null) return undefined;
    const body = incomingBody(room.game, room.startedAt, job.alert.faction, job.alert, this.now());
    return body ? { body } : undefined;
  }
  private act(room: Room, command: GameCommand): void {
    const result = applyCommand(
      room.replay ? restoreArchive(room.replay) : createArchive(room.game),
      command,
      { rivals: false, knownThrough: room.game.hour },
    );
    const data = exportArchive(result.archive);
    requireThat(
      replayFits(data, command.type === 'inactivity'),
      409,
      'history.capacity.reached',
      'This operation has reached its command history limit.',
    );
    room.game = result.game;
    room.replay = data;
    if (command.type !== 'inactivity') this.touch(room, command.owner);
  }
  private touch(room: Room, faction: Faction): void {
    if (
      room.startedAt !== null &&
      room.game.version === 2 &&
      !room.game.winner &&
      !room.game.draw &&
      !room.game.eliminated.includes(faction)
    )
      room.seats.find((s) => s.faction === faction)!.lastActiveHour = room.game.hour;
  }
  private revision(room: Room, faction: Faction): number {
    return room.seats.find((s) => s.faction === faction)!.revision ?? 0;
  }
  private reviseOrders(room: Room, owners: readonly Faction[]): void {
    room.revision++;
    for (const seat of room.seats)
      if (owners.includes(seat.faction)) seat.revision = (seat.revision ?? 0) + 1;
  }
  private identify(
    room: Room,
    faction: Faction,
    kind: 'hauler' | 'message' | 'unit',
    id: number | string,
  ): number {
    const seat = room.seats.find((s) => s.faction === faction)!;
    const key = seat.identityHash ?? seat.hash;
    return createHmac('sha256', key).update(`${kind}:${id}`).digest().readUIntBE(0, 6);
  }
  private observation(room: Room, faction: Faction, source = room.game) {
    const canonical = new Map<number, number>();
    const game = observe(
      source,
      faction,
      (id) => {
        const alias = this.identify(room, faction, 'hauler', id);
        canonical.set(alias, id);
        return alias;
      },
      (id) => String(this.identify(room, faction, 'unit', id)),
    );
    const reference = (kind: 'outpost' | 'hauler', id: string | number) =>
      createHmac('sha256', Buffer.from(room.referenceKey!, 'hex'))
        .update(JSON.stringify(['machination.object-reference', 1, room.id, kind, id]))
        .digest('hex');
    return {
      game,
      references: {
        version: 1 as const,
        outposts: game.rocks.map((r) => ({ id: r.id, ref: reference('outpost', r.id) })),
        haulers: game.fleets.map((f) => ({
          id: f.id,
          ref: reference('hauler', canonical.get(f.id)!),
        })),
      },
    };
  }
  private view(room: Room, faction: Faction): Snapshot {
    return {
      id: room.id,
      invite: room.invite,
      status:
        room.startedAt === null
          ? 'game.lobby'
          : room.game.winner || room.game.draw
            ? 'game.finished'
            : 'game.active',
      ...(room.variant
        ? {
            variant: room.variant,
            allegiances: room.seats.map((s) => ({ player: s.faction, faction: s.allegiance! })),
          }
        : {}),
      faction,
      host: faction === 'you',
      members: room.seats.map((s) => s.faction),
      revision: this.revision(room, faction),
      groups: (room.diplomacy?.groups ?? [])
        .filter((g) => g.members.includes(faction))
        .map(({ messages, ...g }) => g),
      channels: [
        { id: 'public', kind: 'public', messages: room.diplomacy?.publicMessages ?? [] },
        ...(room.diplomacy?.groups ?? [])
          .filter((g) => g.members.includes(faction))
          .map((g) => ({ id: g.id, kind: 'private' as const, messages: g.messages })),
      ],
      recoveryEnabled: !!room.seats.find((s) => s.faction === faction)!.recoveryHash,
      ...(room.startedAt !== null &&
      room.game.version === 2 &&
      !room.game.winner &&
      !room.game.draw &&
      !room.game.eliminated.includes(faction) &&
      room.seats.find((s) => s.faction === faction)!.lastActiveHour !== undefined
        ? {
            inactivity: {
              expiresAt:
                room.startedAt +
                (room.seats.find((s) => s.faction === faction)!.lastActiveHour! +
                  INACTIVITY_HOURS) *
                  HOUR_MS,
            },
          }
        : {}),
      ...(room.replay
        ? { history: { from: room.replay.baseline.hour, through: room.game.hour } }
        : {}),
      visibility: 'sensors.v1',
      ...this.observation(room, faction),
      messages: room.messages
        .filter((m) => m.from === faction || m.to === faction)
        .map((m) => ({ ...m, id: this.identify(room, faction, 'message', m.id) })),
      serverTime: this.now(),
    };
  }
  accountSession(account: AccountCredential): Promise<Snapshot | null> {
    return this.transaction((db) => {
      credentialHash(account);
      const room = [...db.rooms]
        .reverse()
        .find((r) => r.seats.some((s) => matchesCredential(s, account)));
      if (!room || finished(room)) assertOperationAvailable(db, { credential: account });
      if (!room) return null;
      this.settle(db, room);
      return this.view(room, this.seat(room, account));
    });
  }
  linkAccount(id: string, token: string, account: AccountCredential): Promise<Snapshot> {
    return this.transaction((db) => {
      credentialHash(account);
      const room = this.room(db, id);
      const seat = room.seats.find((s) => s.hash === credentialHash(token));
      requireThat(
        seat,
        401,
        'seat.unauthorized.token',
        'The existing seat credential is required.',
      );
      requireThat(
        !seat.accountId || seat.accountId === account.accountId,
        409,
        'account.conflict.owner',
        'This seat belongs to another account.',
      );
      requireThat(
        !db.rooms.some((r) => r.seats.some((s) => s !== seat && s.accountId === account.accountId)),
        409,
        'account.conflict.assigned',
        'Your account already controls another operation.',
      );
      assertOperationAvailable(db, { credential: account });
      seat.accountId = account.accountId;
      delete seat.recoveryHash;
      delete seat.recoveryReceipt;
      invalidateSeat(db, room.id, seat.faction);
      this.settle(db, room);
      return this.view(room, seat.faction);
    });
  }
  create(
    token: Credential,
    options?: unknown,
    variant?: unknown,
    preferredColor?: unknown,
  ): Promise<Snapshot> {
    if (preferredColor !== undefined && !isPlayerColor(preferredColor))
      return Promise.reject(
        new Failure(400, 'player.validation.color', 'Choose a known player color.'),
      );
    if (variant !== undefined && variant !== 'faction')
      return Promise.reject(
        new Failure(400, 'game.validation.variant', 'Choose standard or faction mode.'),
      );
    let requested: GameOptions | undefined;
    try {
      requested = options === undefined ? undefined : validateOptions(options);
    } catch (e) {
      return Promise.reject(new Failure(400, 'game.validation.options', (e as Error).message));
    }
    if (variant && requested && 'teamFormat' in requested)
      return Promise.reject(
        new Failure(
          400,
          'game.validation.variant',
          'Faction mode uses individual victories. Choose a free-for-all setup.',
        ),
      );
    return this.transaction((db) => {
      credentialHash(token);
      for (const room of db.rooms)
        if (room.seats.some((s) => matchesCredential(s, token))) this.settle(db, room);
      const existing = db.rooms.find(
        (r) => !finished(r) && r.seats.some((s) => matchesCredential(s, token)),
      );
      if (existing) {
        requireThat(
          existing.variant === variant,
          409,
          'game.conflict.variant',
          'This credential already belongs to an operation with a different variant.',
        );
        requireThat(
          !requested ||
            (requested.playerCount === playersIn(existing.game).length &&
              !!requested.beltCompact === !!existing.game.compact &&
              requested.teamFormat === existing.game.rules?.teams?.format &&
              requested.mode === (existing.game.rules?.mode ?? 'mining') &&
              !!requested.driftingBases === driftingBasesEnabled(existing.game) &&
              !!requested.gravity === !!existing.game.rules?.gravity &&
              JSON.stringify(
                requested.portraits ?? DEFAULT_PORTRAITS.slice(0, requested.playerCount),
              ) ===
                JSON.stringify(
                  existing.game.rules?.portraits ??
                    DEFAULT_PORTRAITS.slice(0, playersIn(existing.game).length),
                )),
          409,
          'game.conflict.options',
          'This credential already belongs to an operation with different settings.',
        );
        this.settle(db, existing);
        return this.view(existing, this.seat(existing, token));
      }
      assertOperationAvailable(db, { credential: token });
      requireThat(
        db.rooms.length < 1000,
        503,
        'game.capacity.reached',
        'This server has reached its operation limit.',
      );
      const room: Room = {
        ...(variant ? { variant } : {}),
        id: randomBytes(12).toString('hex'),
        invite: randomBytes(12).toString('hex'),
        startedAt: null,
        referenceKey: randomBytes(32).toString('hex'),
        revision: 0,
        game:
          this.initialGame && !requested
            ? this.initialGame(
                this.now(),
                Object.fromEntries(FACTIONS.map((f) => [f, randomBytes(4).readUInt32BE()])),
              )
            : createConfiguredGame(
                requested ?? { ...DEFAULT_GAME_OPTIONS, beltCompact: true },
                this.now(),
                randomBytes(4).readUInt32BE(),
                Object.fromEntries(FACTIONS.map((f) => [f, randomBytes(4).readUInt32BE()])),
              ),
        seats: [this.newSeat(db, token, 'you', variant)],
        messages: [],
        receipts: {},
      };
      if (room.game.rules)
        room.game.rules.colors = assignPlayerColor(room.game.rules, [], 'you', preferredColor);
      if (room.game.pulse && this.pulseDefaults) {
        room.game.rules!.pulse = { ...this.pulseDefaults };
        room.game.pulse = createPulseSystem(room.game);
      }
      db.rooms.push(room);
      return this.view(room, 'you');
    });
  }
  join(invite: string, token: Credential, preferredColor?: unknown): Promise<Snapshot> {
    if (preferredColor !== undefined && !isPlayerColor(preferredColor))
      return Promise.reject(
        new Failure(400, 'player.validation.color', 'Choose a known player color.'),
      );
    return this.transaction((db) => {
      credentialHash(token);
      const room = db.rooms.find((r) => r.invite === invite);
      if (!room) assertOperationAvailable(db, { invite, credential: token });
      requireThat(room, 404, 'game.not_found.invite', 'Invitation not found.');
      const existing = room.seats.find((s) => matchesCredential(s, token));
      if (existing) {
        this.settle(db, room);
        return this.view(room, existing.faction);
      }
      assertOperationAvailable(db, { credential: token });
      for (const prior of db.rooms)
        if (prior.seats.some((s) => matchesCredential(s, token))) this.settle(db, prior);
      requireThat(
        !db.rooms.some((r) => !finished(r) && r.seats.some((s) => matchesCredential(s, token))),
        409,
        'seat.conflict.assigned',
        'This token already belongs to another operation.',
      );
      requireThat(
        room.startedAt === null && room.seats.length < playersIn(room.game).length,
        409,
        'game.conflict.closed',
        'This operation is no longer accepting players.',
      );
      const faction = playersIn(room.game)[room.seats.length]!;
      if (room.game.rules)
        room.game.rules.colors = assignPlayerColor(
          room.game.rules,
          room.seats.map((s) => s.faction),
          faction,
          preferredColor,
        );
      room.seats.push(this.newSeat(db, token, faction, room.variant));
      room.revision++;
      return this.view(room, faction);
    });
  }
  setRecovery(id: string, token: Credential, command: RecoverySetup): Promise<Snapshot> {
    return this.transaction((db) => {
      requireThat(
        typeof token === 'string',
        409,
        'recovery.conflict.account',
        'Sign in to restore an account seat.',
      );
      const room = this.room(db, id);
      const faction = this.seat(room, token);
      this.settle(db, room);
      requireThat(
        typeof command.secret === 'string' && /^[a-f0-9]{64}$/.test(command.secret),
        400,
        'recovery.validation.secret',
        'Provide a valid recovery secret.',
      );
      const secretHash = hash(command.secret);
      const seat = room.seats.find((s) => s.faction === faction)!;
      const prior = receipt(
        room,
        faction,
        command.requestId,
        JSON.stringify(['recovery', secretHash]),
      );
      if (prior) {
        requireThat(
          seat.recoveryHash === secretHash,
          409,
          'recovery.conflict.superseded',
          'This recovery code was replaced or consumed. Generate a new code.',
        );
        return this.view(room, faction);
      }
      requireThat(
        !db.rooms.some((r) =>
          r.seats.some(
            (s) =>
              (s !== seat && s.recoveryHash === secretHash) ||
              s.recoveryReceipt?.secretHash === secretHash,
          ),
        ),
        409,
        'recovery.conflict.used',
        'Generate a new recovery code.',
      );
      seat.recoveryHash = secretHash;
      return this.view(room, faction);
    });
  }
  recover(id: string, token: Credential, command: RecoverSeat): Promise<Snapshot> {
    return this.transaction((db) => {
      requireThat(
        typeof token === 'string',
        409,
        'recovery.conflict.account',
        'Restore a device seat before linking it to your account.',
      );
      const credential = credentialHash(token);
      requireThat(
        typeof command.secret === 'string' && /^[a-f0-9]{64}$/.test(command.secret),
        401,
        'recovery.unauthorized.code',
        'Recovery code is invalid, replaced, or already used.',
      );
      const secretHash = hash(command.secret);
      const room = db.rooms.find((r) => r.id === id);
      if (!room) assertOperationAvailable(db, { id });
      const seat = room?.seats.find(
        (s) =>
          !s.accountId &&
          (matchesHash(s.recoveryHash, secretHash) ||
            (matchesHash(s.recoveryReceipt?.secretHash, secretHash) &&
              s.recoveryReceipt?.credentialHash === credential &&
              s.hash === credential)),
      );
      requireThat(
        room && seat,
        401,
        'recovery.unauthorized.code',
        'Recovery code is invalid, replaced, or already used.',
      );
      if (seat.recoveryReceipt?.secretHash === secretHash && seat.hash === credential) {
        this.settle(db, room);
        return this.view(room, seat.faction);
      }
      requireThat(
        credential !== seat.hash &&
          !db.rooms.some((r) => r.seats.some((s) => matchesCredential(s, token))),
        409,
        'recovery.conflict.credential',
        'Restore with a fresh connection credential.',
      );
      seat.identityHash ??= seat.hash;
      seat.hash = credential;
      delete seat.recoveryHash;
      seat.recoveryReceipt = { secretHash, credentialHash: credential };
      invalidateSeat(db, room.id, seat.faction);
      this.settle(db, room);
      return this.view(room, seat.faction);
    });
  }
  snapshot(id: string, token: Credential): Promise<Snapshot> {
    return this.transaction((db) => {
      const r = this.room(db, id);
      const f = this.seat(r, token);
      this.settle(db, r);
      return this.view(r, f);
    });
  }
  async sharedReplay(
    id: string,
    token: Credential,
    from: number,
    through: number,
  ): Promise<SharedReplay> {
    requireThat(
      Number.isFinite(from) && Number.isFinite(through) && from >= 0 && through >= from,
      400,
      'replay.validation.bounds',
      'Choose a finite, ordered historical interval.',
    );
    const frozen = await this.transaction((db) => {
      const room = this.room(db, id);
      const perspective = this.seat(room, token);
      this.settle(db, room);
      requireThat(
        room.startedAt !== null && room.replay,
        409,
        'replay.conflict.lobby',
        'Replay history begins when the operation starts.',
      );
      // Return validation failures as data so normal engine settling still persists.
      if (from < room.replay.baseline.hour || through > room.game.hour) return null;
      return { game: room.game, replay: room.replay, perspective };
    });
    requireThat(
      frozen,
      400,
      'replay.validation.bounds',
      'Choose an interval within the available operation history.',
    );
    try {
      return generateSharedReplay(
        { game: frozen.game, archive: restoreArchive(frozen.replay) },
        frozen.perspective,
        from,
        through,
      );
    } catch (error) {
      if (error instanceof SharedReplayCapacityError)
        throw new Failure(
          413,
          error.code,
          'This observed timeline is too large. Choose a shorter interval.',
        );
      if (error instanceof UnsupportedVisibilityNumericError)
        throw new Failure(
          422,
          error.code,
          'This server cannot safely export the requested visibility timeline.',
        );
      throw error;
    }
  }
  history(id: string, token: Credential, hour: number): Promise<HistorySnapshot> {
    return this.transaction((db) => {
      const r = this.room(db, id);
      const f = this.seat(r, token);
      this.settle(db, r);
      requireThat(
        r.replay,
        409,
        'history.conflict.lobby',
        'History begins when the operation starts.',
      );
      requireThat(
        Number.isFinite(hour) && hour >= r.replay.baseline.hour && hour <= r.game.hour,
        400,
        'history.validation.hour',
        'Choose a time within the available operation history.',
      );
      const game = replayTo(restoreArchive(r.replay), hour, {
        rivals: false,
        knownThrough: r.game.hour,
      });
      return {
        id: r.id,
        faction: f,
        visibility: 'sensors.v1',
        history: { from: r.replay.baseline.hour, through: r.game.hour, at: hour },
        ...this.observation(r, f, game),
      };
    });
  }
  activity(id: string, token: Credential): Promise<Snapshot> {
    return this.transaction((db) => {
      const r = this.room(db, id);
      const f = this.seat(r, token);
      this.settle(db, r);
      this.touch(r, f);
      return this.view(r, f);
    });
  }
  resign(id: string, token: Credential, command: ResignOrder): Promise<Snapshot> {
    return this.transaction((db) => {
      const r = this.room(db, id);
      const f = this.seat(r, token);
      this.settle(db, r);
      if (receipt(r, f, command.requestId, JSON.stringify(['resign', command.revision])))
        return this.view(r, f);
      requireThat(
        r.startedAt !== null,
        409,
        'game.conflict.lobby',
        'The operation has not started.',
      );
      requireThat(
        Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f),
        409,
        'resign.conflict.stale',
        'Your orders changed. Refresh before resigning.',
      );
      try {
        this.act(r, { type: 'resign', owner: f });
      } catch (e) {
        throw new Failure(409, 'resign.conflict.invalid', (e as Error).message);
      }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  start(id: string, token: Credential): Promise<Snapshot> {
    return this.transaction((db) => {
      const r = this.room(db, id);
      const f = this.seat(r, token);
      requireThat(
        f === 'you',
        403,
        'game.forbidden.host',
        'Only the host can start the operation.',
      );
      requireThat(
        r.seats.length === playersIn(r.game).length,
        409,
        'game.conflict.seats',
        `Wait for all ${playersIn(r.game).length} intelligences to join.`,
      );
      if (r.startedAt === null) {
        if (r.variant === 'faction')
          r.game = factionOpening(
            r.game,
            r.seats.map((s) => ({ player: s.faction, faction: s.allegiance! })),
          );
        r.startedAt = this.now();
        r.game.epoch = r.startedAt;
        if (r.game.version === 2) for (const seat of r.seats) seat.lastActiveHour = r.game.hour;
        this.reviseOrders(r, [f]);
      }
      this.settle(db, r);
      return this.view(r, f);
    });
  }
  private manifest(
    room: Room,
    owner: Faction,
    from: string,
    ids?: string[],
    carried: Specialist[] = [],
  ): string[] {
    if (ids === undefined) return [];
    requireThat(
      Array.isArray(ids) &&
        ids.length <= 10000 &&
        ids.every((id) => typeof id === 'string') &&
        new Set(ids).size === ids.length,
      400,
      'module.validation.manifest',
      'Choose each module once.',
    );
    const available = [
      ...(room.game.rocks.find((r) => r.id === from && r.owner === owner)?.specialists ?? []),
      ...carried,
    ];
    return ids.map((id) => {
      const unit = available.find(
        (u) =>
          u.owner === owner &&
          !u.captive &&
          String(this.identify(room, owner, 'unit', u.id)) === id,
      );
      requireThat(
        unit,
        409,
        'module.conflict.unavailable',
        'A selected module is no longer at the departure site.',
      );
      return unit.id;
    });
  }
  private futureUnit(room: Room, owner: Faction, id: string, ownedOnly = false): string {
    const visible = observe(room.game, owner);
    const available = [...visible.rocks, ...visible.fleets]
      .flatMap((asset) => asset.specialists ?? [])
      .filter((unit) => !ownedOnly || unit.owner === owner)
      .map((unit) => unit.id);
    const canonical = [...available, ...plannedUnitIds(room.game, owner)].find(
      (unit) => String(this.identify(room, owner, 'unit', unit)) === id,
    );
    requireThat(
      canonical,
      409,
      'schedule.conflict.unit',
      'Choose a currently observed module or one of your planned recruits.',
    );
    return canonical;
  }
  private futureFleet(room: Room, owner: Faction, alias: number, enemy: boolean): number {
    const available = enemy
      ? observe(room.game, owner)
          .fleets.filter((fleet) => fleet.owner !== owner)
          .map((fleet) => fleet.id)
      : [
          ...room.game.fleets.filter((fleet) => fleet.owner === owner).map((fleet) => fleet.id),
          ...plannedFleetIds(room.game, owner),
        ];
    const canonical = available.find((id) => this.identify(room, owner, 'hauler', id) === alias);
    requireThat(
      canonical !== undefined,
      409,
      'schedule.conflict.fleet',
      enemy
        ? 'Choose a currently observed enemy hauler.'
        : 'Choose one of your haulers or queued launches.',
    );
    return canonical;
  }
  specialist(id: string, token: Credential, command: SpecialistOrder): Promise<Snapshot> {
    return this.transaction((db) => {
      const r = this.room(db, id);
      const f = this.seat(r, token);
      this.settle(db, r);
      const payload = JSON.stringify([
        'specialist',
        command.action,
        command.action === 'hire' ? command.kind : command.unit,
        command.revision,
      ]);
      if (receipt(r, f, command.requestId, payload)) return this.view(r, f);
      requireThat(
        r.startedAt !== null,
        409,
        'game.conflict.lobby',
        'The operation has not started.',
      );
      requireThat(
        Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f),
        409,
        'module.conflict.stale',
        'Your orders changed. Refresh before managing modules.',
      );
      try {
        if (command.action === 'hire') {
          if (!isSpecialistKind(command.kind)) throw new Error('Choose a recruitment offer.');
          this.act(r, { type: 'hire', owner: f, kind: command.kind });
        } else {
          const unit = r.game.rocks
            .filter((rock) => rock.owner === f)
            .flatMap((rock) => rock.specialists ?? [])
            .find((u) => String(this.identify(r, f, 'unit', u.id)) === command.unit);
          if (!unit) throw new Error('Choose a module at a controlled site.');
          if (command.action === 'promote') this.act(r, { type: 'promote', owner: f, id: unit.id });
          else if (command.action === 'activate')
            this.act(r, { type: 'activate', owner: f, id: unit.id });
          else if (command.action === 'release')
            this.act(r, { type: 'release', owner: f, id: unit.id });
          else throw new Error('Unknown module command.');
        }
      } catch (e) {
        throw new Failure(409, 'module.conflict.invalid', (e as Error).message);
      }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  order(id: string, token: Credential, order: Order): Promise<Snapshot> {
    return this.transaction((db) => {
      const r = this.room(db, id);
      const f = this.seat(r, token);
      this.settle(db, r);
      if (
        receipt(
          r,
          f,
          order.requestId,
          JSON.stringify([
            'order',
            order.from,
            order.to,
            order.drones,
            order.revision,
            ...(order.carryModule === undefined || order.carryModule === false
              ? []
              : [order.carryModule]),
            ...(order.specialists?.length ? [order.specialists] : []),
          ]),
        )
      )
        return this.view(r, f);
      requireThat(
        r.startedAt !== null,
        409,
        'game.conflict.lobby',
        'The operation has not started.',
      );
      requireThat(
        Number.isSafeInteger(order.revision) && order.revision === this.revision(r, f),
        409,
        'order.conflict.stale',
        'The operation changed. Refresh before issuing this order.',
      );
      try {
        this.act(r, {
          type: 'dispatch',
          owner: f,
          from: order.from,
          to: order.to,
          drones: order.drones,
          carryModule: order.carryModule,
          specialists: this.manifest(r, f, order.from, order.specialists),
        });
      } catch (e) {
        throw new Failure(409, 'order.conflict.invalid', (e as Error).message);
      }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  gift(id: string, token: Credential, command: GiftOrder): Promise<Snapshot> {
    return this.transaction((db) => {
      const r = this.room(db, id);
      const f = this.seat(r, token);
      this.settle(db, r);
      if (
        receipt(
          r,
          f,
          command.requestId,
          JSON.stringify([
            'gift',
            command.from,
            command.to,
            command.drones,
            command.recipient,
            command.revision,
            command.carryModule ?? false,
            ...(command.specialists?.length ? [command.specialists] : []),
          ]),
        )
      )
        return this.view(r, f);
      requireThat(
        r.startedAt !== null,
        409,
        'game.conflict.lobby',
        'The operation has not started.',
      );
      requireThat(
        Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f),
        409,
        'gift.conflict.stale',
        'Your orders changed. Refresh before gifting.',
      );
      try {
        this.act(r, {
          type: 'gift',
          owner: f,
          from: command.from,
          to: command.to,
          drones: command.drones,
          recipient: command.recipient,
          carryModule: command.carryModule,
          specialists: this.manifest(r, f, command.from, command.specialists),
        });
      } catch (e) {
        throw new Failure(409, 'gift.conflict.invalid', (e as Error).message);
      }
      this.reviseOrders(r, r.game.version === 1 ? [f, command.recipient] : [f]);
      return this.view(r, f);
    });
  }
  install(id: string, token: Credential, command: ModuleOrder): Promise<Snapshot> {
    return this.transaction((db) => {
      const r = this.room(db, id);
      const f = this.seat(r, token);
      this.settle(db, r);
      if (
        receipt(
          r,
          f,
          command.requestId,
          JSON.stringify(['module', command.rock, command.module, command.revision]),
        )
      )
        return this.view(r, f);
      requireThat(
        r.startedAt !== null,
        409,
        'game.conflict.lobby',
        'The operation has not started.',
      );
      requireThat(
        Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f),
        409,
        'module.conflict.stale',
        'The operation changed. Refresh before building a module.',
      );
      try {
        this.act(r, { type: 'install-module', owner: f, rock: command.rock, kind: command.module });
      } catch (e) {
        throw new Failure(409, 'module.conflict.invalid', (e as Error).message);
      }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  hauler(id: string, token: Credential, command: HaulerOrder): Promise<Snapshot> {
    return this.transaction((db) => {
      const r = this.room(db, id);
      const f = this.seat(r, token);
      this.settle(db, r);
      const payload = JSON.stringify([
        'hauler',
        command.fleet,
        command.action,
        command.action === 'edit-launch' ? command.drones : null,
        command.revision,
        ...(command.action === 'course' ? [command.to] : []),
        ...(command.action === 'edit-launch' && command.specialists?.length
          ? [command.specialists]
          : []),
      ]);
      if (receipt(r, f, command.requestId, payload)) return this.view(r, f);
      requireThat(
        r.startedAt !== null,
        409,
        'game.conflict.lobby',
        'The operation has not started.',
      );
      requireThat(
        Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f),
        409,
        'hauler.conflict.stale',
        'Your orders changed. Refresh before changing this hauler.',
      );
      const fleet = r.game.fleets.find(
        (fleet) => fleet.owner === f && this.identify(r, f, 'hauler', fleet.id) === command.fleet,
      );
      requireThat(fleet, 409, 'hauler.conflict.target', 'Choose one of your haulers.');
      try {
        const change: HaulerChange =
          command.action === 'edit-launch'
            ? {
                action: 'edit-launch',
                fleet: fleet.id,
                drones: command.drones,
                ...(command.specialists !== undefined
                  ? {
                      specialists: this.manifest(
                        r,
                        f,
                        fleet.from,
                        command.specialists,
                        fleet.specialists,
                      ),
                    }
                  : {}),
              }
            : command.action === 'course'
              ? { action: 'course', fleet: fleet.id, to: command.to }
              : { action: command.action, fleet: fleet.id };
        this.act(r, { type: 'hauler', owner: f, change });
      } catch (e) {
        throw new Failure(409, 'hauler.conflict.invalid', (e as Error).message);
      }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  pulse(id: string, token: Credential, command: PulseOrder): Promise<Snapshot> {
    command = { ...command };
    return this.transaction((db) => {
      const r = this.room(db, id),
        f = this.seat(r, token);
      this.settle(db, r);
      const { requestId, revision, ...request } = command;
      const engineCommand = { ...request, id: requestId } as PulseCommand;
      const tactical = !Object.hasOwn(request, 'id') && isTacticalPulseCommand(engineCommand);
      requireThat(
        tactical ||
          (Object.keys(request).length === 1 &&
            ['START_CHARGE', 'CANCEL_CHARGE', 'FIRE_PULSE', 'TERMINATE_PULSE'].includes(
              command.action,
            )),
        400,
        'pulse.validation.command',
        'Choose a pulse command.',
      );
      if (
        receipt(
          r,
          f,
          requestId,
          JSON.stringify(
            isTacticalPulseCommand(engineCommand)
              ? [
                  'pulse',
                  engineCommand.action,
                  revision,
                  engineCommand.specialistId,
                  engineCommand.action === 'CHARGE_DISRUPTOR' ? engineCommand.resourceCost : null,
                ]
              : ['pulse', command.action, revision],
          ),
        )
      )
        return this.view(r, f);
      requireThat(
        r.startedAt !== null,
        409,
        'game.conflict.lobby',
        'The operation has not started.',
      );
      requireThat(
        Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f),
        409,
        'pulse.conflict.stale',
        'Your orders changed. Refresh before commanding your King.',
      );
      try {
        if (isTacticalPulseCommand(engineCommand))
          engineCommand.specialistId = this.futureUnit(r, f, engineCommand.specialistId, true);
        this.act(r, { type: 'pulse', owner: f, command: engineCommand });
      } catch (e) {
        throw new Failure(409, 'pulse.conflict.invalid', (e as Error).message);
      }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  site(id: string, token: Credential, command: SiteOrder): Promise<Snapshot> {
    return this.transaction((db) => {
      const r = this.room(db, id);
      const f = this.seat(r, token);
      this.settle(db, r);
      const payload = JSON.stringify([
        'site',
        command.rock,
        command.action,
        command.action === 'shields' ? command.disabled : null,
        command.revision,
      ]);
      if (receipt(r, f, command.requestId, payload)) return this.view(r, f);
      requireThat(
        r.startedAt !== null,
        409,
        'game.conflict.lobby',
        'The operation has not started.',
      );
      requireThat(
        Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f),
        409,
        'site.conflict.stale',
        'Your orders changed. Refresh before changing this site.',
      );
      try {
        if (command.action === 'mine')
          this.act(r, { type: 'drill-mine', owner: f, rock: command.rock });
        else if (command.action === 'shields')
          this.act(r, {
            type: 'shields',
            owner: f,
            rock: command.rock,
            disabled: command.disabled,
          });
        else throw new Error('Choose a mine or shield command.');
      } catch (e) {
        throw new Failure(409, 'site.conflict.invalid', (e as Error).message);
      }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  intercept(id: string, token: Credential, command: InterceptOrder): Promise<Snapshot> {
    return this.transaction((db) => {
      const r = this.room(db, id);
      const f = this.seat(r, token);
      this.settle(db, r);
      if (
        receipt(
          r,
          f,
          command.requestId,
          JSON.stringify([
            'intercept',
            command.from,
            command.target,
            command.drones,
            command.revision,
            ...(command.specialists?.length ? [command.specialists] : []),
          ]),
        )
      )
        return this.view(r, f);
      requireThat(
        r.startedAt !== null,
        409,
        'game.conflict.lobby',
        'The operation has not started.',
      );
      requireThat(
        Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f),
        409,
        'interception.conflict.stale',
        'Your orders changed. Refresh before intercepting.',
      );
      const visible = observe(r.game, f, (fleetId) => this.identify(r, f, 'hauler', fleetId));
      const contact = visible.fleets.find(
        (fleet) => fleet.id === command.target && fleet.owner !== f,
      );
      requireThat(
        contact,
        409,
        'interception.conflict.target',
        'Target is not an observed enemy hauler.',
      );
      const target = r.game.fleets.find(
        (fleet) => this.identify(r, f, 'hauler', fleet.id) === contact.id,
      )!;
      try {
        this.act(r, {
          type: 'intercept',
          owner: f,
          from: command.from,
          target: target.id,
          drones: command.drones,
          specialists:
            command.specialists === undefined
              ? undefined
              : this.manifest(r, f, command.from, command.specialists),
        });
      } catch (e) {
        throw new Failure(409, 'interception.conflict.invalid', (e as Error).message);
      }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  async schedule(id: string, token: Credential, input: unknown): Promise<Snapshot> {
    const command = canonicalSchedule(input);
    return this.transaction((db) => {
      const r = this.room(db, id);
      const f = this.seat(r, token);
      this.settle(db, r);
      const payload =
        'action' in command
          ? JSON.stringify(['schedule-action', command.action, command.revision, command.executeAt])
          : JSON.stringify([
              'schedule',
              command.from,
              command.to,
              command.drones,
              command.revision,
              command.executeAt,
              command.carryModule ?? false,
              ...(command.specialists?.length ? [command.specialists] : []),
            ]);
      if (receipt(r, f, command.requestId, payload)) return this.view(r, f);
      requireThat(
        r.startedAt !== null,
        409,
        'game.conflict.lobby',
        'The operation has not started.',
      );
      requireThat(
        Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f),
        409,
        'schedule.conflict.stale',
        'Your orders changed. Refresh before scheduling.',
      );
      try {
        if ('action' in command)
          this.act(r, {
            type: 'schedule-action',
            owner: f,
            plan: {
              id: command.requestId,
              executeAt: command.executeAt,
              action: mapActionFleets(
                mapActionUnits(command.action, (unit) =>
                  this.futureUnit(
                    r,
                    f,
                    unit,
                    command.action.type !== 'promote' && command.action.type !== 'release',
                  ),
                ),
                (fleet) => this.futureFleet(r, f, fleet, command.action.type === 'intercept'),
              ),
            },
          });
        else
          this.act(r, {
            type: 'schedule',
            owner: f,
            plan: {
              id: command.requestId,
              from: command.from,
              to: command.to,
              drones: command.drones,
              executeAt: command.executeAt,
              carryModule: command.carryModule,
              specialists:
                command.specialists?.map((unit) => this.futureUnit(r, f, unit, true)) ?? [],
            },
          });
      } catch (e) {
        throw new Failure(409, 'schedule.conflict.invalid', (e as Error).message);
      }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  async editSchedule(id: string, token: Credential, input: unknown): Promise<Snapshot> {
    const command = canonicalScheduleEdit(input);
    return this.transaction((db) => {
      const r = this.room(db, id);
      const f = this.seat(r, token);
      this.settle(db, r);
      const payload = JSON.stringify([
        'edit-schedule',
        command.revision,
        command.planId,
        command.drones,
        ...(command.specialists === undefined ? [] : [command.specialists]),
      ]);
      if (receipt(r, f, command.requestId, payload)) return this.view(r, f);
      requireThat(
        r.startedAt !== null,
        409,
        'game.conflict.lobby',
        'The operation has not started.',
      );
      requireThat(
        command.revision === this.revision(r, f),
        409,
        'schedule.conflict.stale',
        'Your orders changed. Refresh before editing.',
      );
      const plan = r.game.scheduled?.find(
        (plan) => plan.id === command.planId && plan.owner === f && isScheduledLaunch(plan),
      );
      requireThat(plan, 409, 'schedule.conflict.missing', 'Choose one of your queued launches.');
      const prior = 'action' in plan ? plan.action : plan;
      const existingUnits = 'specialists' in prior ? (prior.specialists ?? []) : [];
      try {
        this.act(r, {
          type: 'edit-schedule',
          owner: f,
          change: {
            planId: command.planId,
            drones: command.drones,
            ...(command.specialists === undefined
              ? {}
              : {
                  specialists: command.specialists.map(
                    (alias) =>
                      existingUnits.find(
                        (unit) => String(this.identify(r, f, 'unit', unit)) === alias,
                      ) ?? this.futureUnit(r, f, alias, true),
                  ),
                }),
          },
        });
      } catch (error) {
        throw new Failure(409, 'schedule.conflict.invalid', (error as Error).message);
      }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  cancelSchedule(id: string, token: Credential, command: CancelSchedule): Promise<Snapshot> {
    return this.transaction((db) => {
      const r = this.room(db, id);
      const f = this.seat(r, token);
      this.settle(db, r);
      if (
        receipt(
          r,
          f,
          command.requestId,
          JSON.stringify(['cancel-schedule', command.planId, command.revision]),
        )
      )
        return this.view(r, f);
      requireThat(
        Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f),
        409,
        'schedule.conflict.stale',
        'Your orders changed. Refresh before canceling.',
      );
      try {
        this.act(r, { type: 'cancel-schedule', owner: f, id: command.planId });
      } catch (e) {
        throw new Failure(409, 'schedule.conflict.missing', (e as Error).message);
      }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  funding(id: string, token: Credential, command: FundingOrder): Promise<Snapshot> {
    return this.transaction((db) => {
      const r = this.room(db, id);
      const f = this.seat(r, token);
      this.settle(db, r);
      if (
        receipt(
          r,
          f,
          command.requestId,
          JSON.stringify(['funding', command.recipient, command.enabled, command.revision]),
        )
      )
        return this.view(r, f);
      requireThat(
        r.startedAt !== null,
        409,
        'game.conflict.lobby',
        'The operation has not started.',
      );
      requireThat(
        Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f),
        409,
        'funding.conflict.stale',
        'Your orders changed. Refresh before changing funding.',
      );
      requireThat(
        r.seats.some((s) => s.faction === command.recipient),
        400,
        'funding.validation.recipient',
        'Choose a joined intelligence.',
      );
      try {
        this.act(r, { type: 'funding', owner: f, to: command.recipient, enabled: command.enabled });
      } catch (e) {
        throw new Failure(409, 'funding.conflict.invalid', (e as Error).message);
      }
      this.reviseOrders(r, [f]);
      return this.view(r, f);
    });
  }
  council(id: string, token: Credential, input: unknown): Promise<Snapshot> {
    let c: ReturnType<typeof councilCommand>;
    try {
      c = councilCommand(input);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.transaction((db) => {
      const r = this.room(db, id);
      const f = this.seat(r, token);
      this.settle(db, r);
      if (
        receipt(
          r,
          f,
          c.requestId,
          JSON.stringify([
            'council',
            c.action,
            c.motionId,
            c.action === 'vote' ? c.choice : c.policy,
          ]),
        )
      )
        return this.view(r, f);
      requireThat(
        r.startedAt !== null,
        409,
        'game.conflict.lobby',
        'The operation has not started.',
      );
      try {
        this.act(
          r,
          c.action === 'vote'
            ? { type: 'council-vote', owner: f, motionId: c.motionId, choice: c.choice }
            : { type: 'council-nominate', owner: f, motionId: c.motionId, policy: c.policy },
        );
      } catch (e) {
        throw new Failure(409, 'council.conflict.invalid', (e as Error).message);
      }
      return this.view(r, f);
    });
  }
  createGroup(id: string, token: Credential, command: CreateGroup): Promise<Snapshot> {
    return this.transaction((db) => {
      const room = this.room(db, id),
        faction = this.seat(room, token);
      this.settle(db, room);
      if (addGroup(room, faction, command, this.now())) this.touch(room, faction);
      return this.view(room, faction);
    });
  }
  channelMessage(id: string, token: Credential, command: ChannelTransmission): Promise<Snapshot> {
    return this.transaction((db) => {
      const room = this.room(db, id),
        faction = this.seat(room, token);
      this.settle(db, room);
      const notification = addChannelMessage(room, faction, command, this.now());
      if (notification) {
        this.notify(db, room, notification.audience, notification.reference);
        this.touch(room, faction);
      }
      return this.view(room, faction);
    });
  }
  message(id: string, token: Credential, command: Transmission): Promise<Snapshot> {
    return this.transaction((db) => {
      const room = this.room(db, id),
        faction = this.seat(room, token);
      this.settle(db, room);
      const notification = addPrivateMessage(room, faction, command, this.now());
      if (notification) {
        this.notify(db, room, notification.audience, notification.reference);
        this.touch(room, faction);
      }
      return this.view(room, faction);
    });
  }
  // Notification enqueue shares the message transaction; any failure skips delivery and keeps the message.
  private notify(db: Database, room: Room, audience: Faction[], messageRef: string): void {
    if (!this.pushAvailable) return;
    try {
      enqueue(db, room, audience, messageRef, this.now());
    } catch (error) {
      console.error('Notification enqueue skipped', (error as Error).name);
    }
  }
  // Preferences never settle time, renew activity, change order revisions, or enter replay.
  notificationSettings(
    id: string,
    token: Credential,
    deviceId: unknown,
    version: NotificationVersion = 1,
  ): Promise<MessageNotificationSettings> {
    requireThat(
      typeof deviceId === 'string' && /^[a-f0-9]{64}$/.test(deviceId),
      400,
      'notification.validation.device',
      "Provide this installation's device ID.",
    );
    return this.transaction((db) => {
      const room = this.room(db, id);
      return notificationPreferenceView(db, room.id, this.seat(room, token), deviceId, {
        version,
        available: this.pushAvailable,
      });
    });
  }
  /** Version 1 keeps its exact shape: enabling or rotating a token preserves incoming consent, and disabling clears it. */
  async setNotifications(
    id: string,
    token: Credential,
    input: unknown,
    version: NotificationVersion = 1,
  ): Promise<MessageNotificationSettings> {
    const command = canonicalNotificationSetting(input, version);
    return this.transaction((db) => {
      const room = this.room(db, id);
      const faction = this.seat(room, token);
      const result = setNotificationPreferences(db, room, faction, command, {
        version,
        available: this.pushAvailable,
        now: () => this.now(),
      });
      if (result.seedIncoming) this.seedIncoming(db, room, faction);
      return result.settings;
    });
  }
  notificationQueue(): NotificationQueue {
    return {
      // Rooms with pending incoming work settle first, so text and obsolescence come from current authorized state.
      claimSends: (owner) =>
        this.transaction((db) => {
          this.settleRooms(
            db,
            (room) =>
              !!db.notifications?.jobs.some(
                (job) =>
                  job.kind === 'incoming' &&
                  job.roomId === room.id &&
                  (job.state === 'queued' || job.state === 'sending'),
              ),
          );
          return claimSends(db, owner, this.now(), undefined, (job) =>
            this.renderIncoming(db, job),
          );
        }),
      settleIncoming: () => this.settleIncoming(),
      finishSends: (lease, results) =>
        this.transaction((db) => finishSends(db, lease, results, this.now())),
      claimReceipts: (owner) => this.transaction((db) => claimReceipts(db, owner, this.now())),
      finishReceipts: (lease, results) =>
        this.transaction((db) => finishReceipts(db, lease, results, this.now())),
      release: (lease) => this.transaction((db) => release(db, lease, this.now())),
    };
  }
}
