/** Practice radio overlay and attempt-local playback. The exercise clock stays under player control. */
import React, { useState } from 'react';
import { displaySpecialistNames } from '../game/specialist-catalog';
import { Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TrainingScenario } from '../game/training';
import { TRAINING_DIALOGUE, trainingDialoguePhase, type DialoguePhase, type DialogueSpeaker } from '../game/training-dialogue';

const speakers = {
  commander: { name: 'Admiral', role: 'Command channel', color: '#b8e986', art: require('../../assets/players/dialogue/admiral.png') },
  enemy: { name: 'Vesper', role: 'Hostile transmission', color: '#e49a78', art: require('../../assets/players/dialogue/vesper.png') },
};
const phaseLabels = { briefing: 'Mission briefing', underway: 'Incoming transmission', passed: 'Mission complete', failed: 'Mission debrief' };

export function PracticeDialogue({ scenario, status, hour, playing = false }: { scenario: TrainingScenario; status: 'active' | 'passed' | 'failed'; hour: number; playing?: boolean }) {
  const { width, height } = useWindowDimensions();
  const compact = width < 600;
  const landscape = height < 500;
  const [dismissed, setDismissed] = useState<DialoguePhase[]>([]);
  const [replaying, setReplaying] = useState(false);
  const phase = replaying ? 'briefing' : trainingDialoguePhase(status, hour);
  const [cursor, setCursor] = useState({ phase, index: 0 });
  const lines = TRAINING_DIALOGUE[scenario.id][phase];
  const index = cursor.phase === phase ? cursor.index : 0;
  const line = lines[index]!;
  const speaker = speakers[line.speaker];
  const visible = !playing && (replaying || !dismissed.includes(phase));
  const last = index === lines.length - 1;
  const continueLabel = !last ? 'Continue dialogue' : phase === 'briefing' ? 'Take command' : 'Return to chart';
  function close() {
    setDismissed(value => value.includes(phase) ? value : [...value, phase]);
    setCursor({ phase, index: 0 });
    setReplaying(false);
  }
  const artHeight = Math.max(64, Math.min(height - (landscape ? 300 : 440), height * 0.45, compact ? 290 : 460));

  return <>
    <Pressable accessibilityRole="button" disabled={playing} onPress={() => { setCursor({ phase: 'briefing', index: 0 }); setReplaying(true); }} style={[s.replay, playing && { opacity: 0.4 }]}><Text style={s.replayText}>Replay briefing</Text></Pressable>
    <Modal visible={visible} transparent animationType={Platform.OS === 'web' ? 'none' : 'fade'} onRequestClose={close}>
      <SafeAreaView style={s.overlay} accessibilityViewIsModal>
        <View style={[s.mission, (compact || landscape) && s.missionCompact]}><Text style={s.eyebrow}>{phaseLabels[phase]}</Text><Text accessibilityRole="header" style={s.missionTitle}>{scenario.title}</Text>{!landscape && <Text style={s.missionDetail}>{displaySpecialistNames(scenario.objective)}</Text>}</View>
        <View style={[s.scene, { maxWidth: 1180, paddingHorizontal: compact ? 12 : 40 }]}>
          <View pointerEvents="none" accessible={false} style={[s.portraits, { height: artHeight }]}>
            {(['commander', 'enemy'] as const).map((id: DialogueSpeaker) => <Image key={id} accessible={false} source={speakers[id].art} resizeMode="contain" style={[s.portrait, { height: artHeight, opacity: line.speaker === id ? 1 : 0.38 }, id === 'enemy' && s.enemyPortrait]} />)}
          </View>
          <View style={s.frame}>
            <View style={[s.nameplate, { borderLeftColor: speaker.color }]}><Text style={[s.speaker, { color: speaker.color }]}>{speaker.name}</Text><Text style={s.channel}>{speaker.role}</Text></View>
            <ScrollView key={`${phase}:${index}`} style={{ maxHeight: height * (landscape ? 0.25 : 0.28) }} contentContainerStyle={s.dialogueContent}>
              <Text accessibilityLiveRegion="polite" style={[s.dialogue, compact && s.compactDialogue]}>{displaySpecialistNames(line.text)}</Text>
            </ScrollView>
            <View style={s.footer}>
              <Text style={s.counter}>{index + 1} / {lines.length}</Text>
              <Pressable accessibilityRole="button" onPress={close} style={s.skip}><Text style={s.skipText}>Skip dialogue</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={continueLabel} onPress={() => last ? close() : setCursor({ phase, index: index + 1 })} style={s.next}><Text style={s.nextText}>{continueLabel} <Text accessible={false}>▸</Text></Text></Pressable>
            </View>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  </>;
}

const s = StyleSheet.create({
  replay: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderColor: '#40563a', backgroundColor: '#19271a' }, replayText: { color: '#b8e986', fontSize: 11 },
  overlay: { flex: 1, justifyContent: 'space-between', backgroundColor: 'rgba(5, 12, 16, 0.36)' },
  mission: { alignSelf: 'flex-start', margin: 24, padding: 14, gap: 6, maxWidth: 460, backgroundColor: '#14232b', borderWidth: 1, borderColor: '#30454c' }, missionCompact: { margin: 12, padding: 10 },
  eyebrow: { color: '#b8e986', fontSize: 11 }, missionTitle: { color: '#e5eadc', fontSize: 15 }, missionDetail: { color: '#a8b7a2', fontSize: 12, lineHeight: 18 },
  scene: { width: '100%', alignSelf: 'center', paddingBottom: 14, flexShrink: 1 },
  portraits: { flexDirection: 'row', justifyContent: 'space-between', overflow: 'hidden' },
  portrait: { width: '47%', alignSelf: 'flex-end', transform: [{ scaleX: -1 }] }, enemyPortrait: { marginLeft: 'auto' },
  nameplate: { gap: 4, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#101b21', borderLeftWidth: 2, borderBottomWidth: 1, borderBottomColor: '#23363e' },
  speaker: { fontSize: 14, fontWeight: '600' }, channel: { color: '#a8b7a2', fontSize: 11 },
  frame: { borderWidth: 1, borderColor: '#30454c', backgroundColor: '#14232b' },
  dialogueContent: { padding: 16 },
  dialogue: { color: '#d6e2cd', fontSize: 17, lineHeight: 25 }, compactDialogue: { fontSize: 15, lineHeight: 22 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderTopWidth: 1, borderColor: '#23363e', flexWrap: 'wrap' }, counter: { color: '#8c9f85', fontSize: 11, marginRight: 'auto' },
  skip: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center', borderWidth: 1, borderColor: '#40563a', backgroundColor: '#19271a' }, skipText: { color: '#b8e986', fontSize: 11 },
  next: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: '#b8e986' }, nextText: { color: '#182312', fontSize: 11, fontWeight: '600' },
});
