/**
 * ---
 * purpose: Validate stored room rules, seats, diplomacy, recovery metadata, and replay history.
 * related:
 *   - ./database.ts - durable room shape and startup validation
 * ---
 *
 * @format
 */
import { ALL_PLAYERS, playersIn } from '../src/game/players';
import { exportArchive } from '../src/game/replay';
import { decodeReplay } from '../src/game/replay-save';
import { decodeSave } from '../src/game/save-format';
import { DIPLOMACY_LIMITS, type ChannelMessage } from '../src/contracts/protocol';
import type { Room } from './database';

const isHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Validates and fills compatibility defaults, without changing the accepted identity set. */
export function validateStoredRoom(r: Room, ids: ReadonlySet<string>): void {
  r.game = decodeSave(JSON.stringify({ savedAt: 0, game: r.game })).game;
  if (
    !/^[a-f0-9]{24}$/.test(r.id) ||
    ids.has(r.id) ||
    !/^[a-f0-9]{24}$/.test(r.invite) ||
    !(r.startedAt === null || (Number.isFinite(r.startedAt) && r.startedAt >= 0)) ||
    !Number.isSafeInteger(r.revision) ||
    r.revision < 0 ||
    !Array.isArray(r.seats) ||
    r.seats.length < 1 ||
    r.seats.length > playersIn(r.game).length ||
    (r.startedAt !== null && r.seats.length !== playersIn(r.game).length) ||
    !r.seats.every((s) => playersIn(r.game).includes(s.faction) && /^[a-f0-9]{64}$/.test(s.hash)) ||
    new Set(r.seats.map((s) => s.faction)).size !== r.seats.length ||
    r.seats[0]?.faction !== 'you' ||
    !Array.isArray(r.messages) ||
    !r.receipts ||
    typeof r.receipts !== 'object' ||
    Array.isArray(r.receipts) ||
    !r.messages.every(
      (m) =>
        Number.isSafeInteger(m.id) &&
        playersIn(r.game).includes(m.from) &&
        playersIn(r.game).includes(m.to) &&
        typeof m.text === 'string' &&
        Number.isFinite(m.sentAt),
    )
  )
    throw new Error('Damaged server database.');
  if (r.referenceKey !== undefined && !isHash(r.referenceKey))
    throw new Error('Damaged object reference key.');
  for (const seat of r.seats) {
    if (
      seat.accountId !== undefined &&
      (typeof seat.accountId !== 'string' || !/^user_[a-zA-Z0-9]+$/.test(seat.accountId))
    )
      throw new Error('Damaged account identity.');
    if (
      (seat.lastActiveHour !== undefined &&
        (r.startedAt === null ||
          r.game.version !== 2 ||
          !Number.isFinite(seat.lastActiveHour) ||
          seat.lastActiveHour < 0 ||
          seat.lastActiveHour > r.game.hour)) ||
      (seat.identityHash !== undefined && !isHash(seat.identityHash)) ||
      (seat.recoveryHash !== undefined && !isHash(seat.recoveryHash)) ||
      (seat.recoveryReceipt !== undefined &&
        (!seat.recoveryReceipt ||
          !isHash(seat.recoveryReceipt.secretHash) ||
          seat.recoveryReceipt.credentialHash !== seat.hash))
    )
      throw new Error('Damaged recovery metadata.');
    seat.revision ??= 0;
    if (!Number.isSafeInteger(seat.revision) || seat.revision < 0)
      throw new Error('Damaged seat revision.');
  }
  r.diplomacy ??= { groups: [], publicMessages: [] };
  const d = r.diplomacy;
  const validMessages = (messages: ChannelMessage[]) =>
    Array.isArray(messages) &&
    messages.length <= DIPLOMACY_LIMITS.messagesPerChannel &&
    messages.every(
      (m) =>
        m &&
        typeof m.id === 'string' &&
        /^[a-f0-9]{32}$/.test(m.id) &&
        r.seats.some((s) => s.faction === m.from) &&
        typeof m.text === 'string' &&
        m.text.trim().length > 0 &&
        m.text.length <= DIPLOMACY_LIMITS.text &&
        Number.isFinite(m.sentAt),
    ) &&
    new Set(messages.map((m) => m.id)).size === messages.length;
  if (
    !d ||
    !Array.isArray(d.groups) ||
    d.groups.length > ALL_PLAYERS.length * DIPLOMACY_LIMITS.groupsPerParticipant ||
    !validMessages(d.publicMessages) ||
    !d.groups.every(
      (g) =>
        g &&
        typeof g.id === 'string' &&
        /^[a-f0-9]{32}$/.test(g.id) &&
        typeof g.name === 'string' &&
        g.name.trim().length > 0 &&
        g.name.length <= DIPLOMACY_LIMITS.name &&
        Array.isArray(g.members) &&
        g.members.length >= 2 &&
        g.members.length <= r.seats.length &&
        new Set(g.members).size === g.members.length &&
        g.members.every((f) => r.seats.some((s) => s.faction === f)) &&
        g.members.includes(g.createdBy) &&
        Number.isFinite(g.createdAt) &&
        validMessages(g.messages) &&
        g.messages.every((m) => g.members.includes(m.from)),
    ) ||
    new Set(d.groups.map((g) => g.id)).size !== d.groups.length ||
    r.seats.some(
      (s) =>
        d.groups.filter((g) => g.members.includes(s.faction)).length >
        DIPLOMACY_LIMITS.groupsPerParticipant,
    )
  )
    throw new Error('Damaged diplomacy metadata.');
  if (r.replay !== undefined) {
    if (r.startedAt === null) throw new Error('A lobby cannot contain operation history.');
    r.replay = exportArchive(decodeReplay(r.replay, r.game, false));
  }
}
