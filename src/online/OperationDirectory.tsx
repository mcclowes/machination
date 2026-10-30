/**
 * ---
 * purpose: List an account's multiplayer operations and open one, or start setup for a new one.
 * related:
 *   - ./OnlineOperation.tsx - opens the chosen operation
 *   - ./useAccountOperations.ts - fetches the listing
 * ---
 */
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { playSound } from '../audio/sound';
import type { AccountAccess } from './account-auth';
import { describeListing } from './operation-labels';
import { useAccountOperations } from './useAccountOperations';

export function OperationDirectory({ account, onOpen }: { account: AccountAccess; onOpen: (id?: string) => void }) {
  const { operations, error, refresh } = useAccountOperations(account);
  const open = (id?: string) => { playSound('tap'); onOpen(id); };
  const active = operations?.filter((o) => o.status === 'active') ?? [];
  const finished = operations?.filter((o) => o.status !== 'active') ?? [];
  return (
    <ScrollView contentContainerStyle={s.screen}>
      <Pressable accessibilityRole="button" onPress={() => open()} style={s.primary}>
        <Text style={s.primaryText}>New or join operation</Text>
      </Pressable>
      {!!error && (
        <View style={s.notice}>
          <Text accessibilityRole="alert" style={s.error}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={refresh} style={s.inline}><Text style={s.link}>Retry</Text></Pressable>
        </View>
      )}
      {!operations && !error && <ActivityIndicator accessibilityLabel="Loading operations" />}
      {operations && !operations.length && <Text style={s.detail}>You aren't in any operations yet.</Text>}
      {[['Active', active], ['Finished', finished]].map(([title, rows]) =>
        (rows as typeof active).length ? (
          <View key={title as string} style={s.group}>
            <Text style={s.label}>{title as string}</Text>
            {(rows as typeof active).map((row) => (
              <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`Open operation: ${describeListing(row)}`}
                onPress={() => open(row.id)} style={({ pressed }) => [s.row, pressed && { opacity: 0.65 }]}>
                <Text style={s.rowText}>{describeListing(row)}</Text>
                <Text style={s.link}>Open ›</Text>
              </Pressable>
            ))}
          </View>
        ) : null,
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { padding: 16, gap: 16, width: '100%', maxWidth: 560, alignSelf: 'center' },
  primary: { minHeight: 44, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: '#b8e986' },
  primaryText: { color: '#182312', fontSize: 11, fontWeight: '600' },
  group: { gap: 8 },
  label: { color: '#80917c', fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase' },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: '#30442b', backgroundColor: '#162217', borderRadius: 4 },
  rowText: { flex: 1, color: '#e5eadc', fontSize: 13 },
  link: { color: '#b8e986', fontSize: 12 },
  detail: { color: '#b4c7ca', fontSize: 13 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  error: { flex: 1, color: '#ffbb91', fontSize: 13 },
  inline: { minHeight: 44, justifyContent: 'center' },
});
