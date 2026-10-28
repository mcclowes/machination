/**
 * ---
 * purpose: Serialize multiplayer transactions, persist snapshots, authorize seats, and settle server time.
 * ---
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { advance, createGame, dispatch, installModule, type Faction, type Game } from '../src/game/simulation';
import { dispatchIntercept } from '../src/game/interception';
import { scheduleTransfer, cancelTransfer } from '../src/game/orders';
import { observe } from '../src/game/visibility';
import { decodeSave } from '../src/game/save-format';
import type { CancelSchedule, RecoverSeat, RecoverySetup, InterceptOrder, Message, ModuleOrder, Order, ScheduleOrder, Snapshot, Transmission } from '../src/online/protocol';
const FACTIONS: Faction[] = ['you', 'vesper', 'null'];
type Room = {
  id: string; invite: string; startedAt: number | null; revision: number; game: Game;
  seats: { faction: Faction; hash: string; revision?: number; identityHash?: string; recoveryHash?: string; recoveryReceipt?: { secretHash: string; credentialHash: string } }[]; messages: Message[];
  receipts: Record<string, string>;
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
export class GameService {
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(private file: string, private database: Database, private now: () => number) {}
  static async open(file: string, now = Date.now): Promise<GameService> {
    let database: Database = { version: 1, rooms: [] };
    try {
      database = JSON.parse(await readFile(file, 'utf8'));
      if (database.version !== 1 || !Array.isArray(database.rooms)) throw new Error('Unsupported server database.');
      const ids = new Set<string>();
      for (const r of database.rooms) {
        decodeSave(JSON.stringify({ savedAt: 0, game: r.game }));
        if (!/^[a-f0-9]{24}$/.test(r.id) || ids.has(r.id) || !/^[a-f0-9]{24}$/.test(r.invite)
          || !(r.startedAt === null || Number.isFinite(r.startedAt) && r.startedAt >= 0)
          || !Number.isSafeInteger(r.revision) || r.revision < 0 || !Array.isArray(r.seats) || r.seats.length < 1 || r.seats.length > 3
          || !r.seats.every(s => FACTIONS.includes(s.faction) && /^[a-f0-9]{64}$/.test(s.hash))
          || new Set(r.seats.map(s => s.faction)).size !== r.seats.length || r.seats[0]?.faction !== 'you'
          || !Array.isArray(r.messages) || !r.receipts || typeof r.receipts !== 'object' || Array.isArray(r.receipts)
          || !r.messages.every(m => Number.isSafeInteger(m.id) && FACTIONS.includes(m.from) && FACTIONS.includes(m.to) && typeof m.text === 'string' && Number.isFinite(m.sentAt))) throw new Error('Damaged server database.');
        for (const seat of r.seats) {
          if (seat.identityHash !== undefined && !isHash(seat.identityHash)
            || seat.recoveryHash !== undefined && !isHash(seat.recoveryHash)
            || seat.recoveryReceipt !== undefined && (!seat.recoveryReceipt || !isHash(seat.recoveryReceipt.secretHash) || seat.recoveryReceipt.credentialHash !== seat.hash)) throw new Error('Damaged recovery metadata.');
          seat.revision ??= 0;
          if (!Number.isSafeInteger(seat.revision) || seat.revision < 0) throw new Error('Damaged seat revision.');
        }
        ids.add(r.id);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return new GameService(file, database, now);
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
    if (room.startedAt !== null) room.game = advance(room.game, Math.max(room.game.hour, (this.now() - room.startedAt) / 3_600_000), { rivals: false });
  }
  private revision(room: Room, faction: Faction): number { return room.seats.find(s => s.faction === faction)!.revision ?? 0; }
  private identify(room: Room, faction: Faction, kind: 'hauler' | 'message', id: number): number {
    const seat = room.seats.find(s => s.faction === faction)!;
    const key = seat.identityHash ?? seat.hash;
    return createHmac('sha256', key).update(`${kind}:${id}`).digest().readUIntBE(0, 6);
  }
  private view(room: Room, faction: Faction): Snapshot {
    return { id: room.id, invite: room.invite, status: room.startedAt === null ? 'game.lobby' : room.game.winner ? 'game.finished' : 'game.active',
      faction, host: faction === 'you', members: room.seats.map(s => s.faction), revision: this.revision(room, faction),
      recoveryEnabled: !!room.seats.find(s => s.faction === faction)!.recoveryHash,
      visibility: 'sensors.v1', game: observe(room.game, faction, id => this.identify(room, faction, 'hauler', id)), messages: room.messages.filter(m => m.from === faction || m.to === faction).map(m => ({ ...m, id: this.identify(room, faction, 'message', m.id) })), serverTime: this.now() };
  }
  create(token: string): Promise<Snapshot> {
    return this.transaction(db => {
      const credential = this.credential(token);
      const existing = db.rooms.find(r => r.seats.some(s => s.hash === credential));
      if (existing) { this.settle(existing); return this.view(existing, this.seat(existing, token)); }
      requireThat(db.rooms.length < 1000, 503, 'game.capacity.reached', 'This server has reached its operation limit.');
      const room: Room = { id: randomBytes(12).toString('hex'), invite: randomBytes(12).toString('hex'), startedAt: null,
        revision: 0, game: createGame(this.now()), seats: [{ faction: 'you', hash: credential }], messages: [], receipts: {} };
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
      requireThat(room.startedAt === null && room.seats.length < 3, 409, 'game.conflict.closed', 'This operation is no longer accepting players.');
      const faction = FACTIONS[room.seats.length]!;
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
  start(id: string, token: string): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token);
      requireThat(f === 'you', 403, 'game.forbidden.host', 'Only the host can start the operation.');
      requireThat(r.seats.length === 3, 409, 'game.conflict.seats', 'Wait for all three intelligences to join.');
      if (r.startedAt === null) { r.startedAt = this.now(); r.game.epoch = r.startedAt; r.revision++; r.seats.find(s => s.faction === f)!.revision = this.revision(r, f) + 1; }
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
  order(id: string, token: string, order: Order): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      if (this.receipt(r, f, order.requestId, JSON.stringify(['order', order.from, order.to, order.drones, order.revision, ...(order.carryModule === undefined || order.carryModule === false ? [] : [order.carryModule])]))) return this.view(r, f);
      requireThat(r.startedAt !== null, 409, 'game.conflict.lobby', 'The operation has not started.');
      requireThat(Number.isSafeInteger(order.revision) && order.revision === this.revision(r, f), 409, 'order.conflict.stale', 'The operation changed. Refresh before issuing this order.');
      try { r.game = dispatch(r.game, order.from, order.to, order.drones, f, order.carryModule); }
      catch (e) { throw new Failure(409, 'order.conflict.invalid', (e as Error).message); }
      r.revision++;
      r.seats.find(s => s.faction === f)!.revision = this.revision(r, f) + 1;
      return this.view(r, f);
    });
  }
  install(id: string, token: string, command: ModuleOrder): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      if (this.receipt(r, f, command.requestId, JSON.stringify(['module', command.rock, command.module, command.revision]))) return this.view(r, f);
      requireThat(r.startedAt !== null, 409, 'game.conflict.lobby', 'The operation has not started.');
      requireThat(Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f), 409, 'module.conflict.stale', 'The operation changed. Refresh before building a module.');
      try { r.game = installModule(r.game, command.rock, command.module, f); }
      catch (e) { throw new Failure(409, 'module.conflict.invalid', (e as Error).message); }
      r.revision++;
      r.seats.find(s => s.faction === f)!.revision = this.revision(r, f) + 1;
      return this.view(r, f);
    });
  }
  intercept(id: string, token: string, command: InterceptOrder): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      if (this.receipt(r, f, command.requestId, JSON.stringify(['intercept', command.from, command.target, command.drones, command.revision]))) return this.view(r, f);
      requireThat(r.startedAt !== null, 409, 'game.conflict.lobby', 'The operation has not started.');
      requireThat(Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f), 409, 'interception.conflict.stale', 'Your orders changed. Refresh before intercepting.');
      const visible = observe(r.game, f, fleetId => this.identify(r, f, 'hauler', fleetId));
      const contact = visible.fleets.find(fleet => fleet.id === command.target && fleet.owner !== f);
      requireThat(contact, 409, 'interception.conflict.target', 'Target is not an observed enemy hauler.');
      const target = r.game.fleets.find(fleet => this.identify(r, f, 'hauler', fleet.id) === contact.id)!;
      try { r.game = dispatchIntercept(r.game, command.from, target.id, command.drones, f); }
      catch (e) { throw new Failure(409, 'interception.conflict.invalid', (e as Error).message); }
      r.revision++;
      r.seats.find(s => s.faction === f)!.revision = this.revision(r, f) + 1;
      return this.view(r, f);
    });
  }
  schedule(id: string, token: string, command: ScheduleOrder): Promise<Snapshot> {
    return this.transaction(db => {
      const r = this.room(db, id); const f = this.seat(r, token); this.settle(r);
      const payload = JSON.stringify(['schedule', command.from, command.to, command.drones, command.revision, command.executeAt, command.carryModule ?? false]);
      if (this.receipt(r, f, command.requestId, payload)) return this.view(r, f);
      requireThat(r.startedAt !== null, 409, 'game.conflict.lobby', 'The operation has not started.');
      requireThat(Number.isSafeInteger(command.revision) && command.revision === this.revision(r, f), 409, 'schedule.conflict.stale', 'Your orders changed. Refresh before scheduling.');
      try { r.game = scheduleTransfer(r.game, { id: command.requestId, owner: f, from: command.from, to: command.to, drones: command.drones, executeAt: command.executeAt, carryModule: command.carryModule }); }
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
      try { r.game = cancelTransfer(r.game, command.planId, f); }
      catch (e) { throw new Failure(409, 'schedule.conflict.missing', (e as Error).message); }
      r.revision++;
      r.seats.find(s => s.faction === f)!.revision = this.revision(r, f) + 1;
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
      return this.view(r, f);
    });
  }
}
