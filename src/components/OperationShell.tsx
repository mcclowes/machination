/**
 * ---
 * purpose: Persistent chart, contextual drawers, and operation navigation on phone and desktop.
 * ---
 */
import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { Faction } from '../game/players';
import { PlayerPortraits } from './PlayerIdentity';
import type { CharacterId } from '../game/characters';

export type OperationSection = 'asset' | 'orders' | 'units' | 'signals' | 'intel' | 'settings';
type Panel = { title: string; content: React.ReactNode; footer?: React.ReactNode };
type Props = {
  chart: React.ReactNode; timeline: React.ReactNode; status: React.ReactNode;
  player?: Faction;
  portraits?: readonly CharacterId[];
  section: OperationSection | null; onSection: (section: OperationSection | null) => void;
  panels: Record<OperationSection, Panel>; hint?: React.ReactNode;
  panelScrollRef?: React.RefObject<ScrollView | null>; onPanelResize?: () => void;
};
const navigation = [
  [null, 'Chart', '◎'], ['orders', 'Orders', '↗'], ['units', 'Units', '◈'],
  ['signals', 'Signals', '≋'], ['intel', 'Intel', '▥'], ['settings', 'Setup', '⋯'],
] as const;

export function OperationShell({ chart, timeline, status, player = 'you', portraits, section, onSection, panels, hint, panelScrollRef, onPanelResize }: Props) {
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const panel = section && panels[section];
  return <PlayerPortraits.Provider value={portraits}><KeyboardAvoidingView style={s.shell} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    {!!status && <View style={s.status}><View style={s.statusContent}>{status}</View></View>}
    <View style={[s.stage, wide && s.wide]}>
      <View style={s.chart}>{chart}{!!hint && <View style={s.hint}>{hint}</View>}</View>
      {panel && <View style={[s.drawer, wide ? s.sidebar : s.sheet]}>
        <View style={s.heading}><Text accessibilityRole="header" style={s.title}>{panel.title}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Close ${panel.title}`} onPress={() => onSection(null)} style={s.close}><Text style={s.text}>×</Text></Pressable></View>
        <ScrollView key={section} ref={panelScrollRef} automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" onContentSizeChange={onPanelResize} contentContainerStyle={s.content}>{panel.content}</ScrollView>
        {panel.footer && <View style={s.footer}>{panel.footer}</View>}
      </View>}
    </View>
    <ScrollView style={s.timeline} contentContainerStyle={{ flexGrow: 1 }} automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">{timeline}</ScrollView>
    <View accessibilityRole="tablist" style={s.navigation}>{navigation.map(([key, label, glyph]) => {
      const selected = key === null ? section === null || section === 'asset' : section === key;
      return <Pressable key={label} accessibilityRole={Platform.OS === 'ios' ? 'button' : 'tab'} accessibilityLabel={label} accessibilityState={{ selected }} onPress={() => onSection(key)} style={[s.tab, selected && s.selected]}><Text style={[s.glyph, selected && s.active]}>{glyph}</Text><Text style={[s.label, selected && s.active]}>{label}</Text></Pressable>;
    })}</View>
  </KeyboardAvoidingView></PlayerPortraits.Provider>;
}
const s = StyleSheet.create({
  shell: { flex: 1, minHeight: 0, backgroundColor: '#101b21' }, status: { paddingHorizontal: 14, paddingVertical: 4, borderBottomWidth: 1, borderColor: '#23363e', gap: 12, flexDirection: 'row', alignItems: 'center' }, statusContent: { flex: 1, minWidth: 0, gap: 6 },
  stage: { flex: 1, minHeight: 120, overflow: 'hidden' }, wide: { flexDirection: 'row' }, chart: { flex: 1, minWidth: 0 },
  drawer: { backgroundColor: '#14232b', borderTopWidth: 1, borderColor: '#30454c', minHeight: 0, overflow: 'hidden' }, sidebar: { width: 370 }, sheet: { maxHeight: '55%', borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  footer: { padding: 12, borderTopWidth: 1, borderColor: '#30454c', backgroundColor: '#14232b' },
  heading: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, borderBottomWidth: 1, borderColor: '#23363e' }, title: { flex: 1, color: '#e5eadc', fontSize: 15 }, close: { minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, text: { color: '#b8e986', fontSize: 22 }, content: { padding: 14, gap: 14, paddingBottom: 24 },
  timeline: { maxHeight: '42%', flexGrow: 0, flexShrink: 1 },
  navigation: { flexDirection: 'row', borderTopWidth: 1, borderColor: '#23363e', backgroundColor: '#101b21' }, tab: { flex: 1, minWidth: 44, minHeight: 54, alignItems: 'center', justifyContent: 'center', gap: 3, borderTopWidth: 2, borderTopColor: 'transparent' }, selected: { borderTopColor: '#b8e986', backgroundColor: 'transparent' }, glyph: { color: '#8c9f85', fontSize: 17 }, label: { color: '#8c9f85', fontSize: 10 }, active: { color: '#b8e986' },
  hint: { position: 'absolute', top: 8, left: 10, right: 112, padding: 10, backgroundColor: '#18291f', borderWidth: 1, borderColor: '#405b36', borderRadius: 10 },
});
