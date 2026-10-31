/**
 * Operation-scoped message controls with explicit server confirmation and failure states.
 * @format
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FACTIONS, type Faction } from '../game/players';
import type { MessageBlockState } from './useMessageBlocks';

export function MessageBlockingSettings({
  state,
  members,
  faction,
}: {
  state: MessageBlockState;
  members: readonly Faction[];
  faction: Faction;
}) {
  const [expanded, setExpanded] = useState(false);
  const blocked = state.settings?.blocked ?? [];
  return (
    <View style={s.panel}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Message blocking"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={s.button}
      >
        <Text style={s.action}>
          Message blocking{blocked.length ? ` · ${blocked.length} blocked` : ''} ·{' '}
          {expanded ? 'hide' : 'show'}
        </Text>
      </Pressable>
      {expanded && (
        <View style={s.content}>
          <Text style={s.detail}>
            Blocks apply only to this operation. They hide a player’s direct, group, and public
            messages, including earlier messages. Attacks and other game activity remain visible.
          </Text>
          <Text style={s.detail}>
            A new block also clears your pending message alerts. Notifications already sent may
            still arrive. Unblocking allows retained messages to appear again.
          </Text>
          {state.phase === 'loading' && (
            <Text accessibilityLiveRegion="polite" style={s.detail}>
              Loading message blocking…
            </Text>
          )}
          {state.phase === 'idle' && (
            <Text style={s.detail}>Connect to this operation to manage message blocking.</Text>
          )}
          {state.phase === 'unsupported' && (
            <Text style={s.detail}>Message blocking is unavailable for this operation.</Text>
          )}
          {!!state.settings &&
            state.phase !== 'unsupported' &&
            members
              .filter((player) => player !== faction)
              .map((player) => (
                <View key={player} style={s.player}>
                  <Text style={s.name}>
                    {FACTIONS[player].name} ·{' '}
                    {blocked.includes(player) ? 'Blocked in this operation' : 'Messages allowed'}
                  </Text>
                  <Action
                    text={`${blocked.includes(player) ? 'Unblock' : 'Block'} ${FACTIONS[player].name}`}
                    disabled={state.working || state.phase !== 'ready'}
                    onPress={() => state.setBlocked(player, !blocked.includes(player))}
                  />
                </View>
              ))}
          {state.working && state.phase !== 'loading' && (
            <Text accessibilityLiveRegion="polite" style={s.detail}>
              Saving message blocking…
            </Text>
          )}
          {!!state.error && (
            <>
              <Text accessibilityRole="alert" style={s.error}>
                {state.error}
              </Text>
              <Action
                text="Retry message blocking"
                disabled={state.working}
                onPress={state.retry}
              />
            </>
          )}
          <Action
            text="Refresh message blocking"
            disabled={state.working || state.phase === 'idle'}
            onPress={state.refresh}
          />
        </View>
      )}
    </View>
  );
}
function Action({ text, disabled, onPress }: { text: string; disabled: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.button, disabled && s.disabled]}
    >
      <Text style={s.action}>{text}</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  panel: { borderWidth: 1, borderColor: '#30402e', backgroundColor: '#101b13' },
  content: { padding: 12, gap: 12 },
  player: { gap: 8 },
  name: { color: '#d6e2cd', fontSize: 13, lineHeight: 20 },
  detail: { color: '#8c9f85', fontSize: 12, lineHeight: 20 },
  error: { color: '#e9a775', fontSize: 13, lineHeight: 20 },
  button: {
    minHeight: 44,
    padding: 12,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#40563a',
    backgroundColor: '#15241a',
  },
  action: { color: '#b8e986', fontSize: 12 },
  disabled: { opacity: 0.4 },
});
