/**
 * Transaction-local fixed channels, private membership, message retention, and retry identity.
 *
 * @format
 */

import { randomBytes } from 'node:crypto';
import { ALL_PLAYERS, type Faction } from '../src/game/players';
import {
  DIPLOMACY_LIMITS,
  type CreateGroup,
  type ChannelTransmission,
  type Transmission,
} from '../src/contracts/protocol';
import type { Room } from './database';
import { receipt } from './command-receipts';
import { requireThat } from './failure';
import { isMessageBlocked } from './message-blocks';

type Notification = { audience: Faction[]; reference: string };
const MAX_PRIVATE_MESSAGES = 5000;

export function addGroup(room: Room, faction: Faction, command: CreateGroup, now: number): boolean {
  requireThat(
    typeof command.name === 'string' &&
      command.name.trim().length > 0 &&
      command.name.length <= DIPLOMACY_LIMITS.name,
    400,
    'group.validation.name',
    'Group names must contain 1 to 60 characters.',
  );
  requireThat(
    Array.isArray(command.members) &&
      command.members.length >= 2 &&
      command.members.length <= room.seats.length &&
      new Set(command.members).size === command.members.length &&
      command.members.includes(faction) &&
      command.members.every((member) => room.seats.some((s) => s.faction === member)),
    400,
    'group.validation.members',
    'Choose fixed members, including yourself and at least one other seat.',
  );
  const members = ALL_PLAYERS.filter((member) => command.members.includes(member));
  if (receipt(room, faction, command.requestId, JSON.stringify(['group', command.name, members])))
    return false;
  requireThat(
    members.every(
      (member) =>
        member === faction ||
        (!isMessageBlocked(room, member, faction) && !isMessageBlocked(room, faction, member)),
    ),
    409,
    'group.conflict.blocked',
    'A selected player is unavailable for a new private group.',
  );
  const diplomacy = (room.diplomacy ??= { groups: [], publicMessages: [] });
  requireThat(
    members.every(
      (member) =>
        diplomacy.groups.filter((g) => g.members.includes(member)).length <
        DIPLOMACY_LIMITS.groupsPerParticipant,
    ),
    409,
    'group.capacity.reached',
    'A selected participant has reached the private group limit.',
  );
  diplomacy.groups.push({
    id: randomBytes(16).toString('hex'),
    name: command.name.trim(),
    members,
    createdBy: faction,
    createdAt: now,
    messages: [],
  });
  return true;
}

export function addChannelMessage(
  room: Room,
  faction: Faction,
  command: ChannelTransmission,
  now: number,
): Notification | undefined {
  const diplomacy = (room.diplomacy ??= { groups: [], publicMessages: [] });
  const group = diplomacy.groups.find(
    (g) => g.id === command.channelId && g.members.includes(faction),
  );
  requireThat(
    command.channelId === 'public' || group,
    404,
    'channel.not_found',
    'Channel not found.',
  );
  requireThat(
    typeof command.text === 'string' &&
      command.text.trim().length > 0 &&
      command.text.length <= DIPLOMACY_LIMITS.text,
    400,
    'message.validation.text',
    'Transmissions must contain 1 to 1,000 characters.',
  );
  if (
    receipt(
      room,
      faction,
      command.requestId,
      JSON.stringify(['channel-message', command.channelId, command.text]),
    )
  )
    return;
  const messages = group ? group.messages : diplomacy.publicMessages;
  const id = randomBytes(16).toString('hex');
  messages.push({ id, from: faction, text: command.text.trim(), sentAt: now });
  messages.splice(0, Math.max(0, messages.length - DIPLOMACY_LIMITS.messagesPerChannel));
  return {
    audience: (group ? group.members : room.seats.map((s) => s.faction)).filter(
      (member) => member !== faction,
    ),
    reference: `channel:${command.channelId}:${id}`,
  };
}

export function addPrivateMessage(
  room: Room,
  faction: Faction,
  command: Transmission,
  now: number,
): Notification | undefined {
  requireThat(
    ALL_PLAYERS.includes(command.to) &&
      command.to !== faction &&
      room.seats.some((s) => s.faction === command.to),
    400,
    'message.validation.recipient',
    'Choose another intelligence in this operation.',
  );
  requireThat(
    typeof command.text === 'string' &&
      command.text.trim().length > 0 &&
      command.text.length <= DIPLOMACY_LIMITS.text,
    400,
    'message.validation.text',
    'Transmissions must contain 1 to 1,000 characters.',
  );
  if (
    receipt(room, faction, command.requestId, JSON.stringify(['message', command.to, command.text]))
  )
    return;
  requireThat(
    !isMessageBlocked(room, command.to, faction) && !isMessageBlocked(room, faction, command.to),
    409,
    'message.conflict.blocked',
    'This direct channel is unavailable.',
  );
  requireThat(
    room.messages.length < MAX_PRIVATE_MESSAGES,
    409,
    'message.capacity.reached',
    'This operation has reached its transmission limit.',
  );
  room.messages.push({
    id: room.messages.length + 1,
    from: faction,
    to: command.to,
    text: command.text.trim(),
    sentAt: now,
  });
  return { audience: [command.to], reference: `message:${room.messages.length}` };
}
