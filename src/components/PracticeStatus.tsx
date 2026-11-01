/** Objective and actual-clock controls for a paused tactical attempt. Collapsed to one row by default. */
import React, { useState } from 'react';
import { displaySpecialistNames } from '../game/specialist-catalog';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { gameClock } from '../game/time-machine';
import type { PracticeAttempt } from './Practice';
import { PracticeDialogue } from './PracticeDialogue';

type Props = PracticeAttempt & { status: 'active' | 'passed' | 'failed'; message: string; hour: number; inspected: boolean; resolving: boolean; canResolve: boolean; onResolve: () => void; onPause: () => void; onAdvance: (hours: number) => void; onNow: () => void };
export function PracticeStatus({ scenario, status, message, hour, inspected, resolving, canResolve, onResolve, onPause, onAdvance, onNow, onRetry, onBack, onNext }: Props) {
  const [hints, setHints] = useState(0);
  const [open, setOpen] = useState(false);
  const active = status === 'active';
  // Outcomes always show their detail and the retry and exit links.
  const expanded = open || !active;
  const clock = <Text numberOfLines={1} style={s.clock}>{gameClock(hour)} / {gameClock(scenario.deadline)}</Text>;
  const controls = active && (resolving
    ? <Action label="Pause playback" text="Pause" onPress={onPause} />
    : <>
      <Action label="Resolve orders" text="Resolve" primary disabled={!canResolve} onPress={onResolve} />
      {inspected
        ? <Action label="Now" onPress={onNow} />
        : <><Action label="Advance +15m" text="+15m" onPress={() => onAdvance(0.25)} /><Action label="Advance +1h" text="+1h" onPress={() => onAdvance(1)} /></>}
    </>);
  return <View style={s.panel}>
    <View style={s.bar}>
      <Pressable accessibilityRole="button" accessibilityLabel={open ? 'Hide instructions' : 'Show instructions'} accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)} style={s.summary}>
        <Text accessibilityRole="header" numberOfLines={1} style={s.title}>{scenario.title}</Text>
        <View style={s.meta}>{clock}<Text accessible={false} style={s.chevron}>{open ? '▴' : '▾'}</Text></View>
      </Pressable>
      {controls}
      {status === 'passed' && onNext && <Action label="Next exercise" primary onPress={onNext} />}
    </View>
    {(open || !active) && <Text accessibilityLiveRegion="polite" style={s.objective}>{active ? displaySpecialistNames(scenario.instruction) : status === 'passed' ? 'Exercise complete' : 'Try another plan'}</Text>}
    {(open || !active) && <Text style={s.detail}>{displaySpecialistNames(message)}</Text>}
    {open && scenario.hints.slice(0, hints).map((hint, index) => <Text key={index} style={s.detail}>{displaySpecialistNames(hint)}</Text>)}
    {open && active && <Text style={s.detail}>{resolving ? 'Playing your orders through time. Pause to inspect or change the plan.' : inspected ? 'Inspecting time. Return to Now to advance in steps.' : canResolve ? 'Time is paused. Resolve orders plays your plan to completion or the deadline.' : 'Time is paused. Give an order on the chart, then resolve it.'}</Text>}
    {/* One fixed position: remounting the dialogue would replay a dismissed briefing. */}
    <View style={s.links}>{open && active && hints < scenario.hints.length && <Action label="Show hint" quiet onPress={() => setHints(value => value + 1)} />}<PracticeDialogue scenario={scenario} status={status} hour={hour} playing={resolving} trigger={expanded} />{expanded && <><Action label="Retry exercise" quiet onPress={onRetry} /><Action label="All exercises" quiet onPress={onBack} /></>}</View>
  </View>;
}
function Action({ label, text = label, onPress, disabled = false, primary = false, quiet = false }: { label: string; text?: string; onPress: () => void; disabled?: boolean; primary?: boolean; quiet?: boolean }) {
  const filled = primary && !disabled;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[quiet ? s.quiet : s.button, filled && s.primary, disabled && { opacity: 0.4 }]}><Text style={[s.action, filled && s.primaryText, quiet && s.quietText]}>{text}</Text></Pressable>;
}
const s = StyleSheet.create({
  panel: { gap: 4 }, bar: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summary: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' }, meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: '#e5eadc', fontSize: 13 }, clock: { color: '#8c9f85', fontSize: 11, flexShrink: 1 }, chevron: { color: '#b8e986', fontSize: 11 },
  objective: { color: '#b8e986', fontSize: 12 }, detail: { color: '#a8b7a2', fontSize: 11, lineHeight: 17 },
  links: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  button: { minHeight: 40, minWidth: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#40563a', backgroundColor: '#19271a' }, action: { color: '#b8e986', fontSize: 12 },
  primary: { backgroundColor: '#b8e986', borderColor: '#b8e986' }, primaryText: { color: '#182312', fontWeight: '600' },
  quiet: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 }, quietText: { color: '#8c9f85', textDecorationLine: 'underline' },
});
