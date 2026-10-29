/**
 * ---
 * purpose: Shared minute-precision time inspection with scrubbing, event jumps, and future-order context.
 * ---
 */
import React, { useRef, useState } from 'react';
import { Keyboard, PanResponder, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { scheduledOrderLabel } from './ScheduledOrders';
import type { ScheduledOrder } from '../game/orders';
import type { Fleet } from '../game/simulation';
import { MAX_PLAN_DELAY } from '../game/orders';
import { gameClock, inspectionMode, timelineHour } from '../game/time-machine';
import { OPENING_HOURS } from '../game/opening-clock';

type Props = { hour: number; inspectedHour: number | null; historyStart?: number; onChange: (hour: number | null) => void; events: readonly number[]; plans?: readonly ScheduledOrder[]; fleets?: readonly Fleet[]; rocks?: { id: string; name: string }[]; online?: boolean; compact?: boolean; forecastUncertain?: boolean; opening?: boolean };
export function TimeMachine({ hour, inspectedHour, historyStart, onChange, events, plans = [], fleets = [], rocks = [], online, compact, forecastUncertain, opening }: Props) {
  const [expanded, setExpanded] = useState(false);
  const mode = inspectionMode(hour, inspectedHour);
  const offset = (inspectedHour ?? hour) - hour;
  const start = Math.min(hour, historyStart ?? hour);
  const span = hour + MAX_PLAN_DELAY - start;
  const minimum = start - hour;
  const [entry, setEntry] = useState('6');
  const [trackWidth, setTrackWidth] = useState(1);
  const track = useRef<View>(null);
  const origin = useRef(0);
  function changeTime(next: number | null) { Keyboard.dismiss(); onChange(next); }
  const current = useRef({ hour, historyStart, onChange: changeTime, trackWidth });
  current.current = { hour, historyStart, onChange: changeTime, trackWidth };
  function scrub(x: number) {
    const { hour: live, historyStart: first, onChange: change, trackWidth: width } = current.current;
    change(timelineHour(live, first, x / width));
  }
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: event => { origin.current = event.nativeEvent.locationX; scrub(origin.current); },
    onPanResponderMove: (_event, gesture) => scrub(origin.current + gesture.dx),
  })).current;
  const markers = [...new Set([...events, ...(opening ? [OPENING_HOURS] : [])].filter(t => t >= start && t <= hour + MAX_PLAN_DELAY))].sort((a, b) => a - b);
  const next = markers.find(t => t > (inspectedHour ?? hour) + 1 / 3600);
  const previous = [...markers].reverse().find(t => t < (inspectedHour ?? hour) - 1 / 3600);
  const eventLabel = (at: number | undefined, fallback: string) => {
    const plan = plans.find(p => p.executeAt === at);
    return plan ? `${fallback}: ${scheduledOrderLabel(plan, rocks, plans, fleets)}` : fallback;
  };
  const parsed = Number(entry);
  const validEntry = entry.trim() !== '' && Number.isFinite(parsed) && parsed >= minimum && parsed <= MAX_PLAN_DELAY;
  const inspectEntry = () => {
    if (!validEntry) return;
    changeTime(parsed ? Math.max(start, hour + Math.round(parsed * 60) / 60) : null);
    if (compact) setExpanded(false);
  };
  const toggleExpanded = () => { if (expanded) Keyboard.dismiss(); setExpanded(!expanded); };
  const step = (delta: number) => { const nextOffset = Math.max(minimum, Math.min(MAX_PLAN_DELAY, offset + delta)); changeTime(nextOffset ? hour + nextOffset : null); };
  const position = (at: number) => Math.max(0, Math.min(100, (at - start) / span * 100));
  return <View style={[s.panel, compact && { paddingHorizontal: 12, paddingVertical: 0, gap: 0, borderWidth: 0 }]}>
    <View style={s.row}><Text style={s.state}>{mode === 'live' ? `Live · ${gameClock(hour)}` : `${mode === 'past' ? 'History' : 'Forecast'} · ${gameClock(inspectedHour!)}`}</Text><View style={{ flex: 1 }} />{compact ? <>{mode !== 'live' && <Control quiet label="Now" onPress={() => changeTime(null)} />}<Control quiet label={expanded ? 'Close time controls' : 'Time Machine'} onPress={toggleExpanded} /></> : <Text style={s.title}>Time Machine</Text>}</View>
    {(!compact || expanded) && <View style={s.row}><Text style={s.detail}>Hours from now</Text><TextInput accessibilityLabel="Hours from now" secureTextEntry={false} keyboardType="numbers-and-punctuation" value={entry} onChangeText={setEntry} style={s.input} onSubmitEditing={inspectEntry} /><Control label="Inspect" disabled={!validEntry} onPress={inspectEntry} /></View>}
    {mode === 'future' && forecastUncertain && <Text style={s.detail}>Some site details are unknown. Economy, routes, and outcomes may change.</Text>}
    {opening && (inspectedHour ?? hour) < OPENING_HOURS && (!compact || expanded) && <Text style={s.detail}>Opening 1.5× until {gameClock(OPENING_HOURS)}: haulers, recruitment, factories, and shield recharge.</Text>}
    {(!compact || expanded) && <View ref={track} onLayout={event => setTrackWidth(event.nativeEvent.layout.width)} {...pan.panHandlers} style={s.track} accessible accessibilityRole="adjustable" accessibilityLabel="Operation timeline" accessibilityValue={{ min: Math.round(minimum * 60), max: MAX_PLAN_DELAY * 60, now: Math.round(offset * 60), text: `${Math.abs(offset).toFixed(2)} hours ${offset < 0 ? 'ago' : 'ahead'}` }} accessibilityActions={[{ name: 'increment', label: 'One hour later' }, { name: 'decrement', label: 'One hour earlier' }]} onAccessibilityAction={event => step(event.nativeEvent.actionName === 'increment' ? 1 : -1)}>
      <View style={s.rail}><View style={[s.fill, { width: `${position(inspectedHour ?? hour)}%` }]} />{markers.map(t => <View key={t} style={[s.tick, { left: `${position(t)}%` }]} />)}<View style={[s.tick, { left: `${position(hour)}%`, backgroundColor: '#e5eadc', height: 18, top: -7 }]} /><View style={[s.thumb, { left: `${position(inspectedHour ?? hour)}%` }]} /></View>
    </View>}
    {(!compact || expanded) && <><View style={s.row}>{[0, 6, 24, 72, 168].map(h => <Control key={h} label={h ? `+${h < 24 ? `${h}h` : `${h / 24}d`}` : 'Now'} selected={h === 0 ? !offset : Math.abs(offset - h) < 1 / 60} onPress={() => changeTime(h ? hour + h : null)} />)}</View>
    <View style={s.row}><Control label="−1h" disabled={offset <= minimum} onPress={() => step(-1)} /><Control label="+1h" disabled={offset >= MAX_PLAN_DELAY} onPress={() => step(1)} /><Control text="‹ Event" label={eventLabel(previous, "Previous event")} disabled={previous === undefined} onPress={() => previous !== undefined && changeTime(previous)} /><Control text="Event ›" label={eventLabel(next, "Next event")} disabled={next === undefined} onPress={() => next !== undefined && changeTime(next)} /></View>
    {plans.filter(p => Math.abs(p.executeAt - (inspectedHour ?? hour)) < 1 / 3600).map(p => <Text key={`${p.owner}:${p.id}`} style={s.detail}>{gameClock(p.executeAt)} · {scheduledOrderLabel(p, rocks, plans, fleets)}</Text>)}
    {historyStart !== undefined && <View style={s.row}><Control label="History start" onPress={() => changeTime(historyStart)} /><Text style={s.detail}>Available from {gameClock(historyStart)}</Text></View>}
    <Text style={s.detail}>{mode === 'past' ? 'History is read-only. Only information observed at this time is available.' : mode === 'future' ? `Orders use this forecast time. Hidden forces and new ${online ? 'human' : 'rival'} orders can change the outcome.` : 'Drag through time to inspect known movement, production, and combat.'}</Text></>}
  </View>;
}
function Control({ label, text, selected, disabled, quiet, onPress }: { label: string; text?: string; selected?: boolean; disabled?: boolean; quiet?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled: !!disabled }} disabled={disabled} onPress={onPress} style={[s.control, quiet && { flexGrow: 0, borderWidth: 0 }, selected && s.selected, disabled && { opacity: 0.35 }]}><Text style={s.text}>{text ?? label}</Text></Pressable>;
}
const s = StyleSheet.create({
  panel: { gap: 10, padding: 16, backgroundColor: '#101b21', borderTopWidth: 1, borderColor: '#23363e' }, row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }, title: { color: '#e5eadc', fontSize: 15, flexGrow: 1 }, state: { color: '#bccacc', fontSize: 12, fontVariant: ['tabular-nums'] },
  track: { height: 44, justifyContent: 'center', marginHorizontal: 8 }, rail: { height: 4, backgroundColor: '#30442b' }, fill: { height: 4, backgroundColor: '#b8e986' }, tick: { position: 'absolute', width: 2, height: 12, top: -4, backgroundColor: '#8b9a82' }, thumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#b8e986', position: 'absolute', marginLeft: -9, top: -7 },
  control: { flexGrow: 1, minHeight: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#30442b' }, selected: { backgroundColor: '#263c20', borderColor: '#b8e986' }, text: { color: '#d6e2cd', fontSize: 12 }, detail: { color: '#8c9f85', fontSize: 11, lineHeight: 18 }, input: { minHeight: 44, width: 66, color: '#e5eadc', padding: 10, borderWidth: 1, borderColor: '#40563a' },
});
