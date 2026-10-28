/**
 * ---
 * purpose: Shared launch timing and private queue controls for future transfers and actions.
 * ---
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MODULES } from '../game/modules';
import type { ScheduledOrder } from '../game/orders';
import { actionLabel, isActionPlan } from '../game/future-actions';
import { gameClock } from '../game/time-machine';
type TimingProps = { delay: number; disabled: boolean; onChange: (delay: number) => void; future?: boolean };
export function LaunchTiming({ delay, disabled, onChange, future }: TimingProps) {
  return <View style={s.section}><Text style={s.label}>Launch timing</Text><View style={s.options}>{[0, 1, 6, 12, 24, 48, 72, 168].map(h => <Pressable key={h} accessibilityRole="button" accessibilityState={{ selected: delay === h, disabled }} disabled={disabled} onPress={() => onChange(h)} style={[s.option, delay === h && s.selected, disabled && s.disabled]}><Text style={s.text}>{h ? h >= 24 ? `+${h / 24}d` : `+${h}h` : future ? 'At forecast' : 'Now'}</Text></Pressable>)}</View>{delay > 0 && <Text style={s.detail}>Drones aren't reserved. Ownership, inventory, and the selected module must still permit a full launch at execution time.</Text>}</View>;
}
type QueueProps = { plans: ScheduledOrder[]; hour: number; rocks: { id: string; name: string }[]; disabled: boolean; onCancel: (id: string) => void };
export function ScheduledOrders({ plans, hour, rocks, disabled, onCancel }: QueueProps) {
  return <View style={s.queue}><Text style={s.label}>Scheduled orders / {plans.length}</Text>{plans.length ? [...plans].sort((a, b) => a.executeAt - b.executeAt).map(p => {
    const action = isActionPlan(p);
    const label = action ? actionLabel(p.action, rocks) : `${rocks.find(r => r.id === p.from)?.name ?? p.from} → ${rocks.find(r => r.id === p.to)?.name ?? p.to}`;
    return <View key={`${p.owner}:${p.id}`} style={s.plan}><Text style={s.text}>{label}</Text><Text style={s.detail}>{gameClock(p.executeAt)} · in {(p.executeAt - hour).toFixed(1)}h{!action ? ` · ${p.drones} drones${p.module ? ` · ${MODULES[p.module].name}` : ''}` : ''}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Cancel scheduled order: ${label}`} accessibilityState={{ disabled }} disabled={disabled} onPress={() => onCancel(p.id)} style={[s.cancel, disabled && s.disabled]}><Text style={s.text}>Cancel order</Text></Pressable></View>;
  }) : <Text style={s.detail}>No queued orders. Your plans remain private until execution.</Text>}</View>;
}
const s = StyleSheet.create({
  section: { gap: 9, marginVertical: 12 }, label: { color: '#96ad89', fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' }, options: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, option: { flexGrow: 1, alignItems: 'center', minWidth: 45, minHeight: 44, justifyContent: 'center', paddingHorizontal: 9, borderWidth: 1, borderColor: '#30442b' }, selected: { backgroundColor: '#263c20', borderColor: '#b8e986' }, text: { color: '#d6e2cd', fontSize: 12, lineHeight: 19 }, detail: { color: '#8c9f85', fontSize: 11, lineHeight: 18 }, queue: { gap: 13, padding: 18, borderWidth: 1, borderColor: '#30402e', backgroundColor: '#101b13' }, plan: { gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#30402e' }, cancel: { minHeight: 44, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#43563a', paddingHorizontal: 12 }, disabled: { opacity: 0.35 },
});
