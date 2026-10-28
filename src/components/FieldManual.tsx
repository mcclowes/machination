/**
 * ---
 * purpose: Shared first-launch briefing and rules reference for both operation modes.
 * ---
 */
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
const ACKNOWLEDGED = 'machination.briefing.v1';
const sections = [
  ['Your mandate', 'You are a mining intelligence. Reach 300 cargo or capture both rival cores. Losing your own core eliminates you and releases your remaining rocks.'],
  ['Your first transfer', 'Select one of your controlled rocks, choose Plan transfer, then select a destination on the chart. Set a whole-number drone manifest and launch. Drones leave immediately. Friendly arrivals reinforce; hostile arrivals trade drones one for one. A surplus claims the rock. A tie leaves its owner unchanged.'],
  ['Production and time', 'Cores and reactors produce 4 drones per hour. Extraction rocks produce 2 cargo per hour while controlled. Normal transfers take at least one hour and cannot turn back. Operations continue while you are away. Solo has AI rivals and a +6h accelerator. Multiplayer runs in real time.'],
  ['Modules and interception', 'Build a module using a rock’s drones, then choose whether to carry it. Parked modules have no combat effect. Routing daemons speed up transfers; viruses convert enemy drones; charges sacrifice their payload to damage enemies. A scavenger rig can intercept a reachable enemy hauler and salvage combat losses. Surviving rigs return home after interception. Read the module bay descriptions for costs and effects.'],
  ['Sensors', 'Multiplayer rocks see 32 map units; your haulers see 16. Unknown rocks keep their chart location but hide ownership and inventory. Enemy haulers disappear outside sensor range. Only your cargo total is visible. Solo training shows the full map.'],
  ['Forecasts are conditional', 'Now is the live state. +6h, +12h, and +24h project known movement and production without advancing the operation. Return to Now before issuing orders. Solo includes deterministic AI orders; multiplayer cannot predict new rival orders or hidden forces. Unknown destination and interception outcomes stay unresolved.'],
  ['Private scheduled orders', 'Choose a launch delay to queue a transfer up to seven days ahead. Plans reserve neither drones nor modules. The full manifest must be available when it launches, or it aborts. Only you see your plans. Cancel before execution; a launch already processed cannot be undone. Interceptions launch immediately.'],
  ['Diplomacy and reconnecting', 'In Multiplayer uplink, create an operation and share its invitation with two players. The host starts after all three seats join. Private bilateral signals reach only their two participants. Agreements are enforced by people. Keep the same app installation or browser tab to retain your seat. Generate a recovery code while connected and save it privately with the server address. Restoring a seat uses the code once and disconnects the old device; generate a new code afterward. Without a saved code, lost credentials cannot be recovered. If a command is uncertain, retry it instead of recreating it.'],
] as const;
export function FieldManual() {
  const [visible, setVisible] = useState(false);
  const [briefing, setBriefing] = useState(false);
  const interacted = useRef(false);
  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(ACKNOWLEDGED).then(value => {
      if (mounted && !interacted.current && value !== '1') { setBriefing(true); setVisible(true); }
    }).catch(() => { if (mounted && !interacted.current) { setBriefing(true); setVisible(true); } });
    return () => { mounted = false; };
  }, []);
  function close() {
    interacted.current = true; setVisible(false); setBriefing(false);
    // A failed preference write only repeats the briefing on the next launch.
    void AsyncStorage.setItem(ACKNOWLEDGED, '1').catch(() => undefined);
  }
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Open field manual" onPress={() => { interacted.current = true; setBriefing(false); setVisible(true); }} style={s.trigger}><Text style={s.triggerText}>Manual</Text></Pressable>
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={s.safe}>
        <View style={s.header}><Text accessibilityRole="header" style={s.title}>{briefing ? 'Welcome, intelligence.' : 'Field manual'}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close field manual" onPress={close} style={s.trigger}><Text style={s.triggerText}>Close</Text></Pressable></View>
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.intro}>Your corporation is too far away to interfere. Start with a solo operation to learn the belt, then negotiate with human rivals.</Text>
          {(briefing ? sections.slice(0, 3) : sections).map(([title, body]) => <View key={title} style={s.section}><Text accessibilityRole="header" style={s.heading}>{title}</Text><Text style={s.body}>{body}</Text></View>)}
          {briefing && <Pressable accessibilityRole="button" onPress={() => setBriefing(false)} style={s.trigger}><Text style={s.triggerText}>Read the full field manual</Text></Pressable>}
          <Pressable accessibilityRole="button" onPress={close} style={s.begin}><Text style={s.beginText}>Return to command</Text></Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </>;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080f0d' }, header: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1, borderColor: '#30402e' },
  title: { color: '#e5eadc', fontSize: 23, flex: 1 }, trigger: { minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center', padding: 10, backgroundColor: '#162217', borderWidth: 1, borderColor: '#30442b' }, triggerText: { color: '#b8e986', fontSize: 12 },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 24, gap: 24 }, intro: { color: '#b8e986', fontSize: 16, lineHeight: 25 }, section: { gap: 8 }, heading: { color: '#e5eadc', fontSize: 18 }, body: { color: '#a8b8a2', fontSize: 15, lineHeight: 24 }, begin: { minHeight: 48, padding: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#b8e986', marginBottom: 12 }, beginText: { color: '#182312', fontWeight: '600', fontSize: 14 },
});
