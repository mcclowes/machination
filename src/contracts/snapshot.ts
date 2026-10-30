/**
 * ---
 * purpose: Decode live and historical server envelopes with seat, history, and reference validation.
 * related:
 *   - ./protocol.ts - shared wire types
 *   - ../game/observation-format.ts - observation validation independent of transport
 * ---
 *
 * @format
 */

import { validObservation } from '../game/observation-format';
import { isFaction, playersIn } from '../game/players';
import { isAllegiance } from '../game/factions';
import type { GameView } from '../game/visibility';
import { DIPLOMACY_LIMITS, type HistorySnapshot, type Snapshot } from './protocol';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const nonnegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const count = (value: unknown): value is number =>
  nonnegative(value) && Number.isSafeInteger(value);

function frame(
  value: unknown,
  id?: string,
): value is Record<string, unknown> & Pick<Snapshot, 'id' | 'faction' | 'game' | 'visibility'> {
  return (
    record(value) &&
    value.visibility === 'sensors.v1' &&
    text(value.id) &&
    (id === undefined || value.id === id) &&
    validObservation(value.game) &&
    isFaction(value.faction) &&
    playersIn(value.game).includes(value.faction) &&
    references(value.references, value.game)
  );
}

export function snapshotResponse(id: string | undefined, value: unknown): Snapshot {
  if (
    !frame(value, id) ||
    !text(value.invite) ||
    !['game.lobby', 'game.active', 'game.finished'].includes(value.status as string) ||
    typeof value.host !== 'boolean' ||
    !count(value.revision) ||
    !nonnegative(value.serverTime) ||
    !Array.isArray(value.messages) ||
    !Array.isArray(value.members) ||
    !value.members.every((f) => isFaction(f) && playersIn(value.game).includes(f)) ||
    !value.members.includes(value.faction) ||
    new Set(value.members).size !== value.members.length ||
    !metadata(value, value.members)
  )
    throw new Error('Unsupported server response.');
  return value as Snapshot;
}

function bounds(value: unknown): value is { from: number; through: number } {
  return (
    record(value) &&
    nonnegative(value.from) &&
    nonnegative(value.through) &&
    value.from <= value.through
  );
}

function metadata(value: Record<string, unknown>, members: unknown[]): boolean {
  const member = (faction: unknown) => isFaction(faction) && members.includes(faction);
  if (
    (value.variant !== undefined && value.variant !== 'faction') ||
    (value.variant === 'faction'
      ? !Array.isArray(value.allegiances) ||
        value.allegiances.length !== members.length ||
        !value.allegiances.every((a) => record(a) && member(a.player) && isAllegiance(a.faction)) ||
        new Set(value.allegiances.map((a) => a.player)).size !== members.length
      : value.allegiances !== undefined)
  )
    return false;
  const message = (item: unknown): item is Record<string, unknown> =>
    record(item) &&
    member(item.from) &&
    typeof item.text === 'string' &&
    item.text.length <= DIPLOMACY_LIMITS.text &&
    nonnegative(item.sentAt);
  if (
    !Array.isArray(value.messages) ||
    !value.messages.every(
      (item) => message(item) && count(item.id) && item.id > 0 && member(item.to),
    ) ||
    (value.recoveryEnabled !== undefined && typeof value.recoveryEnabled !== 'boolean') ||
    (value.inactivity !== undefined &&
      (!record(value.inactivity) || !nonnegative(value.inactivity.expiresAt))) ||
    (value.history !== undefined && !bounds(value.history))
  )
    return false;
  if (
    value.groups !== undefined &&
    (!Array.isArray(value.groups) ||
      !value.groups.every(
        (group) =>
          record(group) &&
          text(group.id) &&
          text(group.name) &&
          group.name.length <= DIPLOMACY_LIMITS.name &&
          Array.isArray(group.members) &&
          group.members.length >= 2 &&
          group.members.every(member) &&
          new Set(group.members).size === group.members.length &&
          member(group.createdBy) &&
          group.members.includes(group.createdBy) &&
          nonnegative(group.createdAt),
      ))
  )
    return false;
  return (
    value.channels === undefined ||
    (Array.isArray(value.channels) &&
      value.channels.every(
        (channel) =>
          record(channel) &&
          text(channel.id) &&
          ['public', 'private'].includes(channel.kind as string) &&
          Array.isArray(channel.messages) &&
          channel.messages.every((item) => message(item) && text(item.id)),
      ))
  );
}

export function historicalResponse(id: string, hour: number, value: unknown): HistorySnapshot {
  if (
    !frame(value, id) ||
    !bounds(value.history) ||
    !('at' in value.history) ||
    !nonnegative(value.history.at) ||
    value.history.from > value.history.at ||
    value.history.at > value.history.through ||
    value.history.at !== hour
  )
    throw new Error('Unsupported historical server response.');
  return value as HistorySnapshot;
}

function references(value: unknown, game: GameView): boolean {
  if (value === undefined) return true;
  if (
    !record(value) ||
    value.version !== 1 ||
    Object.keys(value).sort().join(',') !== 'haulers,outposts,version' ||
    !Array.isArray(value.outposts) ||
    !Array.isArray(value.haulers)
  )
    return false;
  const rocks = new Set<unknown>(game.rocks.map((r) => r.id)),
    fleets = new Set<unknown>(game.fleets.map((f) => f.id)),
    seen = new Set<string>();
  for (const [kind, entries, ids] of [
    ['outpost', value.outposts, rocks],
    ['hauler', value.haulers, fleets],
  ] as const) {
    if (entries.length > ids.size) return false;
    const used = new Set<unknown>();
    const validId = kind === 'outpost' ? text : (id: unknown) => count(id) && id > 0;
    for (const item of entries) {
      if (
        !record(item) ||
        Object.keys(item).sort().join(',') !== 'id,ref' ||
        !ids.has(item.id) ||
        used.has(item.id) ||
        typeof item.ref !== 'string' ||
        !/^[a-f0-9]{64}$/.test(item.ref) ||
        seen.has(item.ref) ||
        !validId(item.id)
      )
        return false;
      used.add(item.id);
      seen.add(item.ref);
    }
  }
  return true;
}
