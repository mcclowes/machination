/**
 * ---
 * purpose: Shared minute-precision time inspection with scrubbing, event jumps, and future-order context.
 * ---
 */
import React, { useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MAX_PLAN_DELAY } from '../game/orders';
import { gameClock, inspectionOffset } from '../game/time-machine';

type Props = { hour: number; inspectedHour: number | null; onChange: (hour: number | null) => void; events: readonly number[]; online?: boolean };
export function TimeMachine({ hour, inspectedHour, onChange, events, online }: Props) {
  const offset = inspectionOffset(hour, inspectedHour);
  const [entry, setEntry] = useState('6');
  const [trackWidth, setTrackWidth] = useState(1);
  const track = useRef<View>(null);
  const origin = useRef(0);
  const current = useRef({ hour, onChange, trackWidth });
  current.current = { hour, onChange, trackWidth };
  function scrub(x: number) {
    const { hour: live, onChange: change, trackWidth: width } = current.current;
    const minutes = Math.round(Math.max(0, Math.min(1, x / width)) * MAX_PLAN_DELAY * 60);
    change(minutes ? live + minutes / 60 : null);
  }
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: event => { origin.current = event.nativeEvent.locationX; scrub(origin.current); },
    onPanResponderMove: (_event, gesture) => scrub(origin.current + gesture.dx),
  })).current;
  const futureEvents = [...new Set(events.filter(t => t > hour + 1 / 3600 && t <= hour + MAX_PLAN_DELAY))].sort((a, b) => a - b);
  const next = futureEvents.find(t => t > (inspectedHour ?? hour) + 1 / 3600);
  const parsed = Number(entry);
  const validEntry = entry.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_PLAN_DELAY;
  return <View style={s.panel}>
    <View style={s.row}><Text style={s.title}>Time Machine</Text><Text style={s.state}>{offset ? `Forecast · ${gameClock(inspectedHour!)}` : `Live · ${gameClock(hour)}`}</Text></View>
    <View ref={track} onLayout={event => setTrackWidth(event.nativeEvent.layout.width)} {...pan.panHandlers} style={s.track} accessible accessibilityRole="adjustable" accessibilityLabel="Forecast timeline" accessibilityValue={{ min: 0, max: MAX_PLAN_DELAY * 60, now: Math.round(offset * 60), text: `${offset.toFixed(2)} hours ahead` }} accessibilityActions={[{ name: 'increment', label: 'One hour later' }, { name: 'decrement', label: 'One hour earlier' }]} onAccessibilityAction={event => onChange(hour + Math.max(0, Math.min(MAX_PLAN_DELAY, offset + (event.nativeEvent.actionName === 'increment' ? 1 : -1))))}>
      <View style={s.rail}><View style={[s.fill, { width: `${offset / MAX_PLAN_DELAY * 100}%` }]} />{futureEvents.map(t => <View key={t} style={[s.tick, { left: `${(t - hour) / MAX_PLAN_DELAY * 100}%` }]} />)}<View style={[s.thumb, { left: `${offset / MAX_PLAN_DELAY * 100}%` }]} /></View>
    </View>
    <View style={s.row}>{[0, 6, 24, 72, 168].map(h => <Control key={h} label={h ? `+${h < 24 ? `${h}h` : `${h / 24}d`}` : 'Now'} selected={h === 0 ? !offset : Math.abs(offset - h) < 1 / 60} onPress={() => onChange(h ? hour + h : null)} />)}</View>
    <View style={s.row}><Control label="−1h" onPress={() => onChange(offset > 1 ? hour + offset - 1 : null)} /><Control label="+1h" disabled={offset >= MAX_PLAN_DELAY} onPress={() => onChange(hour + Math.min(MAX_PLAN_DELAY, offset + 1))} /><Control label="Next event" disabled={next === undefined} onPress={() => next !== undefined && onChange(next)} /></View>
    <View style={s.row}><Text style={s.detail}>Hours ahead</Text><TextInput accessibilityLabel="Hours ahead" secureTextEntry={false} keyboardType="decimal-pad" value={entry} onChangeText={setEntry} style={s.input} onSubmitEditing={() => validEntry && onChange(parsed ? hour + Math.round(parsed * 60) / 60 : null)} /><Control label="Inspect" disabled={!validEntry} onPress={() => onChange(parsed ? hour + Math.round(parsed * 60) / 60 : null)} /></View>
    <Text style={s.detail}>{offset ? 'Plan a transfer on the chart to schedule it at this time. Future inventory is a prediction; launch requirements are checked at execution.' : 'Scrub ahead to inspect movement, production, and known outcomes. Tick marks show arrivals and planned launches.'}</Text>
    <Text style={s.detail}>{online ? 'Current observations only. Hidden forces and new human orders can change this future.' : 'Includes known orders and deterministic training rivals.'}</Text>
  </View>;
}
function Control({ label, selected, disabled, onPress }: { label: string; selected?: boolean; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled: !!disabled }} disabled={disabled} onPress={onPress} style={[s.control, selected && s.selected, disabled && { opacity: 0.35 }]}><Text style={s.text}>{label}</Text></Pressable>;
}
const s = StyleSheet.create({
  panel: { gap: 10, padding: 16, backgroundColor: '#0e1812', borderWidth: 1, borderColor: '#30442b' }, row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }, title: { color: '#e5eadc', fontSize: 15, flexGrow: 1 }, state: { color: '#b8e986', fontSize: 11, fontVariant: ['tabular-nums'] },
  track: { height: 44, justifyContent: 'center', marginHorizontal: 8 }, rail: { height: 4, backgroundColor: '#30442b' }, fill: { height: 4, backgroundColor: '#b8e986' }, tick: { position: 'absolute', width: 2, height: 12, top: -4, backgroundColor: '#8b9a82' }, thumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#b8e986', position: 'absolute', marginLeft: -9, top: -7 },
  control: { flexGrow: 1, minHeight: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#30442b' }, selected: { backgroundColor: '#263c20', borderColor: '#b8e986' }, text: { color: '#d6e2cd', fontSize: 12 }, detail: { color: '#8c9f85', fontSize: 11, lineHeight: 18 }, input: { minHeight: 44, width: 66, color: '#e5eadc', padding: 10, borderWidth: 1, borderColor: '#40563a' },
});
