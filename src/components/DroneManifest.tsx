/** Thumb-operated cargo selection, with exact entry and accessible adjustments. */
import React, { useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export function DroneManifest({ value, available, onChange, disabled = false, compact = false, label = 'Drones to dispatch' }: { value: string; available: number; onChange: (value: string) => void; disabled?: boolean; compact?: boolean; label?: string }) {
  const maximum = Math.max(0, Math.floor(available));
  const count = Number.isFinite(Number(value)) ? Number(value) : 0;
  const [width, setWidth] = useState(1);
  const current = useRef({ maximum, width, disabled, onChange });
  current.current = { maximum, width, disabled, onChange };
  const origin = useRef(0);
  function scrub(x: number) {
    const state = current.current;
    if (!state.disabled) state.onChange(String(Math.round(Math.max(0, Math.min(1, x / state.width)) * state.maximum)));
  }
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !current.current.disabled,
    onMoveShouldSetPanResponder: () => !current.current.disabled,
    onPanResponderGrant: event => { origin.current = event.nativeEvent.locationX; scrub(origin.current); },
    onPanResponderMove: (_event, gesture) => scrub(origin.current + gesture.dx),
  })).current;
  const change = (next: number) => onChange(String(Math.max(0, Math.min(maximum, next))));
  const button = (title: string, name: string, action: () => void) => <Pressable accessibilityRole="button" accessibilityLabel={name} disabled={disabled} accessibilityState={{ disabled }} onPress={action} style={s.button}><Text style={s.text}>{title}</Text></Pressable>;
  const percentage = maximum ? Math.max(0, Math.min(100, count / maximum * 100)) : 0;
  return <View style={[s.manifest, compact && { marginVertical: 0, gap: 0 }, disabled && { opacity: 0.4 }]}>
    {!compact && <View style={s.row}><Text style={s.text}>Drones</Text><Text style={s.detail}>{Math.max(0, maximum - count)} stay · {maximum} available</Text></View>}
    <View style={s.row}>
      {button('−', 'Send one fewer drone', () => change(count - 1))}
      <TextInput accessibilityLabel={label} editable={!disabled} keyboardType="number-pad" value={value} onChangeText={onChange} selectTextOnFocus style={s.input} />
      {button('+', 'Send one more drone', () => change(count + 1))}
      {button('½', 'Send half the drones', () => change(Math.floor(maximum / 2)))}
      {button('All', 'Send all drones', () => change(maximum))}
    </View>
    <View accessible accessibilityRole="adjustable" accessibilityLabel="Drone cargo" accessibilityState={{ disabled }} accessibilityValue={{ min: 0, max: maximum, now: Math.max(0, Math.min(maximum, count)), text: `${value} drones` }} accessibilityActions={[{ name: 'increment', label: 'One more drone' }, { name: 'decrement', label: 'One fewer drone' }]} onAccessibilityAction={event => { if (!disabled) change(count + (event.nativeEvent.actionName === 'increment' ? 1 : -1)); }} onLayout={event => setWidth(event.nativeEvent.layout.width)} {...pan.panHandlers} style={s.track}>
      <View pointerEvents="none" style={s.rail}><View style={[s.fill, { width: `${percentage}%` }]} /><View style={[s.thumb, { left: `${percentage}%` }]} /></View>
    </View>
  </View>;
}
const s = StyleSheet.create({
  manifest: { gap: 6, marginVertical: 10 }, row: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' }, text: { color: '#e5eadc', fontSize: 14 }, detail: { color: '#a0af9e', fontSize: 12 },
  button: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 8, backgroundColor: '#243522' },
  input: { flex: 1, minWidth: 48, minHeight: 44, color: '#e5eadc', fontSize: 22, textAlign: 'center', fontVariant: ['tabular-nums'], borderBottomWidth: 1, borderColor: '#58714c' },
  track: { height: 44, justifyContent: 'center', marginHorizontal: 14 }, rail: { height: 5, backgroundColor: '#344730', borderRadius: 3 }, fill: { height: 5, borderRadius: 3, backgroundColor: '#b8e986' }, thumb: { position: 'absolute', top: -11, marginLeft: -14, width: 28, height: 28, borderRadius: 14, backgroundColor: '#e5eadc', borderWidth: 3, borderColor: '#b8e986' },
});
