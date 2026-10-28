/**
 * ---
 * purpose: Shared first-launch briefing and rules reference for both operation modes.
 * ---
 */
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
const ACKNOWLEDGED = 'machination.briefing.v1';
const sections = [
  ['Your mandate', 'You are a mining intelligence. New operations start with five sites and 160 drones per intelligence. Choose mining to reach 200 cargo, or domination to control half the chart; being the last active intelligence also wins. Losing your core without a fallback ends your orders and mining, but your territory, production, and launched haulers remain. Version-one saves retain their original rules and 300-cargo quota.'],
  ['Your first transfer', 'New charts wrap across every edge. Drag to pan, pinch or use the zoom buttons, and choose Home to frame your territory or Fit to see a full chart. Older charts allow panning while zoomed. Tap a hauler to inspect its manifest, route, and arrival. Select one of your controlled rocks, choose Plan transfer, then select a destination on the chart. Set a whole-number drone manifest and launch. New launches prepare for ten minutes. Edit or cancel them in Your live hauler orders before departure. Reserved drones defend their site if combat arrives first, canceling the preparation. Friendly arrivals reinforce. In hostile encounters, units act first, then shields absorb attacks, then drones trade one for one. Remaining units break drone ties; equal surviving units leave the defending site in control.'],
  ['Production and time', 'Factories produce 6 drones every 8h, up to a total capacity of 150 plus 50 per generator. Generators supply power. Drill mines with 50, 100, 200, then 300 drones, and rising costs. Each mine produces one cargo per controlled rock daily, paid one unit at a time. Losing a mine removes 20% of cargo. Shields recharge over 48h and absorb attacks before drones; disabling shields helps negotiated handovers. Travel follows continuous distance-based timing. Ordinary haulers on opposite legs of the same route fight when they pass; survivors continue. Operations continue while you are away. Solo has AI rivals and a +6h accelerator. Multiplayer runs in real time.'],
  ['Units and interception', 'Your core earns its first hiring credit at hour four, then one every 18 hours. Recruit at its site, or spend a credit promoting an eligible docked unit. Load several units with drones, or transport a unit alone. Active units can change local or global rules; captive units have no abilities and can only travel when released. A fallback core can succeed a lost core. Scavenger rigs intercept observed enemy haulers at double speed and return at quadruple speed. A routing controller can change its hauler’s course every eight hours. Read each unit’s description. Version-one saves retain their original drone-built modules.'],
  ['Gifts', 'Review a gift at launch or turn one of your traveling haulers into a gift. Gift orders take effect after ten minutes and can be canceled before then. Ownership stays with the donor until contact. The current destination owner receives the manifest without combat; a passing hostile hauler can accept it first, routing it to its nearest friendly site. Version-one operations retain launch-time recipient ownership.'],
  ['Sensors', 'Your sites provide sensor coverage, starting at 32 map units and modified by units. Haulers do not provide coverage in new operations. You always see your own haulers and approaching enemies, even outside coverage; other enemy haulers require sensors. Unknown sites retain their locations but hide ownership, inventory, and usually type. Mines are marked publicly. Cargo standings and sponsor counts are public; sponsor identities are shown only when you are involved. Solo and multiplayer follow the same information rules. Version-one saves retain their original sensor rules.'],
  ['Time Machine', 'Scrub backward through available history or up to seven days ahead. Enter signed hours, such as -1 to review an hour ago or 6.5 to inspect the future. Historical views use sensors from that time and cannot issue orders. Old operations begin history at their first recorded state. Plan a transfer in the future to schedule it there, including drones expected before launch. Event controls navigate observed arrivals and plans. Now returns to live time. Forecasts use current observations; hidden forces and new rival orders can change the outcome. Other unit and site actions require live time.'],
  ['Private scheduled orders', 'Choose a launch delay to queue a transfer up to seven days ahead. Plans reserve neither drones nor modules. The full manifest must be available when it launches, or it aborts. Only you see your plans. Cancel before execution; a launch already processed cannot be undone. Interceptions launch immediately.'],
  ['Resignation and inactivity', 'Setup lets you resign after reviewing an irreversible confirmation. Resignation ends orders and mining, removes cargo and funding, and cancels queued transfers and preparations. Territory, launched haulers, production, shields, sensors, and chat remain. Multiplayer automatically resigns a player after 48 hours without activity. Opening the operation in the foreground, issuing orders, or chatting renews activity; background refreshes do not. Setup shows your deadline. Solo training has no inactivity timeout.'],
  ['Diplomacy and reconnecting', 'In Multiplayer uplink, choose 2–10 players and a mode before creating an operation, then share its invitation. The host starts after all configured seats join. New games generate ten sites per player; each player initially owns five. Solo replacement offers the same setup choices. Private signals reach their two participants; private groups have fixed named members, and the public channel reaches everyone in the operation. Funding in Intel supports another intelligence when you lead by 20 cargo, adding 50 capacity and 2 drones per factory cycle. Support is free and ends if the lead falls below 20. Agreements are enforced by people. Keep the same app installation or browser tab to retain your seat. Generate a recovery code while connected and save it privately with the server address. Restoring a seat uses the code once and disconnects the old device; generate a new code afterward. Without a saved code, lost credentials cannot be recovered. If a command is uncertain, retry it instead of recreating it.'],
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
    <Modal visible={visible} animationType={Platform.OS === 'web' ? 'none' : 'slide'} onRequestClose={close}>
      <SafeAreaProvider><SafeAreaView style={s.safe}>
        <View style={s.header}><Text accessibilityRole="header" style={s.title}>{briefing ? 'Welcome, intelligence.' : 'Field manual'}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close field manual" onPress={close} style={s.trigger}><Text style={s.triggerText}>Close</Text></Pressable></View>
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.intro}>Your corporation is too far away to interfere. Start with a solo operation to learn the belt, then negotiate with human rivals.</Text>
          {(briefing ? sections.slice(0, 3) : sections).map(([title, body]) => <View key={title} style={s.section}><Text accessibilityRole="header" style={s.heading}>{title}</Text><Text style={s.body}>{body}</Text></View>)}
          {briefing && <Pressable accessibilityRole="button" onPress={() => setBriefing(false)} style={s.trigger}><Text style={s.triggerText}>Read the full field manual</Text></Pressable>}
          <Pressable accessibilityRole="button" onPress={close} style={s.begin}><Text style={s.beginText}>Return to command</Text></Pressable>
        </ScrollView>
      </SafeAreaView></SafeAreaProvider>
    </Modal>
  </>;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080f0d' }, header: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1, borderColor: '#30402e' },
  title: { color: '#e5eadc', fontSize: 23, flex: 1 }, trigger: { minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center', padding: 10, backgroundColor: '#162217', borderWidth: 1, borderColor: '#30442b' }, triggerText: { color: '#b8e986', fontSize: 12 },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 24, gap: 24 }, intro: { color: '#b8e986', fontSize: 16, lineHeight: 25 }, section: { gap: 8 }, heading: { color: '#e5eadc', fontSize: 18 }, body: { color: '#a8b8a2', fontSize: 15, lineHeight: 24 }, begin: { minHeight: 48, padding: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#b8e986', marginBottom: 12 }, beginText: { color: '#182312', fontWeight: '600', fontSize: 14 },
});
