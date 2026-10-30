/**
 * Idempotency receipts are written in the same transaction as their command.
 *
 * @format
 */

import type { Faction } from '../src/game/players';
import type { Room } from './database';
import { requireThat } from './failure';

export function receipt(room: Room, faction: Faction, requestId: string, payload: string): boolean {
  requireThat(
    typeof requestId === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(requestId),
    400,
    'command.validation.request_id',
    'Provide a unique command ID.',
  );
  const key = `${faction}:${requestId}`;
  const prior = room.receipts[key];
  requireThat(
    !prior || prior === payload,
    409,
    'command.conflict.reused_id',
    'This command ID was used for different content.',
  );
  if (prior) return true;
  requireThat(
    Object.keys(room.receipts).length < 10000,
    409,
    'command.capacity.reached',
    'This operation has reached its command limit.',
  );
  room.receipts[key] = payload;
  return false;
}
