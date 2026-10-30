/** Exercise selection and completion metadata; attempt gameplay stays in the shared operation UI. */
import React, { useEffect, useState } from 'react';
import { displaySpecialistNames } from '../game/specialist-catalog';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TRAINING_SCENARIOS, type TrainingId, type TrainingScenario } from '../game/training';
import { trainingProgressStore } from '../game/training-progress';

export type PracticeAttempt = { scenario: TrainingScenario; onPassed: () => void; onRetry: () => void; onBack: () => void; onNext?: () => void };
const progress = trainingProgressStore(AsyncStorage);
export function Practice({ children }: { children: (attempt: PracticeAttempt, key: string) => React.ReactNode }) {
  const [selected, setSelected] = useState<TrainingId>();
  const [attempt, setAttempt] = useState(0);
  const [completed, setCompleted] = useState<TrainingId[]>([]);
  const [error, setError] = useState('');
  const [unsaved, setUnsaved] = useState<TrainingId>();
  function load() { void progress.load().then(value => { setCompleted(value); setError(''); }).catch(error => setError((error as Error).message)); }
  useEffect(load, []);
  function complete(id: TrainingId) {
    void progress.complete(id).then(value => { setCompleted(value); setUnsaved(undefined); setError(''); }).catch(() => { setUnsaved(id); setError('Exercise passed. Progress could not be saved.'); });
  }
  const scenario = TRAINING_SCENARIOS.find(item => item.id === selected);
  const next = scenario && TRAINING_SCENARIOS[TRAINING_SCENARIOS.indexOf(scenario) + 1];
  function choose(id: TrainingId) { setSelected(id); setAttempt(value => value + 1); }
  const notice = !!error && <View style={s.notice}><Text accessibilityRole="alert" style={s.detail}>{error}</Text><Action label={unsaved ? 'Retry saving progress' : 'Retry loading progress'} onPress={() => unsaved ? complete(unsaved) : load()} /></View>;
  if (scenario) return <View style={s.fill}>{notice}{children({ scenario, onPassed: () => complete(scenario.id), onRetry: () => setAttempt(value => value + 1), onBack: () => setSelected(undefined), ...(next ? { onNext: () => choose(next.id) } : {}) }, `${scenario.id}:${attempt}`)}</View>;
  return <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled"><Text accessibilityRole="header" style={s.title}>Tactical practice</Text><Text style={s.detail}>Use the real chart and orders to solve each exercise. Time advances when you choose. Retry to try another plan.</Text>{notice}
    {TRAINING_SCENARIOS.map((item, index) => <View key={item.id} style={s.card}><Text style={s.heading}>{index + 1}. {item.title}{completed.includes(item.id) ? ' · completed' : ''}</Text><Text style={s.detail}>{displaySpecialistNames(item.objective)}</Text><Action label={`Start: ${item.title}`} onPress={() => choose(item.id)} /></View>)}
  </ScrollView>;
}
function Action({ label, onPress }: { label: string; onPress: () => void }) { return <Pressable accessibilityRole="button" onPress={onPress} style={s.button}><Text style={s.action}>{label}</Text></Pressable>; }
const s = StyleSheet.create({
  fill: { flex: 1 }, page: { padding: 20, gap: 16 }, title: { color: '#e5eadc', fontSize: 24 }, heading: { color: '#e5eadc', fontSize: 17 }, detail: { color: '#a8b7a2', fontSize: 13, lineHeight: 20 }, card: { padding: 16, gap: 12, backgroundColor: '#101b13', borderWidth: 1, borderColor: '#40563a' }, notice: { padding: 12, gap: 8 }, button: { minHeight: 44, padding: 12, backgroundColor: '#19271a', borderWidth: 1, borderColor: '#40563a', justifyContent: 'center' }, action: { color: '#b8e986', fontSize: 13 },
});
