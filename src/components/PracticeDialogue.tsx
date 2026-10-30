/** JRPG radio overlay and attempt-local playback. The exercise clock stays under player control. */
import React, { useState } from 'react';
import { displaySpecialistNames } from '../game/specialist-catalog';
import { Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TrainingScenario } from '../game/training';
import { TRAINING_DIALOGUE, trainingDialoguePhase, type DialoguePhase, type DialogueSpeaker } from '../game/training-dialogue';

const speakers = {
  commander: { name: 'Admiral', role: 'Command channel', color: '#dbbc77', art: require('../../assets/players/dialogue/admiral.png') },
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
          <View style={[s.nameRow, line.speaker === 'enemy' && s.enemyNameRow]}><View style={[s.nameplate, { borderColor: speaker.color }, line.speaker === 'enemy' && s.enemyPlate]}><Text style={[s.speaker, { color: speaker.color }]}>{speaker.name}</Text><Text style={s.channel}>{speaker.role}</Text></View></View>
          <View style={[s.frame, { borderColor: speaker.color }]}>
            <View style={s.innerFrame}>
              <ScrollView key={`${phase}:${index}`} style={{ maxHeight: height * (landscape ? 0.25 : 0.28) }} contentContainerStyle={s.dialogueContent}>
                <Text accessibilityLiveRegion="polite" style={[s.dialogue, compact && s.compactDialogue]}>{displaySpecialistNames(line.text)}</Text>
              </ScrollView>
              <View style={s.footer}>
                <Text style={s.counter}>{index + 1} / {lines.length}</Text>
                <Pressable accessibilityRole="button" onPress={close} style={s.skip}><Text style={s.skipText}>Skip dialogue</Text></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={continueLabel} onPress={() => last ? close() : setCursor({ phase, index: index + 1 })} style={[s.next, { borderColor: speaker.color }]}><Text style={[s.nextText, { color: speaker.color }]}>{continueLabel} <Text accessible={false}>▸</Text></Text></Pressable>
              </View>
            </View>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  </>;
}

const s = StyleSheet.create({
  replay: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderColor: '#776746', backgroundColor: '#222a25' }, replayText: { color: '#dbbc77', fontSize: 11 },
  overlay: { flex: 1, justifyContent: 'space-between', backgroundColor: 'rgba(5, 12, 16, 0.36)' },
  mission: { alignSelf: 'flex-start', margin: 24, padding: 14, gap: 5, maxWidth: 460, backgroundColor: 'rgba(15, 27, 32, 0.94)', borderLeftWidth: 3, borderLeftColor: '#dbbc77' }, missionCompact: { margin: 12, padding: 10 },
  eyebrow: { color: '#dbbc77', fontSize: 10, letterSpacing: 2 }, missionTitle: { color: '#f0e5ce', fontSize: 19, fontWeight: '600' }, missionDetail: { color: '#b7c2b9', fontSize: 12, lineHeight: 18 },
  scene: { width: '100%', alignSelf: 'center', paddingBottom: 14, flexShrink: 1 },
  portraits: { flexDirection: 'row', justifyContent: 'space-between', overflow: 'hidden', marginBottom: -28 },
  portrait: { width: '47%', alignSelf: 'flex-end', transform: [{ scaleX: -1 }] }, enemyPortrait: { marginLeft: 'auto' },
  nameRow: { alignItems: 'flex-start', paddingLeft: 16, zIndex: 1 }, enemyNameRow: { alignItems: 'flex-end', paddingLeft: 0, paddingRight: 16 },
  nameplate: { minWidth: 156, paddingHorizontal: 18, paddingVertical: 9, backgroundColor: '#253134', borderWidth: 2, borderBottomWidth: 0, borderTopLeftRadius: 10, borderTopRightRadius: 3 }, enemyPlate: { backgroundColor: '#462b25' },
  speaker: { fontSize: 21, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' }, channel: { color: '#c1beb0', fontSize: 10, marginTop: 3, letterSpacing: 0.5 },
  frame: { padding: 3, borderWidth: 2, borderTopLeftRadius: 7, borderBottomRightRadius: 12, backgroundColor: '#182126', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  innerFrame: { backgroundColor: 'rgba(20, 30, 34, 0.98)', borderWidth: 1, borderColor: '#5a6258' }, dialogueContent: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 10 },
  dialogue: { color: '#f2e9d7', fontSize: 21, lineHeight: 31, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' }, compactDialogue: { fontSize: 17, lineHeight: 25 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 8, flexWrap: 'wrap' }, counter: { color: '#9eaa9f', fontSize: 11, marginRight: 'auto' },
  skip: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' }, skipText: { color: '#b1b8ac', fontSize: 11 },
  next: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: '#2c3532', borderWidth: 1, borderRadius: 3 }, nextText: { fontSize: 12, fontWeight: '600' },
});
