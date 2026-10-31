/**
 * Private, operation-scoped communication preferences, independent of game rules.
 * @format
 */
import { ALL_PLAYERS, type Faction } from '../game/players';

export type MessageBlockSettings = {
  gameId: string;
  faction: Faction;
  revision: number;
  blocked: Faction[];
};
export type SetMessageBlock = {
  requestId: string;
  revision: number;
  player: Faction;
  blocked: boolean;
};

const REQUEST_ID = /^[a-zA-Z0-9-]{16,80}$/;
export function isSetMessageBlock(input: unknown): input is SetMessageBlock {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  return (
    Object.keys(value).length === 4 &&
    Object.keys(value).every((key) =>
      ['requestId', 'revision', 'player', 'blocked'].includes(key),
    ) &&
    typeof value.requestId === 'string' &&
    REQUEST_ID.test(value.requestId) &&
    Number.isSafeInteger(value.revision) &&
    (value.revision as number) >= 0 &&
    ALL_PLAYERS.includes(value.player as Faction) &&
    typeof value.blocked === 'boolean'
  );
}

export function messageBlockSettingsResponse(
  gameId: string,
  faction: Faction,
  input: unknown,
): MessageBlockSettings {
  const value = input as MessageBlockSettings | null;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 4 ||
    Object.keys(value).some((key) => !['gameId', 'faction', 'revision', 'blocked'].includes(key)) ||
    value.gameId !== gameId ||
    value.faction !== faction ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Array.isArray(value.blocked) ||
    value.blocked.length >= ALL_PLAYERS.length ||
    !value.blocked.every((player) => player !== faction && ALL_PLAYERS.includes(player)) ||
    new Set(value.blocked).size !== value.blocked.length ||
    (value.revision === 0 && value.blocked.length)
  )
    throw new Error('Unsupported message blocking response.');
  return { gameId, faction, revision: value.revision, blocked: [...value.blocked] };
}
