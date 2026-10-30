/**
 * ---
 * purpose: Retain safe identifiers for quarantined operations and refuse retries without revoking credentials.
 * related:
 *   - ./database.ts - durable quarantine markers
 *   - ./service.ts - authoritative lookup and creation gates
 * ---
 *
 * @format
 */
import type { Database } from './database';
import { ALL_PLAYERS } from '../src/game/players';
import { credentialHash, type Credential } from './seat-credentials';
import { Failure } from './failure';

export type QuarantinedOperation = {
  id?: string;
  invite?: string;
  accounts: string[];
  hashes: string[];
  uncertain: boolean;
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{24}$/.test(value);
const hash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const account = (value: unknown): value is string =>
  typeof value === 'string' && /^user_[a-zA-Z0-9]+$/.test(value);
const SEAT_HASH_FIELDS = ['hash', 'identityHash', 'recoveryHash', 'profileId'] as const;
const RECEIPT_HASH_FIELDS = ['secretHash', 'credentialHash'] as const;
const MAX_ROOM_IDENTITY_HASHES =
  ALL_PLAYERS.length * (SEAT_HASH_FIELDS.length + RECEIPT_HASH_FIELDS.length);

export function quarantineIdentity(raw: unknown): QuarantinedOperation {
  const room = record(raw) ? raw : {};
  const seats = Array.isArray(room.seats) ? room.seats : [];
  const accounts = new Set<string>(),
    hashes = new Set<string>();
  let uncertain =
    !identifier(room.id) ||
    !identifier(room.invite) ||
    !seats.length ||
    seats.length > ALL_PLAYERS.length;
  for (const rawSeat of seats.slice(0, ALL_PLAYERS.length)) {
    if (!record(rawSeat)) {
      uncertain = true;
      continue;
    }
    if (!hash(rawSeat.hash) || (rawSeat.accountId !== undefined && !account(rawSeat.accountId)))
      uncertain = true;
    if (account(rawSeat.accountId)) accounts.add(rawSeat.accountId);
    const receipt = record(rawSeat.recoveryReceipt) ? rawSeat.recoveryReceipt : {};
    for (const value of [
      ...SEAT_HASH_FIELDS.map((key) => rawSeat[key]),
      ...RECEIPT_HASH_FIELDS.map((key) => receipt[key]),
    ])
      if (hash(value)) hashes.add(value);
  }
  return {
    ...(identifier(room.id) ? { id: room.id } : {}),
    ...(identifier(room.invite) ? { invite: room.invite } : {}),
    accounts: [...accounts],
    hashes: [...hashes],
    uncertain,
  };
}

export function validateQuarantine(database: Database): void {
  const entries = database.quarantined;
  if (entries === undefined) return;
  if (
    !Array.isArray(entries) ||
    !entries.every(
      (entry) =>
        entry &&
        typeof entry.uncertain === 'boolean' &&
        (entry.id === undefined || identifier(entry.id)) &&
        (entry.invite === undefined || identifier(entry.invite)) &&
        Array.isArray(entry.accounts) &&
        entry.accounts.length <= ALL_PLAYERS.length &&
        entry.accounts.every(account) &&
        Array.isArray(entry.hashes) &&
        entry.hashes.length <= MAX_ROOM_IDENTITY_HASHES &&
        entry.hashes.every(hash) &&
        new Set(entry.accounts).size === entry.accounts.length &&
        new Set(entry.hashes).size === entry.hashes.length &&
        (entry.uncertain ||
          (identifier(entry.id) && identifier(entry.invite) && entry.hashes.length > 0)) &&
        !database.rooms.some((room) => room?.id === entry.id),
    )
  )
    throw new Error('Damaged quarantine metadata.');
}

export function assertOperationAvailable(
  database: Database,
  request: { id?: string; invite?: string; credential?: Credential; profileId?: string },
): void {
  const credential =
    request.credential === undefined ? undefined : credentialHash(request.credential);
  const accountId =
    typeof request.credential === 'object' ? request.credential.accountId : undefined;
  if (
    database.quarantined?.some(
      (entry) =>
        entry.uncertain ||
        (request.id !== undefined && entry.id === request.id) ||
        (request.invite !== undefined && entry.invite === request.invite) ||
        (accountId !== undefined && entry.accounts.includes(accountId)) ||
        (credential !== undefined && entry.hashes.includes(credential)) ||
        (request.profileId !== undefined && entry.hashes.includes(request.profileId)),
    )
  ) {
    throw new Failure(
      503,
      'game.unavailable.recovery',
      'This operation is temporarily unavailable. Keep your connection and try again later.',
    );
  }
}
