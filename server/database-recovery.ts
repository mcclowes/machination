/**
 * ---
 * purpose: Plan startup recovery without writing or exposing partially validated operations.
 * related:
 *   - ./database.ts - persistence activation and serialized transactions
 *   - ./operation-quarantine.ts - retained unavailable identities
 * ---
 *
 * @format
 */
import type { Database, DatabaseRecoveryMode, Room } from './database';
import { validateStoredRoom } from './room-validation';
import { quarantineIdentity, validateQuarantine } from './operation-quarantine';
import { validateNotifications, filterRoomNotifications } from './notification-state';
import { finished, validateFactions, validateFactionMembership } from './factions';
import { TextDecoder } from 'node:util';
import { archiveReportState, protectReportState, reportMemberSource } from './report-source';

export function databaseRecoveryMode(value: string | undefined): DatabaseRecoveryMode {
  if (value === undefined) return 'quarantine';
  if (value === 'strict' || value === 'quarantine') return value;
  throw new Error('MACHINATION_DATABASE_RECOVERY must be strict or quarantine.');
}

export function parseStoredDatabase(source: string): unknown {
  try {
    const stored: unknown = JSON.parse(source);
    const reportSource = reportMemberSource(source);
    if (
      reportSource !== undefined &&
      stored &&
      typeof stored === 'object' &&
      !Array.isArray(stored)
    ) {
      const database = stored as Record<string, unknown>;
      database.messageReports = archiveReportState(database.messageReports, reportSource);
    }
    return stored;
  } catch {
    throw new Error('Damaged server database JSON.');
  }
}

export function decodeDatabaseSource(source: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source);
  } catch {
    throw new Error('Damaged server database encoding.');
  }
}

type Candidate = { room: Room; index: number; damaged: boolean };

function ambiguousRoomIndices(candidates: readonly Candidate[]): Set<number> {
  const references = new Map<string, number[]>();
  for (const { index, room, damaged } of candidates) {
    const identity = quarantineIdentity(room);
    const accounts = damaged
      ? identity.accounts
      : finished(room)
        ? []
        : room.seats.flatMap((seat) => (seat.accountId ? [seat.accountId] : []));
    const keys = [
      ...(identity.id ? [`id:${identity.id}`] : []),
      ...(identity.invite ? [`invite:${identity.invite}`] : []),
      ...accounts.map((account) => `account:${account}`),
    ];
    for (const key of keys) references.set(key, [...(references.get(key) ?? []), index]);
  }
  return new Set([...references.values()].filter((indices) => indices.length > 1).flat());
}

export function recoverStoredDatabase(
  stored: unknown,
  mode: DatabaseRecoveryMode = 'strict',
): { database: Database; rejected: number[] } {
  const database = structuredClone(
    stored === undefined ? { version: 1, rooms: [] } : protectReportState(stored),
  ) as Database;
  const rejected: number[] = [];
  if (stored !== undefined) {
    if (
      !database ||
      typeof database !== 'object' ||
      Array.isArray(database) ||
      database.version !== 1 ||
      !Array.isArray(database.rooms)
    )
      throw new Error('Unsupported server database.');
    validateQuarantine(database);
    validateFactions({ ...database, rooms: [] });
    const ids = new Set<string>();
    const candidates: Candidate[] = [];
    for (const [index, r] of database.rooms.entries()) {
      try {
        validateStoredRoom(r, ids);
        validateFactionMembership(r, database.factions);
        ids.add(r.id);
        candidates.push({ room: r, index, damaged: false });
      } catch (error) {
        if (mode !== 'quarantine') throw error;
        candidates.push({ room: r, index, damaged: true });
      }
    }
    const ambiguous = mode === 'quarantine' ? ambiguousRoomIndices(candidates) : new Set<number>();
    const accepted: Room[] = [];
    for (const candidate of candidates) {
      if (candidate.damaged || ambiguous.has(candidate.index)) rejected.push(candidate.index);
      else accepted.push(candidate.room);
    }
    database.rooms = accepted;
  }
  if (rejected.length) {
    database.quarantined = [
      ...(database.quarantined ?? []),
      ...rejected.map((index) => quarantineIdentity((stored as Database).rooms[index])),
    ];
    if (database.notifications !== undefined) {
      const quarantined = new Set(
        database.quarantined.flatMap((entry) => (entry.id ? [entry.id] : [])),
      );
      const healthy = new Set(database.rooms.map((room) => room.id));
      const retain = database.quarantined.some((entry) => entry.id === undefined)
        ? (id: string) => typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id) || healthy.has(id)
        : (id: string) => !quarantined.has(id);
      database.notifications = filterRoomNotifications(database.notifications, retain);
    }
  }
  validateQuarantine(database);
  validateNotifications(database);
  validateFactions(database);
  return { database, rejected };
}
