/**
 * ---
 * purpose: Serialize multiplayer transactions, persist snapshots, authorize seats, and settle server time.
 * ---
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createConfiguredGame } from '../src/game/world';
import { DEFAULT_GAME_OPTIONS, validateOptions, type GameOptions } from '../src/game/rules';
import { ALL_PLAYERS, playersIn } from '../src/game/players';
import { advance, createGame, type Faction, type Game } from '../src/game/simulation';
import { type Specialist } from '../src/game/specialists';
import { isSpecialistKind } from '../src/game/specialist-catalog';
import type { HaulerChange } from '../src/game/transport';
import { mapActionUnits, plannedUnitIds, validateFutureAction } from '../src/game/future-actions';
import { observe } from '../src/game/visibility';
import { applyCommand, createArchive, exportArchive, replayTo, restoreArchive, type GameCommand, type ReplayData } from '../src/game/replay';
import { INACTIVITY_HOURS, HOUR_MS } from '../src/game/retirement';
import { decodeReplay, replayFits } from '../src/game/replay-save';
import type { HistorySnapshot } from '../src/online/protocol';
import type { FundingOrder } from '../src/online/protocol';
import { decodeSave } from '../src/game/save-format';
import { DIPLOMACY_LIMITS } from '../src/online/protocol';
import type { Group, ChannelMessage, CreateGroup, ChannelTransmission, ResignOrder, SpecialistOrder, HaulerOrder, SiteOrder, CancelSchedule, RecoverSeat, RecoverySetup, InterceptOrder, Message, ModuleOrder, Order, GiftOrder, ScheduleOrder, Snapshot, Transmission } from '../src/online/protocol';
const FACTIONS = ALL_PLAYERS;
type Diplomacy = { groups: (Group & { messages: ChannelMessage[] })[]; publicMessages: ChannelMessage[] };
type Room = {
  id: string; invite: string; startedAt: number | null; revision: number; game: Game;
  seats: { faction: Faction; hash: string; revision?: number; lastActiveHour?: number; identityHash?: string; recoveryHash?: string; recoveryReceipt?: { secretHash: string; credentialHash: string } }[]; messages: Message[];
  receipts: Record<string, string>; diplomacy?: Diplomacy; replay?: ReplayData;
};
type Database = { version: 1; rooms: Room[] };
export class Failure extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
function requireThat(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new Failure(status, code, message);
}
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
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
    try { return { ...base, action: validateFutureAction(value.action) }; }
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
export class GameService {
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(private file: string, private database: Database, private now: () => number, private initialGame?: typeof createGame) {}
  static async open(file: string, now = Date.now, initialGame?: typeof createGame): Promise<GameService> {
    let database: Database = { version: 1, rooms: [] };
    try {
      database = JSON.parse(await readFile(file, 'utf8'));
      if (database.version !== 1 || !Array.isArray(database.rooms)) throw new Error('Unsupported server database.');
      const ids = new Set<string>();
      for (const r of database.rooms) {
        r.game = decodeSave(JSON.stringify({ savedAt: 0, game: r.game })).game;
        if (!/^[a-f0-9]{24}$/.test(r.id) || ids.has(r.id) || !/^[a-f0-9]{24}$/.test(r.invite)
          || !(r.startedAt === null || Number.isFinite(r.startedAt) && r.startedAt >= 0)
          || !Number.isSafeInteger(r.revision) || r.revision < 0 || !Array.isArray(r.seats) || r.seats.length < 1 || r.seats.length > playersIn(r.game).length || r.startedAt !== null && r.seats.length !== playersIn(r.game).length
          || !r.seats.every(s => playersIn(r.game).includes(s.faction) && /^[a-f0-9]{64}$/.test(s.hash))
          || new Set(r.seats.map(s => s.faction)).size !== r.seats.length || r.seats[0]?.faction !== 'you'
          || !Array.isArray(r.messages) || !r.receipts || typeof r.receipts !== 'object' || Array.isArray(r.receipts)
          || !r.messages.every(m => Number.isSafeInteger(m.id) && playersIn(r.game).includes(m.from) && playersIn(r.game).includes(m.to) && typeof m.text === 'string' && Number.isFinite(m.sentAt))) throw new Error('Damaged server database.');
        for (const seat of r.seats) {
          if (seat.lastActiveHour !== undefined && (r.startedAt === null || r.game.version !== 2 || !Number.isFinite(seat.lastActiveHour) || seat.lastActiveHour < 0 || seat.lastActiveHour > r.game.hour)
            || seat.identityHash !== undefined && !isHash(seat.identityHash)
            || seat.recoveryHash !== undefined && !isHash(seat.recoveryHash)
            || seat.recoveryReceipt !== undefined && (!seat.recoveryReceipt || !isHash(seat.recoveryReceipt.secretHash) || seat.recoveryReceipt.credentialHash !== seat.hash)) throw new Error('Damaged recovery metadata.');
          seat.revision ??= 0;
          if (!Number.isSafeInteger(seat.revision) || seat.revision < 0) throw new Error('Damaged seat revision.');
        }
        r.diplomacy ??= { groups: [], publicMessages: [] };
        const d = r.diplomacy;
        const validMessages = (messages: ChannelMessage[]) => Array.isArray(messages) && messages.length <= DIPLOMACY_LIMITS.messagesPerChannel
          && messages.every(m => m && typeof m.id === 'string' && /^[a-f0-9]{32}$/.test(m.id) && r.seats.some(s => s.faction === m.from)
            && typeof m.text === 'string' && m.text.trim().length > 0 && m.text.length <= DIPLOMACY_LIMITS.text && Number.isFinite(m.sentAt))
          && new Set(messages.map(m => m.id)).size === messages.length;
        if (!d || !Array.isArray(d.groups) || d.groups.length > FACTIONS.length * DIPLOMACY_LIMITS.groupsPerParticipant
          || !validMessages(d.publicMessages)
          || !d.groups.every(g => g && typeof g.id === 'string' && /^[a-f0-9]{32}$/.test(g.id)
            && typeof g.name === 'string' && g.name.trim().length > 0 && g.name.length <= DIPLOMACY_LIMITS.name
            && Array.isArray(g.members) && g.members.length >= 2 && g.members.length <= r.seats.length
            && new Set(g.members).size === g.members.length && g.members.every(f => r.seats.some(s => s.faction === f))
            && g.members.includes(g.createdBy) && Number.isFinite(g.createdAt) && validMessages(g.messages)
            && g.messages.every(m => g.members.includes(m.from)))
          || new Set(d.groups.map(g => g.id)).size !== d.groups.length
          || r.seats.some(s => d.groups.filter(g => g.members.includes(s.faction)).length > DIPLOMACY_LIMITS.groupsPerParticipant)) throw new Error('Damaged diplomacy metadata.');
        if (r.replay !== undefined) {
          if (r.startedAt === null) throw new Error('A lobby cannot contain operation history.');
          r.replay = exportArchive(decodeReplay(r.replay, r.game, false));
        }
        ids.add(r.id);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return new GameService(file, database, now, initialGame);
  }
  private transaction<T>(run: (db: Database) => T): Promise<T> {
    const result = this.queue.then(async () => {
      const next = structuredClone(this.database);
      const value = run(next);
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flush: true });
      await rename(temporary, this.file);
      this.database = next;
      return structuredClone(value);
    });
    this.queue = result.catch(() => undefined);
    return result;
  }
  private credential(token: string): string {
    requireThat(/^[a-f0-9]{64}$/.test(token), 401, 'seat.unauthorized.token', 'A valid seat token is required.');
    return hash(token);
  }
  private room(db: Database, id: string): Room {
    const room = db.rooms.find(r => r.id === id);
    requireThat(room, 404, 'game.not_found', 'Operation not found.');
    return room;
  }
  private seat(room: Room, token: string): Faction {
    const seat = room.seats.find(s => s.hash === this.credential(token));
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
  private identify(room: Room, faction: Faction, kind: 'hauler' | 'message' | 'unit', id: number | string): number {
    const seat = room.seats.find(s => s.faction === faction)!;
    const key = seat.identityHash ?? seat.hash;
    return createHmac('sha256', key).update(`${kind}:${id}`).digest().readUIntBE(0, 6);
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
      visibility: 'sensors.v1', game: observe(room.game, faction, id => this.identify(room, faction, 'hauler', id), id => String(this.identify(room, faction, 'unit', id))), messages: room.messages.filter(m => m.from === faction || m.to === faction).map(m => ({ ...m, id: this.identify(room, faction, 'message', m.id) })), serverTime: this.now() };
  }
  create(token: string, options?: unknown): Promise<Snapshot> {
    let requested: GameOptions | undefined;
    try { requested = options === undefined ? undefined : validateOptions(options); }
    catch (e) { return Promise.reject(new Failure(400, 'game.validation.options', (e as Error).message)); }
    return this.transaction(db => {
      const credential = this.credential(token);
      const existing = db.rooms.find(r => r.seats.some(s => s.hash === credential));
      if (existing) {
        requireThat(!requested || requested.playerCount === playersIn(existing.game).length && requested.mode === (existing.game.rules?.mode ?? 'mining'), 409, 'game.conflict.options', 'This credential already belongs to an operation with different settings.');
        this.settle(existing); return this.view(existing, this.seat(existing, token));
      }
      requireThat(db.rooms.length < 1000, 503, 'game.capacity.reached', 'This server has reached its operation limit.');
      const room: Room = { id: randomBytes(12).toString('hex'), invite: randomBytes(12).toString('hex'), startedAt: null,
        revision: 0, game: this.initialGame && !requested ? this.initialGame(this.now(), Object.fromEntries(FACTIONS.map(f => [f, randomBytes(4).readUInt32BE()]))) : createConfiguredGame(requested ?? DEFAULT_GAME_OPTIONS, this.now(), randomBytes(4).readUInt32BE(), Object.fromEntries(FACTIONS.map(f => [f, randomBytes(4).readUInt32BE()]))), seats: [{ faction: 'you', hash: credential }], messages: [], receipts: {} };
      db.rooms.push(room);
      return this.view(room, 'you');
    });
  }
  join(invite: string, token: string): Promise<Snapshot> {
    return this.transaction(db => {
      const credential = this.credential(token);
      const room = db.rooms.find(r => r.invite === invite);
      requireThat(room, 404, 'game.not_found.invite', 'Invitation not found.');
      const existing = room.seats.find(s => s.hash === credential);
      if (existing) { this.settle(room); return this.view(room, existing.faction); }
      requireThat(!db.rooms.some(r => r.seats.some(s => s.hash === credential)), 409, 'seat.conflict.assigned', 'This token already belongs to another operation.');
      requireThat(room.startedAt === null && room.seats.length < playersIn(room.game).length, 409, 'game.conflict.closed', 'This operation is no longer accepting players.');
      const faction = playersIn(room.game)[room.seats.length]!;
      room.seats.push({ faction, hash: credential }); room.revision++;
      return this.view(room, faction);
    });
  }
  setRecovery(id: string, token: string, command: RecoverySetup): Promise<Snapshot> {
    return this.transaction(db => {
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
  recover(id: string, token: string, command: RecoverSeat): Promise<Snapshot> {
    return this.transaction(db => {
      const credential = this.credential(token);
      requireThat(typeof command.secret === 'string' && /^[a-f0-9]{64}$/.test(command.secret), 401, 'recovery.unauthorized.code', 'Recovery code is invalid, replaced, or already used.');
      const secretHash = hash(command.secret); const room = db.rooms.find(r => r.id === id);
      const seat = room?.seats.find(s => matchesHash(s.recoveryHash, secretHash) || matchesHash(s.recoveryReceipt?.secretHash, secretHash) && s.recoveryReceipt?.credentialHash === credential && s.hash === credential);
      requireThat(room && seat, 401, 'recovery.unauthorized.code', 'Recovery code is invalid, replaced, or already used.');
      if (seat.recoveryReceipt?.secretHash === secretHash && seat.hash === credential) { this.settle(room); return this.view(room, seat.faction); }
      requireThat(credential !== seat.hash && !db.rooms.some(r => r.seats.some(s => s.hash === credential)), 409, 'recovery.conflict.credential', 'Restore with a fresh connection credential.');
      seat.identityHash ??= seat.hash;
      seat.hash = credential; delete seat.recoveryHash;
      seat.recoveryReceipt = { secretHash, credentialHash: credential };
      this.settle(room); return this.view(room, seat.faction);
    });
  }
  snapshot(id: string, token: string): Promise<Snapshot> {
    return this.transaction(db => { const r = this.room(db, id); const f = this.seat(r, token); this.settle(r); return this.view(r, f); });
  }
  history(id: string, token: string, hour: number): Promise<HistorySnapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      requireThat(r.replay, 409, 'history.conflict.lobby', 'History begins when the operation starts.');
      requireThat(Number.isFinite(hour) && hour >= r.replay.baseline.hour && hour <= r.game.hour, 400, 'history.validation.hour', 'Choose a time within the available operation history.');
      const game = replayTo(restoreArchive(r.replay), hour, { rivals: false, knownThrough: r.game.hour });
      return { id: r.id, faction: f, visibility: 'sensors.v1', history: { from: r.replay.baseline.hour, through: r.game.hour, at: hour },
        game: observe(game, f, id => this.identify(r, f, 'hauler', id), id => String(this.identify(r, f, 'unit', id))) };
    });
  }
  activity(id: string, token: string): Promise<Snapshot> {
    return this.transaction(db => { const r = this.room(db, id); const f = this.seat(r, token); this.settle(r); this.touch(r, f); return this.view(r, f); });
  }
  resign(id: string, token: string, command: ResignOrder): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      if (this.receipt(r, f, command.requestId, JSON.stringify(['resign', command.revision]))) return this.view(r, f);
      requireThat(r.startedAt !== null, 409, 'game.conflict.lobby', 'The operation has not started.');
      requireThat(Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f), 409, 'resign.conflict.stale', 'Your orders changed. Refresh before resigning.');
      try { this.act(r, { type: 'resign', owner: f }); }
      catch (e) { throw new Failure(409, 'resign.conflict.invalid', (e as Error).message); }
      r.revision++; r.seats.find(s => s.faction === f)!.revision = this.revision(r, f) + 1;
      return this.view(r, f);
    });
  }
  start(id: string, token: string): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token);
      requireThat(f === 'you', 403, 'game.forbidden.host', 'Only the host can start the operation.');
      requireThat(r.seats.length === playersIn(r.game).length, 409, 'game.conflict.seats', `Wait for all ${playersIn(r.game).length} intelligences to join.`);
      if (r.startedAt === null) { r.startedAt = this.now(); r.game.epoch = r.startedAt; if (r.game.version === 2) for (const seat of r.seats) seat.lastActiveHour = r.game.hour; r.revision++; r.seats.find(s => s.faction === f)!.revision = this.revision(r, f) + 1; }
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
  specialist(id: string, token: string, command: SpecialistOrder): Promise<Snapshot> {
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
      r.revision++; r.seats.find(s => s.faction === f)!.revision = this.revision(r, f) + 1;
      return this.view(r, f);
    });
  }
  order(id: string, token: string, order: Order): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      if (this.receipt(r, f, order.requestId, JSON.stringify(['order', order.from, order.to, order.drones, order.revision, ...(order.carryModule === undefined || order.carryModule === false ? [] : [order.carryModule]), ...(order.specialists?.length ? [order.specialists] : [])]))) return this.view(r, f);
      requireThat(r.startedAt !== null, 409, 'game.conflict.lobby', 'The operation has not started.');
      requireThat(Number.isSafeInteger(order.revision) && order.revision === this.revision(r, f), 409, 'order.conflict.stale', 'The operation changed. Refresh before issuing this order.');
      try { this.act(r, { type: 'dispatch', owner: f, from: order.from, to: order.to, drones: order.drones, carryModule: order.carryModule, specialists: this.manifest(r, f, order.from, order.specialists) }); }
      catch (e) { throw new Failure(409, 'order.conflict.invalid', (e as Error).message); }
      r.revision++;
      r.seats.find(s => s.faction === f)!.revision = this.revision(r, f) + 1;
      return this.view(r, f);
    });
  }
  gift(id: string, token: string, command: GiftOrder): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      if (this.receipt(r, f, command.requestId, JSON.stringify(['gift', command.from, command.to, command.drones, command.recipient, command.revision, command.carryModule ?? false, ...(command.specialists?.length ? [command.specialists] : [])]))) return this.view(r, f);
      requireThat(r.startedAt !== null, 409, 'game.conflict.lobby', 'The operation has not started.');
      requireThat(Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f), 409, 'gift.conflict.stale', 'Your orders changed. Refresh before gifting.');
      try { this.act(r, { type: 'gift', owner: f, from: command.from, to: command.to, drones: command.drones, recipient: command.recipient, carryModule: command.carryModule, specialists: this.manifest(r, f, command.from, command.specialists) }); }
      catch (e) { throw new Failure(409, 'gift.conflict.invalid', (e as Error).message); }
      r.revision++;
      for (const seat of r.seats) if (seat.faction === f || r.game.version === 1 && seat.faction === command.recipient) seat.revision = this.revision(r, seat.faction) + 1;
      return this.view(r, f);
    });
  }
  install(id: string, token: string, command: ModuleOrder): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      if (this.receipt(r, f, command.requestId, JSON.stringify(['module', command.rock, command.module, command.revision]))) return this.view(r, f);
      requireThat(r.startedAt !== null, 409, 'game.conflict.lobby', 'The operation has not started.');
      requireThat(Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f), 409, 'module.conflict.stale', 'The operation changed. Refresh before building a module.');
      try { this.act(r, { type: 'install-module', owner: f, rock: command.rock, kind: command.module }); }
      catch (e) { throw new Failure(409, 'module.conflict.invalid', (e as Error).message); }
      r.revision++;
      r.seats.find(s => s.faction === f)!.revision = this.revision(r, f) + 1;
      return this.view(r, f);
    });
  }
  hauler(id: string, token: string, command: HaulerOrder): Promise<Snapshot> {
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
      r.revision++; r.seats.find(s => s.faction === f)!.revision = this.revision(r, f) + 1;
      return this.view(r, f);
    });
  }
  site(id: string, token: string, command: SiteOrder): Promise<Snapshot> {
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
      r.revision++;
      r.seats.find(s => s.faction === f)!.revision = this.revision(r, f) + 1;
      return this.view(r, f);
    });
  }
  intercept(id: string, token: string, command: InterceptOrder): Promise<Snapshot> {
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
      r.revision++;
      r.seats.find(s => s.faction === f)!.revision = this.revision(r, f) + 1;
      return this.view(r, f);
    });
  }
  async schedule(id: string, token: string, input: ScheduleOrder): Promise<Snapshot> {
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
          action: mapActionUnits(command.action, unit => this.futureUnit(r, f, unit)),
        } });
        else this.act(r, { type: 'schedule', owner: f, plan: { id: command.requestId, from: command.from, to: command.to, drones: command.drones, executeAt: command.executeAt, carryModule: command.carryModule,
          specialists: command.specialists?.map(unit => this.futureUnit(r, f, unit, true)) ?? [] } });
      }
      catch (e) { throw new Failure(409, 'schedule.conflict.invalid', (e as Error).message); }
      r.revision++;
      r.seats.find(s => s.faction === f)!.revision = this.revision(r, f) + 1;
      return this.view(r, f);
    });
  }
  cancelSchedule(id: string, token: string, command: CancelSchedule): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      if (this.receipt(r, f, command.requestId, JSON.stringify(['cancel-schedule', command.planId, command.revision]))) return this.view(r, f);
      requireThat(Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f), 409, 'schedule.conflict.stale', 'Your orders changed. Refresh before canceling.');
      try { this.act(r, { type: 'cancel-schedule', owner: f, id: command.planId }); }
      catch (e) { throw new Failure(409, 'schedule.conflict.missing', (e as Error).message); }
      r.revision++;
      r.seats.find(s => s.faction === f)!.revision = this.revision(r, f) + 1;
      return this.view(r, f);
    });
  }
  funding(id: string, token: string, command: FundingOrder): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      if (this.receipt(r, f, command.requestId, JSON.stringify(['funding', command.recipient, command.enabled, command.revision]))) return this.view(r, f);
      requireThat(r.startedAt !== null, 409, 'game.conflict.lobby', 'The operation has not started.');
      requireThat(Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f), 409, 'funding.conflict.stale', 'Your orders changed. Refresh before changing funding.');
      requireThat(r.seats.some(s => s.faction === command.recipient), 400, 'funding.validation.recipient', 'Choose a joined intelligence.');
      try { this.act(r, { type: 'funding', owner: f, to: command.recipient, enabled: command.enabled }); }
      catch (e) { throw new Failure(409, 'funding.conflict.invalid', (e as Error).message); }
      r.revision++; r.seats.find(s => s.faction === f)!.revision = this.revision(r, f) + 1;
      return this.view(r, f);
    });
  }
  createGroup(id: string, token: string, command: CreateGroup): Promise<Snapshot> {
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
  channelMessage(id: string, token: string, command: ChannelTransmission): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      const d = r.diplomacy ??= { groups: [], publicMessages: [] };
      const group = d.groups.find(g => g.id === command.channelId && g.members.includes(f));
      requireThat(command.channelId === 'public' || group, 404, 'channel.not_found', 'Channel not found.');
      requireThat(typeof command.text === 'string' && command.text.trim().length > 0 && command.text.length <= DIPLOMACY_LIMITS.text,
        400, 'message.validation.text', 'Transmissions must contain 1 to 1,000 characters.');
      if (this.receipt(r, f, command.requestId, JSON.stringify(['channel-message', command.channelId, command.text]))) return this.view(r, f);
      const messages = group ? group.messages : d.publicMessages;
      messages.push({ id: randomBytes(16).toString('hex'), from: f, text: command.text.trim(), sentAt: this.now() });
      messages.splice(0, Math.max(0, messages.length - DIPLOMACY_LIMITS.messagesPerChannel));
      this.touch(r, f);
      return this.view(r, f);
    });
  }
  message(id: string, token: string, command: Transmission): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      requireThat(FACTIONS.includes(command.to) && command.to !== f && r.seats.some(s => s.faction === command.to), 400, 'message.validation.recipient', 'Choose another intelligence in this operation.');
      requireThat(typeof command.text === 'string' && command.text.trim().length > 0 && command.text.length <= 1000, 400, 'message.validation.text', 'Transmissions must contain 1 to 1,000 characters.');
      if (this.receipt(r, f, command.requestId, JSON.stringify(['message', command.to, command.text]))) return this.view(r, f);
      requireThat(r.messages.length < 5000, 409, 'message.capacity.reached', 'This operation has reached its transmission limit.');
      r.messages.push({ id: r.messages.length + 1, from: f, to: command.to, text: command.text.trim(), sentAt: this.now() });
      this.touch(r, f);
      return this.view(r, f);
    });
  }
}
