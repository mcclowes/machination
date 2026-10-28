/**
 * ---
 * purpose: Shared launch timing and private queue controls for asynchronous transfer planning.
 * ---
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MODULES } from '../game/modules';
import type { ScheduledTransfer } from '../game/orders';
type TimingProps = { delay: number; disabled: boolean; onChange: (delay: number) => void };
export function LaunchTiming({ delay, disabled, onChange }: TimingProps) {
  return <View style={s.section}><Text style={s.label}>Launch timing</Text><View style={s.options}>{[0, 1, 6, 12, 24, 48, 72, 168].map(h => <Pressable key={h} accessibilityRole="button" accessibilityState={{ selected: delay === h, disabled }} disabled={disabled} onPress={() => onChange(h)} style={[s.option, delay === h && s.selected, disabled && s.disabled]}><Text style={s.text}>{h ? h >= 24 ? `+${h / 24}d` : `+${h}h` : 'Now'}</Text></Pressable>)}</View>{delay > 0 && <Text style={s.detail}>Drones aren't reserved. Ownership, inventory, and the selected module must still permit a full launch at execution time.</Text>}</View>;
}
type QueueProps = { plans: ScheduledTransfer[]; hour: number; rocks: { id: string; name: string }[]; disabled: boolean; onCancel: (id: string) => void };
export function ScheduledOrders({ plans, hour, rocks, disabled, onCancel }: QueueProps) {
  return <View style={s.queue}><Text style={s.label}>Scheduled transfers / {plans.length}</Text>{plans.length ? [...plans].sort((a, b) => a.executeAt - b.executeAt).map(p => <View key={`${p.owner}:${p.id}`} style={s.plan}><Text style={s.text}>{rocks.find(r => r.id === p.from)?.name} → {rocks.find(r => r.id === p.to)?.name}</Text><Text style={s.detail}>{p.drones} drones · launches in {(p.executeAt - hour).toFixed(1)}h{p.module ? ` · ${MODULES[p.module].name}` : ''}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Cancel scheduled transfer to ${rocks.find(r => r.id === p.to)?.name}`} accessibilityState={{ disabled }} disabled={disabled} onPress={() => onCancel(p.id)} style={[s.cancel, disabled && s.disabled]}><Text style={s.text}>Cancel transfer</Text></Pressable></View>) : <Text style={s.detail}>No queued transfers. Your plans remain private until launch.</Text>}</View>;
}
const s = StyleSheet.create({
  section: { gap: 9, marginVertical: 12 }, label: { color: '#96ad89', fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' }, options: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, option: { flexGrow: 1, alignItems: 'center', minWidth: 45, minHeight: 44, justifyContent: 'center', paddingHorizontal: 9, borderWidth: 1, borderColor: '#30442b' }, selected: { backgroundColor: '#263c20', borderColor: '#b8e986' }, text: { color: '#d6e2cd', fontSize: 12, lineHeight: 19 }, detail: { color: '#8c9f85', fontSize: 11, lineHeight: 18 }, queue: { gap: 13, padding: 18, borderWidth: 1, borderColor: '#30402e', backgroundColor: '#101b13' }, plan: { gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#30402e' }, cancel: { minHeight: 44, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#43563a', paddingHorizontal: 12 }, disabled: { opacity: 0.35 },
});
