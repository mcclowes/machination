/**
 * ---
 * purpose: Own private seat message blocks, independent revisions, and bounded retry receipts.
 * related:
 *   - ./diplomacy.ts - delivery and private group creation
 *   - ./room-validation.ts - durable preference validation
 * ---
 * @format
 */
import { ALL_PLAYERS, type Faction } from '../src/game/players';
import {
  isSetMessageBlock,
  type MessageBlockSettings,
  type SetMessageBlock,
} from '../src/contracts/message-blocks';
import type { Database, Room } from './database';
import { requireThat } from './failure';

export const MESSAGE_BLOCK_REQUEST_LIMIT = 32;
export type StoredMessageBlocks = {
  revision: number;
  blocked: Faction[];
  requests: SetMessageBlock[];
};

export function isMessageBlocked(room: Room, recipient: Faction, sender: Faction): boolean {
  return (
    room.seats
      .find((seat) => seat.faction === recipient)
      ?.messageBlocks?.blocked.includes(sender) ?? false
  );
}

export function messageBlockView(room: Room, faction: Faction): MessageBlockSettings {
  const state = room.seats.find((seat) => seat.faction === faction)!.messageBlocks;
  return {
    gameId: room.id,
    faction,
    revision: state?.revision ?? 0,
    blocked: [...(state?.blocked ?? [])],
  };
}

export function validateStoredMessageBlocks(room: Room, faction: Faction, input: unknown): void {
  if (input === undefined) return;
  const state = input as StoredMessageBlocks | null;
  const joined = (player: Faction) =>
    player !== faction && room.seats.some((seat) => seat.faction === player);
  if (
    !state ||
    typeof state !== 'object' ||
    Array.isArray(state) ||
    Object.keys(state).length !== 3 ||
    Object.keys(state).some((key) => !['revision', 'blocked', 'requests'].includes(key)) ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    !Array.isArray(state.blocked) ||
    state.blocked.length >= room.seats.length ||
    !state.blocked.every(joined) ||
    new Set(state.blocked).size !== state.blocked.length ||
    (state.revision === 0 && state.blocked.length > 0) ||
    !Array.isArray(state.requests) ||
    state.requests.length !== Math.min(state.revision, MESSAGE_BLOCK_REQUEST_LIMIT) ||
    !state.requests.every(
      (request, index) =>
        isSetMessageBlock(request) &&
        joined(request.player) &&
        request.revision === state.revision - state.requests.length + index,
    ) ||
    new Set(state.requests.map((request) => request.requestId)).size !== state.requests.length
  )
    throw new Error('Damaged message blocking preferences.');
  for (const player of ALL_PLAYERS) {
    const last = state.requests.findLast((request) => request.player === player);
    if (last && last.blocked !== state.blocked.includes(player))
      throw new Error('Damaged message blocking preferences.');
  }
}

export function setMessageBlock(
  db: Database,
  room: Room,
  faction: Faction,
  input: unknown,
): MessageBlockSettings {
  requireThat(
    isSetMessageBlock(input),
    400,
    'message_block.validation.payload',
    'Provide a player, block choice, revision, and unique request ID.',
  );
  requireThat(
    input.player !== faction && room.seats.some((seat) => seat.faction === input.player),
    400,
    'message_block.validation.player',
    'Choose another joined player in this operation.',
  );
  const seat = room.seats.find((seat) => seat.faction === faction)!;
  const state = seat.messageBlocks ?? { revision: 0, blocked: [], requests: [] };
  const prior = state.requests.find((request) => request.requestId === input.requestId);
  requireThat(
    !prior ||
      (prior.player === input.player &&
        prior.blocked === input.blocked &&
        prior.revision === input.revision),
    409,
    'command.conflict.reused_id',
    'This command ID was used for different content.',
  );
  if (prior) return messageBlockView(room, faction);
  requireThat(
    input.revision === state.revision,
    409,
    'message_block.conflict.stale',
    'Message blocking changed. Refresh before changing it.',
  );
  requireThat(
    state.revision < Number.MAX_SAFE_INTEGER,
    409,
    'message_block.capacity.revision',
    'Message blocking cannot be changed for this operation. Contact support.',
  );
  const newlyBlocked = input.blocked && !state.blocked.includes(input.player);
  state.blocked = ALL_PLAYERS.filter((player) =>
    player === input.player ? input.blocked : state.blocked.includes(player),
  );
  state.revision++;
  state.requests = [...state.requests, { ...input }].slice(-MESSAGE_BLOCK_REQUEST_LIMIT);
  seat.messageBlocks = state;
  if (newlyBlocked && db.notifications) {
    const bindings = new Set(
      db.notifications.bindings
        .filter((binding) => binding.roomId === room.id && binding.faction === faction)
        .map((binding) => binding.id),
    );
    // Coalesced generic jobs have no sender; clear this seat's message jobs without touching attack alerts.
    db.notifications.jobs = db.notifications.jobs.filter(
      (job) => job.kind === 'incoming' || !bindings.has(job.bindingId),
    );
  }
  return messageBlockView(room, faction);
}
