/** Objective and actual-clock controls for a paused tactical attempt. */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { gameClock } from '../game/time-machine';
import type { PracticeAttempt } from './Practice';
import { PracticeDialogue } from './PracticeDialogue';

type Props = PracticeAttempt & { status: 'active' | 'passed' | 'failed'; message: string; hour: number; inspected: boolean; resolving: boolean; canResolve: boolean; onResolve: () => void; onPause: () => void; onAdvance: (hours: number) => void; onNow: () => void };
export function PracticeStatus({ scenario, status, message, hour, inspected, resolving, canResolve, onResolve, onPause, onAdvance, onNow, onRetry, onBack, onNext }: Props) {
  const [hints, setHints] = useState(0);
  return <View style={s.panel}><View style={s.row}><Text accessibilityRole="header" style={s.title}>{scenario.title}</Text><Text style={s.detail}>{gameClock(hour)} · deadline {gameClock(scenario.deadline)}</Text></View>
    <Text accessibilityLiveRegion="polite" style={s.objective}>{status === 'active' ? scenario.instruction : status === 'passed' ? 'Exercise complete' : 'Try another plan'}</Text>
    <Text style={s.detail}>{message}</Text>
    {scenario.hints.slice(0, hints).map((hint, index) => <Text key={index} style={s.detail}>{hint}</Text>)}
    {status === 'active' && <Text style={s.detail}>{resolving ? 'Playing your orders through time. Pause to inspect or change the plan.' : 'Time is paused. Resolve orders plays your plan until completion or the deadline. Previewing time does not advance the mission.'}</Text>}
    <View style={s.row}>{status === 'active' && <>{resolving ? <Action label="Pause playback" onPress={onPause} /> : <><Action label="Resolve orders" disabled={!canResolve} onPress={onResolve} />{inspected ? <><Text style={s.detail}>Inspecting time. Return to Now to advance in steps.</Text><Action label="Now" onPress={onNow} /></> : <><Action label="Advance +15m" onPress={() => onAdvance(0.25)} /><Action label="Advance +1h" onPress={() => onAdvance(1)} /></>}</>}{hints < scenario.hints.length && <Action label="Show hint" onPress={() => setHints(value => value + 1)} />}</>}
      <PracticeDialogue scenario={scenario} status={status} hour={hour} playing={resolving} /><Action label="Retry exercise" onPress={onRetry} /><Action label="All exercises" onPress={onBack} />{status === 'passed' && onNext && <Action label="Next exercise" onPress={onNext} />}
    </View>
  </View>;
}
function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) { return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[s.button, disabled && { opacity: 0.4 }]}><Text style={s.action}>{label}</Text></Pressable>; }
const s = StyleSheet.create({
  panel: { gap: 6 }, row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }, title: { color: '#e5eadc', fontSize: 14, flexGrow: 1 }, objective: { color: '#b8e986', fontSize: 12 }, detail: { color: '#a8b7a2', fontSize: 11, lineHeight: 17 }, button: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center', borderWidth: 1, borderColor: '#40563a', backgroundColor: '#19271a' }, action: { color: '#b8e986', fontSize: 11 },
});
