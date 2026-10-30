/**
 * ---
 * purpose: Launch timing and a collapsible order queue with time inspection and selected manifest editing.
 * ---
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MODULES } from '../game/modules';
import { isScheduledLaunch, type LaunchEdit, type ScheduledOrder } from '../game/orders';
import { LaunchReview } from './LaunchReview';
import type { LaunchUnit } from './launch-manifest';
import { actionLabel, isActionPlan, type FutureAction } from '../game/future-actions';
import { gameClock, relativeInspectionTime } from '../game/time-machine';
import { FACTIONS, type Faction } from '../game/players';
import type { Fleet } from '../game/simulation';
type TimingProps = { delay: number; disabled: boolean; onChange: (delay: number) => void; future?: boolean; compact?: boolean };
export function LaunchTiming({ delay, disabled, onChange, future, compact }: TimingProps) {
  const [expanded, setExpanded] = useState(false);
  if (compact && !expanded) return <Pressable accessibilityRole="button" accessibilityLabel="Change launch timing" onPress={() => setExpanded(true)} style={s.cancel}><Text style={s.text}>{delay ? `Launch in ${delay}h` : future ? 'Launch at forecast time' : 'Launch now'} · change timing</Text></Pressable>;
  return <View style={s.section}><Text style={s.label}>Launch timing</Text><View style={s.options}>{[0, 1, 6, 12, 24, 48, 72, 168].map(h => <Pressable key={h} accessibilityRole="button" accessibilityState={{ selected: delay === h, disabled }} disabled={disabled} onPress={() => onChange(h)} style={[s.option, delay === h && s.selected, disabled && s.disabled]}><Text style={s.text}>{h ? h >= 24 ? `+${h / 24}d` : `+${h}h` : future ? 'At forecast' : 'Now'}</Text></Pressable>)}</View>{delay > 0 && <Text style={s.detail}>Drones aren't reserved. Ownership, inventory, and the full manifest must still permit a launch at execution time.</Text>}</View>;
}
function queueActionLabel(action: FutureAction, rocks: { id: string; name: string }[], route?: string) {
  if (action.type !== 'hauler') return actionLabel(action, rocks);
  const change = action.change;
  const labels = { 'cancel-launch': 'Cancel launch', 'edit-launch': 'Edit manifest', course: 'Change course', gift: 'Make gift', 'cancel-gift': 'Cancel gift', 'cancel-course': 'Cancel course change' };
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
type QueueProps = { owner?: Faction; plans: ScheduledOrder[]; fleets?: readonly Fleet[]; hour: number; rocks: { id: string; name: string }[]; disabled: boolean; onCancel: (id: string) => void; onInspect: (hour: number) => void; onEdit: (change: LaunchEdit) => void; units: LaunchUnit[]; preparation: boolean; compact?: boolean };
const orderIcons: Record<FutureAction['type'], string> = { gift: '◇', intercept: '⌖', hauler: '↗', hire: '+', promote: '★', release: '↥', 'drill-mine': '▼', shields: '◉', funding: '⇄' };
export function ScheduledOrders({ owner, plans, fleets = [], hour, rocks, disabled, onCancel, onInspect, onEdit, units, preparation, compact }: QueueProps) {
  const [review, setReview] = useState<string>();
  const [expanded, setExpanded] = useState(true);
  const queue = plans.length ? [...plans].sort((a, b) => a.executeAt - b.executeAt).map(p => {
    const readOnly = disabled || owner !== undefined && p.owner !== owner;
    const reviewKey = `${p.owner}:${p.id}`;
    const action = isActionPlan(p);
    const label = scheduledOrderLabel(p, rocks, plans, fleets);
    const selected = review === reviewKey;
    return <View key={reviewKey} style={s.plan}>
      <View style={s.orderRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Cancel scheduled order: ${label}`} accessibilityState={{ disabled: readOnly }} disabled={readOnly} onPress={() => onCancel(p.id)} style={[s.cancelIcon, readOnly && s.disabled]}><Text style={s.icon}>×</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Inspect scheduled order: ${label}`} accessibilityHint={`${relativeInspectionTime(hour, p.executeAt)}. Inspect this time and show order details.`} accessibilityState={{ expanded: selected }} onPress={() => { setReview(selected ? undefined : reviewKey); onInspect(p.executeAt); }} style={[s.summary, selected && s.selected]}>
          <Text accessible={false} style={s.icon}>{action ? orderIcons[p.action.type] : '↗'}</Text>
          <View style={s.description}><Text style={s.text} numberOfLines={1}>{label}</Text><Text style={s.detail}>{relativeInspectionTime(hour, p.executeAt)}{owner !== undefined && p.owner !== owner ? ` · ${FACTIONS[p.owner].name}` : ''}</Text></View>
          <Text accessible={false} style={s.detail}>{selected ? '⌃' : '⌄'}</Text>
        </Pressable>
      </View>
      {selected && <View style={s.review}><Text style={s.detail}>{gameClock(p.executeAt)}{readOnly ? ' · read-only' : ''}{action && (p.action.type === 'gift' || p.action.type === 'intercept') ? ` · ${p.action.drones} drones` : !action ? ` · ${p.drones} drones${p.module ? ` · ${MODULES[p.module].name}` : ''}` : ''}</Text>{isScheduledLaunch(p) && <LaunchReview key={reviewKey} plan={p} units={units} preparation={preparation} disabled={readOnly} onSave={onEdit} onClose={() => setReview(undefined)} />}</View>}
    </View>;
  }) : <Text style={s.detail}>No queued orders.</Text>;
  return <View style={[s.queue, compact && s.compactQueue]}>
    <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Hide scheduled orders' : 'Show scheduled orders'} accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={s.queueHeading}><Text style={s.label}>Scheduled orders / {plans.length}</Text><Text style={s.detail}>{expanded ? '⌃' : '⌄'}</Text></Pressable>
    {expanded && (compact ? <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={[s.queueScroll, review !== undefined && s.reviewScroll]} contentContainerStyle={s.queueBody}>{queue}</ScrollView> : queue)}
  </View>;
}
const s = StyleSheet.create({
  compactQueue: { padding: 0, borderWidth: 0, backgroundColor: 'transparent', gap: 0 }, queueHeading: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, queueScroll: { maxHeight: 104 }, reviewScroll: { maxHeight: 164 }, queueBody: { gap: 2 }, orderRow: { flexDirection: 'row', alignItems: 'center' }, cancelIcon: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, icon: { color: '#d6e2cd', fontSize: 20 }, summary: { flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }, description: { flex: 1, minWidth: 0 }, review: { padding: 10, gap: 8 },
  section: { gap: 9, marginVertical: 12 }, label: { color: '#96ad89', fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' }, options: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, option: { flexGrow: 1, alignItems: 'center', minWidth: 45, minHeight: 44, justifyContent: 'center', paddingHorizontal: 9, borderWidth: 1, borderColor: '#30442b' }, selected: { backgroundColor: '#263c20', borderColor: '#b8e986' }, text: { color: '#d6e2cd', fontSize: 12, lineHeight: 19 }, detail: { color: '#8c9f85', fontSize: 11, lineHeight: 18 }, queue: { gap: 6, padding: 12, borderWidth: 1, borderColor: '#30402e', backgroundColor: '#101b13' }, plan: { borderBottomWidth: 1, borderColor: '#30402e' }, cancel: { minHeight: 44, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#43563a', paddingHorizontal: 12 }, disabled: { opacity: 0.35 },
});
