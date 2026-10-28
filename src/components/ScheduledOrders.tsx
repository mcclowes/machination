/**
 * ---
 * purpose: Shared launch timing and private queue controls for future transfers and actions.
 * ---
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MODULES } from '../game/modules';
import { isScheduledLaunch, type LaunchEdit, type ScheduledOrder } from '../game/orders';
import { LaunchReview } from './LaunchReview';
import type { LaunchUnit } from './launch-manifest';
import { actionLabel, isActionPlan, type FutureAction } from '../game/future-actions';
import { gameClock } from '../game/time-machine';
import type { Fleet } from '../game/simulation';
type TimingProps = { delay: number; disabled: boolean; onChange: (delay: number) => void; future?: boolean; compact?: boolean };
export function LaunchTiming({ delay, disabled, onChange, future, compact }: TimingProps) {
  const [expanded, setExpanded] = useState(false);
  if (compact && !expanded) return <Pressable accessibilityRole="button" accessibilityLabel="Change launch timing" onPress={() => setExpanded(true)} style={s.cancel}><Text style={s.text}>{delay ? `Launch in ${delay}h` : future ? 'Launch at forecast time' : 'Launch now'} · change timing</Text></Pressable>;
  return <View style={s.section}><Text style={s.label}>Launch timing</Text><View style={s.options}>{[0, 1, 6, 12, 24, 48, 72, 168].map(h => <Pressable key={h} accessibilityRole="button" accessibilityState={{ selected: delay === h, disabled }} disabled={disabled} onPress={() => onChange(h)} style={[s.option, delay === h && s.selected, disabled && s.disabled]}><Text style={s.text}>{h ? h >= 24 ? `+${h / 24}d` : `+${h}h` : future ? 'At forecast' : 'Now'}</Text></Pressable>)}</View>{delay > 0 && <Text style={s.detail}>Drones aren't reserved. Ownership, inventory, and the selected module must still permit a full launch at execution time.</Text>}</View>;
}
function queueActionLabel(action: FutureAction, rocks: { id: string; name: string }[], route?: string) {
  if (action.type !== 'hauler') return actionLabel(action, rocks);
  const change = action.change;
  const labels = { 'cancel-launch': 'Cancel launch', 'edit-launch': 'Edit manifest', course: 'Change course', gift: 'Make gift', 'cancel-gift': 'Cancel gift' };
  const destination = change.action === 'course' ? ` → ${rocks.find(r => r.id === change.to)?.name ?? change.to}` : '';
  return `${labels[change.action]}${route ? ` · ${route}` : ' · hauler unavailable'}${destination}`;
}
export function scheduledOrderLabel(plan: ScheduledOrder, rocks: { id: string; name: string }[], plans: readonly ScheduledOrder[] = [], fleets: readonly Fleet[] = []) {
  const name = (id: string) => rocks.find(r => r.id === id)?.name ?? id;
  if (!isActionPlan(plan)) return `${name(plan.from)} → ${name(plan.to)}`;
  if (plan.action.type === 'intercept') {
    const targetId = plan.action.target;
    const target = fleets.find(f => f.id === targetId);
    return `${actionLabel(plan.action, rocks)} · ${target ? `${name(target.from)} → ${name(target.to)} (${target.drones} drones)` : 'target no longer observed'}`;
  }
  let route: string | undefined;
  if (plan.action.type === 'hauler') {
    const id = plan.action.change.fleet;
    const fleet = fleets.find(f => f.id === id);
    const launch = plans.find(p => p.fleetId === id && p.owner === plan.owner);
    if (fleet) route = `${name(fleet.from)} → ${fleet.intercept ? 'interception' : name(fleet.to)}`;
    else if (launch && !isActionPlan(launch)) route = `${name(launch.from)} → ${name(launch.to)}`;
    else if (launch && isActionPlan(launch) && launch.action.type === 'gift') route = `${name(launch.action.from)} → ${name(launch.action.to)}`;
    else if (launch && isActionPlan(launch) && launch.action.type === 'intercept') route = `${name(launch.action.from)} → interception`;
  }
  return queueActionLabel(plan.action, rocks, route);
}
type QueueProps = { plans: ScheduledOrder[]; fleets?: readonly Fleet[]; hour: number; rocks: { id: string; name: string }[]; disabled: boolean; onCancel: (id: string) => void; onInspect: (hour: number) => void; onEdit: (change: LaunchEdit) => void; units: LaunchUnit[]; preparation: boolean };
export function ScheduledOrders({ plans, fleets = [], hour, rocks, disabled, onCancel, onInspect, onEdit, units, preparation }: QueueProps) {
  const [review, setReview] = useState<string>();
  return <View style={s.queue}><Text style={s.label}>Scheduled orders / {plans.length}</Text>{plans.length ? [...plans].sort((a, b) => a.executeAt - b.executeAt).map(p => {
    const action = isActionPlan(p);
    const label = scheduledOrderLabel(p, rocks, plans, fleets);
    return <View key={`${p.owner}:${p.id}`} style={s.plan}><Text style={s.text}>{label}</Text><Text style={s.detail}>{gameClock(p.executeAt)} · in {(p.executeAt - hour).toFixed(1)}h{action && (p.action.type === 'gift' || p.action.type === 'intercept') ? ` · ${p.action.drones} drones` : !action ? ` · ${p.drones} drones${p.module ? ` · ${MODULES[p.module].name}` : ''}` : ''}</Text><Pressable accessibilityRole="button" onPress={() => onInspect(p.executeAt)} style={s.cancel}><Text style={s.text}>Inspect forecast</Text></Pressable>{isScheduledLaunch(p) && <><Pressable accessibilityRole="button" onPress={() => setReview(review === p.id ? undefined : p.id)} style={s.cancel}><Text style={s.text}>{disabled ? 'Review launch' : 'Review/edit launch'}</Text></Pressable>{review === p.id && <LaunchReview key={p.id} plan={p} units={units} preparation={preparation} disabled={disabled} onSave={onEdit} onClose={() => setReview(undefined)} />}</>}<Pressable accessibilityRole="button" accessibilityLabel={`Cancel scheduled order: ${label}`} accessibilityState={{ disabled }} disabled={disabled} onPress={() => onCancel(p.id)} style={[s.cancel, disabled && s.disabled]}><Text style={s.text}>Cancel order</Text></Pressable></View>;
  }) : <Text style={s.detail}>No queued orders. Your plans remain private until execution.</Text>}</View>;
}
const s = StyleSheet.create({
  section: { gap: 9, marginVertical: 12 }, label: { color: '#96ad89', fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' }, options: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, option: { flexGrow: 1, alignItems: 'center', minWidth: 45, minHeight: 44, justifyContent: 'center', paddingHorizontal: 9, borderWidth: 1, borderColor: '#30442b' }, selected: { backgroundColor: '#263c20', borderColor: '#b8e986' }, text: { color: '#d6e2cd', fontSize: 12, lineHeight: 19 }, detail: { color: '#8c9f85', fontSize: 11, lineHeight: 18 }, queue: { gap: 13, padding: 18, borderWidth: 1, borderColor: '#30402e', backgroundColor: '#101b13' }, plan: { gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#30402e' }, cancel: { minHeight: 44, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#43563a', paddingHorizontal: 12 }, disabled: { opacity: 0.35 },
});
