/**
 * ---
 * purpose: Shared first-launch briefing and rules reference for both operation modes.
 * ---
 */
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ArtArchive, ArtworkImage } from './Artwork';
import type { ArtworkId } from './artwork-catalog';
import { SpecialistsCheatsheet } from './SpecialistsCheatsheet';
import { MUSIC_CREDITS } from '../audio/music-credits';
import { FIELD_MANUAL_SECTIONS as sections } from '../content/field-manual';
const ACKNOWLEDGED = 'machination.briefing.v1';

const illustrations: Partial<Record<typeof sections[number][0], ArtworkId>> = {
  'Your mandate': 'mining-world', 'Your first transfer': 'fleet-sheet',
  'Production and time': 'mining-drones', 'Specialists and interception': 'ritual-tech-clash',
  Gifts: 'command-bridge', Sensors: 'cloaked-ship', 'Time Machine': 'time-ship',
  'Private scheduled orders': 'industrial-cockpit',
};
export function FieldManual({ compact = false }: { compact?: boolean } = {}) {
  const [visible, setVisible] = useState(false);
  const [briefing, setBriefing] = useState(false);
  const [archive, setArchive] = useState(false);
  const [specialists, setSpecialists] = useState(false);
  const interacted = useRef(false);
  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(ACKNOWLEDGED).then(value => {
      if (mounted && !interacted.current && value !== '1') { setBriefing(true); setVisible(true); }
    }).catch(() => { if (mounted && !interacted.current) { setBriefing(true); setVisible(true); } });
    return () => { mounted = false; };
  }, []);
  function close() {
    interacted.current = true; setVisible(false); setBriefing(false); setArchive(false); setSpecialists(false);
    // A failed preference write only repeats the briefing on the next launch.
    void AsyncStorage.setItem(ACKNOWLEDGED, '1').catch(() => undefined);
  }
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Open field manual" onPress={() => { interacted.current = true; setBriefing(false); setVisible(true); }} style={[s.trigger, compact && { minWidth: 44, backgroundColor: 'transparent', borderWidth: 0 }]}><Text style={s.triggerText}>{compact ? '?' : 'Manual'}</Text></Pressable>
    <Modal visible={visible} animationType={Platform.OS === 'web' ? 'none' : 'slide'} onRequestClose={close}>
      <SafeAreaProvider><SafeAreaView style={s.safe}>
        <View style={s.header}><Text accessibilityRole="header" style={s.title}>{archive ? 'Art archive' : briefing ? 'Welcome, intelligence.' : 'Field manual'}</Text><Pressable accessibilityRole="button" accessibilityLabel={archive ? 'Return to field manual' : 'Open art archive'} onPress={() => setArchive(!archive)} style={s.trigger}><Text style={s.triggerText}>{archive ? 'Manual' : 'Art archive'}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Close field manual" onPress={close} style={s.trigger}><Text style={s.triggerText}>Close</Text></Pressable></View>
        {!briefing && !archive && <View accessibilityRole="tablist" style={s.navigation}>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: !specialists }} onPress={() => setSpecialists(false)} style={[s.trigger, !specialists && s.selected]}><Text style={s.triggerText}>Rules</Text></Pressable>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: specialists }} onPress={() => setSpecialists(true)} style={[s.trigger, specialists && s.selected]}><Text style={s.triggerText}>Specialists cheatsheet</Text></Pressable>
        </View>}
        {archive ? <ArtArchive /> : specialists && !briefing ? <SpecialistsCheatsheet /> : <ScrollView contentContainerStyle={s.content}>
          <Text style={s.intro}>Your corporation is too far away to interfere. Start with tactical practice to learn the chart, orders, specialists, and Time Machine. Then play solo or negotiate with human rivals.</Text>
          {(briefing ? sections.slice(0, 3) : sections).map(([title, body]) => <View key={title} style={s.section}>{illustrations[title] && <ArtworkImage id={illustrations[title]} />}<Text accessibilityRole="header" style={s.heading}>{title}</Text><Text style={s.body}>{body}</Text></View>)}
          {!briefing && <View style={s.section}><Text accessibilityRole="header" style={s.heading}>Music credits</Text><Text style={s.body}>The soundtrack follows known battles in your live operation. Sound mutes both music and effects.</Text>{MUSIC_CREDITS.map(track => <Text key={track.title} style={s.body}>{track.title} · Music by {track.artist}</Text>)}</View>}
          {briefing && <Pressable accessibilityRole="button" onPress={() => setBriefing(false)} style={s.trigger}><Text style={s.triggerText}>Read the full field manual</Text></Pressable>}
          <Pressable accessibilityRole="button" onPress={close} style={s.begin}><Text style={s.beginText}>Return to command</Text></Pressable>
        </ScrollView>}
      </SafeAreaView></SafeAreaProvider>
    </Modal>
  </>;
}
const s = StyleSheet.create({
  navigation: { width: '100%', maxWidth: 720, alignSelf: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 24, paddingVertical: 12 }, selected: { borderColor: '#b8e986' },
  safe: { flex: 1, backgroundColor: '#080f0d' }, header: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1, borderColor: '#30402e' },
  title: { color: '#e5eadc', fontSize: 23, flex: 1 }, trigger: { minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center', padding: 10, backgroundColor: '#162217', borderWidth: 1, borderColor: '#30442b' }, triggerText: { color: '#b8e986', fontSize: 12 },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 24, gap: 24 }, intro: { color: '#b8e986', fontSize: 16, lineHeight: 25 }, section: { gap: 8 }, heading: { color: '#e5eadc', fontSize: 18 }, body: { color: '#a8b8a2', fontSize: 15, lineHeight: 24 }, begin: { minHeight: 48, padding: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#b8e986', marginBottom: 12 }, beginText: { color: '#182312', fontWeight: '600', fontSize: 14 },
});
