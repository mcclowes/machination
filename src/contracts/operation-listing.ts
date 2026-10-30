/**
 * ---
 * purpose: Validate the account operation list before the client trusts it.
 * ---
 */
import { ALL_PLAYERS, type Faction } from '../game/players';
import type { OperationListing } from './protocol';

const MODES: readonly OperationListing['mode'][] = ['pulse', 'mining', 'domination'];
const STATUSES: readonly OperationListing['status'][] = ['active', 'victory', 'defeat', 'eliminated', 'draw'];
const KEYS = ['id', 'faction', 'mode', 'players', 'seated', 'started', 'hour', 'status'];

function isListing(value: unknown): value is OperationListing {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    Object.keys(row).length === KEYS.length &&
    KEYS.every((key) => key in row) &&
    typeof row.id === 'string' && /^[a-f0-9]{24}$/.test(row.id) &&
    ALL_PLAYERS.includes(row.faction as Faction) &&
    MODES.includes(row.mode as OperationListing['mode']) &&
    Number.isSafeInteger(row.players) && (row.players as number) >= 2 && (row.players as number) <= ALL_PLAYERS.length &&
    Number.isSafeInteger(row.seated) && (row.seated as number) >= 1 && (row.seated as number) <= (row.players as number) &&
    typeof row.started === 'boolean' &&
    typeof row.hour === 'number' && Number.isFinite(row.hour) && row.hour >= 0 &&
    STATUSES.includes(row.status as OperationListing['status'])
  );
}

export function operationListingResponse(data: unknown): OperationListing[] {
  const operations = data && typeof data === 'object' ? (data as { operations?: unknown }).operations : undefined;
  if (!Array.isArray(operations) || !operations.every(isListing))
    throw new Error('The server sent an invalid operation list.');
  return operations;
}
