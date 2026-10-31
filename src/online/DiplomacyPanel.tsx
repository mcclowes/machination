/**
 * ---
 * purpose: Persistent per-thread drafts, fixed-member group creation, and public/private diplomacy composition.
 * ---
 *
 * @format
 */

import React, { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { FACTIONS, type Faction } from '../game/simulation';
import { PlayerIdentity } from '../components/PlayerIdentity';
import { commandId, type Pending } from './client';
import { DIPLOMACY_LIMITS, type ObjectReference, type Snapshot } from '../contracts/protocol';
import { ReferenceText } from '../components/ReferenceText';
import { MessageBlockingSettings } from './MessageBlockingSettings';
import { useMessageBlocks, type MessageBlockSeat } from './useMessageBlocks';
import { messageBlocksApi, setMessageBlockApi } from './network';

const MESSAGE_BLOCK_DEPS = {
  read: messageBlocksApi,
  write: setMessageBlockApi,
  requestId: commandId,
};

type ChatCommand = Extract<Pending, { kind: 'messages' | 'channel-messages' | 'groups' }>;
type Props = {
  seat?: MessageBlockSeat;
  origin?: string;
  onInspectReference?: (reference: ObjectReference, mode: 'observed' | 'now') => void;
  snapshot?: Snapshot;
  disabled: boolean;
  acknowledged?: string;
  scroll: React.RefObject<ScrollView | null>;
  onSubmit: (command: ChatCommand) => void;
};
type Sent =
  { id: string; thread: string; text: string } | { id: string; name: string; groups: string[] };

// State lives in the operation so closing a drawer never discards a draft.
export function useDiplomacyPanel({
  seat,
  snapshot,
  disabled,
  acknowledged,
  scroll,
  onSubmit,
  origin,
  onInspectReference,
}: Props): React.ReactNode {
  const blocking = useMessageBlocks(seat, MESSAGE_BLOCK_DEPS);
  const [thread, setThread] = useState('public');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [members, setMembers] = useState<Faction[]>([]);
  const [limit, setLimit] = useState(100);
  const sent = useRef<Sent | undefined>(undefined);
  const identity = useRef('');
  const editor = useRef<TextInput>(null);
  const composer = useRef<View>(null);
  function revealComposer() {
    if (!editor.current?.isFocused()) return;
    scroll.current?.getNativeScrollRef()?.measureInWindow((_x, top) => {
      if (editor.current?.isFocused() && composer.current)
        scroll.current?.scrollResponderScrollNativeHandleToKeyboard(
          composer.current,
          top + 16,
          true,
        );
    });
  }
  const revealAfterLayout = useEffectEvent(revealComposer);
  useEffect(() => {
    const keyboard = Keyboard.addListener('keyboardDidShow', () => revealAfterLayout());
    return () => keyboard.remove();
  }, []);
  useEffect(() => {
    if (!snapshot) return;
    const next = JSON.stringify([origin ?? '', snapshot.id, snapshot.faction]);
    if (identity.current !== next) {
      identity.current = next;
      setDrafts({});
      setMembers([snapshot.faction]);
      setName('');
      setCreating(false);
      sent.current = undefined;
      setThread(
        snapshot.channels?.some((c) => c.id === 'public')
          ? 'public'
          : `direct:${snapshot.members.find((f) => f !== snapshot.faction) ?? snapshot.faction}`,
      );
    }
    const prior = sent.current;
    if (prior && prior.id === acknowledged) {
      if ('thread' in prior)
        setDrafts((current) =>
          current[prior.thread] === prior.text ? { ...current, [prior.thread]: '' } : current,
        );
      else {
        const created = snapshot.groups?.find(
          (g) =>
            !prior.groups.includes(g.id) &&
            g.createdBy === snapshot.faction &&
            g.name === prior.name.trim(),
        );
        if (created) setThread(created.id);
        setName((current) => (current === prior.name ? '' : current));
        setCreating(false);
      }
      sent.current = undefined;
    }
    if (Keyboard.isVisible()) revealAfterLayout();
  }, [snapshot, acknowledged, origin]);
  if (!snapshot) return null;
  const available = [
    ...(snapshot.channels?.some((c) => c.id === 'public')
      ? [{ id: 'public', label: 'Public room' }]
      : []),
    ...snapshot.members
      .filter((f) => f !== snapshot.faction)
      .map((f) => ({ id: `direct:${f}`, label: `Private · ${FACTIONS[f].name}` })),
    ...(snapshot.groups ?? []).map((g) => ({ id: g.id, label: g.name })),
  ];
  const recipient = snapshot.members.find(
    (f) => `direct:${f}` === thread && f !== snapshot.faction,
  );
  const group = snapshot.groups?.find((g) => g.id === thread);
  const channel = snapshot.channels?.find((c) => c.id === thread);
  const validThread = !!recipient || !!channel;
  const blocked = blocking.settings?.blocked ?? [];
  const directBlocked = recipient !== undefined && blocked.includes(recipient);
  const messages = (
    recipient
      ? snapshot.messages.filter((m) => m.from === recipient || m.to === recipient)
      : (channel?.messages ?? [])
  ).filter((message) => !blocked.includes(message.from));
  const draft = drafts[thread] ?? '';
  const audience = recipient ? [snapshot.faction, recipient] : (group?.members ?? snapshot.members);
  function send() {
    const requestId = commandId();
    sent.current = { id: requestId, thread, text: draft };
    onSubmit(
      recipient
        ? { kind: 'messages', body: { requestId, to: recipient, text: draft } }
        : { kind: 'channel-messages', body: { requestId, channelId: thread, text: draft } },
    );
  }
  return (
    <View style={s.panel}>
      <Text style={s.title}>Diplomacy</Text>
      <ScrollView horizontal contentContainerStyle={s.threads} keyboardShouldPersistTaps="handled">
        {available.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: thread === item.id }}
            onPress={() => {
              setThread(item.id);
              setLimit(100);
            }}
            style={[s.button, { maxWidth: 220 }, thread === item.id && s.selected]}
          >
            <Text numberOfLines={1} style={s.action}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <MessageBlockingSettings
        state={blocking}
        members={snapshot.members}
        faction={snapshot.faction}
      />
      {!!snapshot.channels && (
        <Action
          text={creating ? 'Cancel group creation' : 'New private group'}
          onPress={() => setCreating(!creating)}
        />
      )}
      {creating && (
        <View style={s.group}>
          <Text style={s.detail}>
            Choose everyone who can read this group. Membership is fixed; changing participants
            requires a new group.
          </Text>
          <TextInput
            accessibilityLabel="Private group name"
            value={name}
            onChangeText={setName}
            maxLength={DIPLOMACY_LIMITS.name}
            style={s.input}
            placeholder="Group name"
            placeholderTextColor="#647960"
          />
          {snapshot.members.map((f) => (
            <Pressable
              key={f}
              accessibilityRole="checkbox"
              accessibilityLabel={`Include ${FACTIONS[f].name} in private group`}
              accessibilityState={{
                checked: members.includes(f),
                disabled:
                  disabled ||
                  f === snapshot.faction ||
                  (blocked.includes(f) && !members.includes(f)),
              }}
              disabled={
                disabled || f === snapshot.faction || (blocked.includes(f) && !members.includes(f))
              }
              onPress={() =>
                setMembers((current) =>
                  current.includes(f) ? current.filter((m) => m !== f) : [...current, f],
                )
              }
              style={[s.button, members.includes(f) && s.selected]}
            >
              <Text style={s.action}>
                {members.includes(f) ? '☑' : '☐'} {FACTIONS[f].name}
                {f === snapshot.faction ? ' · you' : ''}
                {blocked.includes(f) ? ' · blocked' : ''}
              </Text>
            </Pressable>
          ))}
          <Action
            text="Create private group"
            disabled={
              disabled ||
              !name.trim() ||
              members.length < 2 ||
              members.some((member) => blocked.includes(member))
            }
            onPress={() => {
              const requestId = commandId();
              sent.current = {
                id: requestId,
                name,
                groups: (snapshot.groups ?? []).map((g) => g.id),
              };
              onSubmit({ kind: 'groups', body: { requestId, name, members } });
            }}
          />
        </View>
      )}
      <Text accessibilityRole="header" style={s.title}>
        {available.find((item) => item.id === thread)?.label ?? 'Choose a channel'}
      </Text>
      {validThread && (
        <Text style={s.detail}>
          {thread === 'public'
            ? 'Public room · all joined players can read this.'
            : 'Private · fixed audience.'}{' '}
          {audience.map((f) => FACTIONS[f].name).join(', ')}.
        </Text>
      )}
      {messages.length > limit && (
        <Action text="Show earlier messages" onPress={() => setLimit((current) => current + 100)} />
      )}
      {messages.slice(-limit).map((m) => (
        <View key={m.id} style={s.message}>
          <PlayerIdentity faction={m.from} detail={new Date(m.sentAt).toLocaleString()} size={32} />
          <ReferenceText text={m.text} onInspect={onInspectReference} />
        </View>
      ))}
      {validThread && messages.length === 0 && (
        <Text style={s.detail}>No transmissions in this channel.</Text>
      )}
      <View
        ref={composer}
        collapsable={false}
        onLayout={() => {
          if (Keyboard.isVisible()) revealComposer();
        }}
        style={s.group}
      >
        {directBlocked && (
          <Text style={s.detail}>
            Unblock {FACTIONS[recipient!].name} to send a direct transmission.
          </Text>
        )}
        <TextInput
          ref={editor}
          accessibilityLabel={
            recipient
              ? 'Private transmission'
              : thread === 'public'
                ? 'Public transmission'
                : 'Group transmission'
          }
          onFocus={() => {
            if (Keyboard.isVisible()) revealComposer();
          }}
          multiline
          editable={!directBlocked}
          maxLength={DIPLOMACY_LIMITS.text}
          value={draft}
          onChangeText={(text) => setDrafts((current) => ({ ...current, [thread]: text }))}
          style={[s.input, { minHeight: 90 }]}
          placeholder="Write a transmission…"
          placeholderTextColor="#647960"
        />
        <Action
          text={thread === 'public' ? 'Transmit to public room' : 'Transmit privately'}
          disabled={disabled || directBlocked || !validThread || !draft.trim()}
          onPress={send}
        />
        <Text style={s.detail}>
          Stored by the game server. Diplomacy remains available after elimination.
        </Text>
      </View>
    </View>
  );
}
function Action({
  text,
  disabled,
  onPress,
}: {
  text: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.button, disabled && s.disabled]}
    >
      <Text style={s.action}>{text}</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  panel: { gap: 12 },
  threads: { gap: 6 },
  button: {
    minHeight: 44,
    padding: 12,
    borderWidth: 1,
    borderColor: '#40563a',
    justifyContent: 'center',
    backgroundColor: '#15241a',
  },
  selected: { borderColor: '#b8e986', backgroundColor: '#263c20' },
  action: { color: '#b8e986', fontSize: 12 },
  title: { color: '#e5eadc', fontSize: 16 },
  detail: { color: '#8c9f85', fontSize: 11, lineHeight: 18 },
  text: { color: '#d6e2cd', fontSize: 14, lineHeight: 21 },
  message: { paddingVertical: 12, borderBottomWidth: 1, borderColor: '#30402e', gap: 6 },
  input: {
    color: '#e5eadc',
    borderWidth: 1,
    borderColor: '#40563a',
    padding: 12,
    minHeight: 46,
    fontSize: 15,
    backgroundColor: '#0b140e',
  },
  group: { gap: 10 },
  disabled: { opacity: 0.4 },
});
