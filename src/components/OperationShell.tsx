/**
 * ---
 * purpose: Persistent chart, contextual drawers, and operation navigation on phone and desktop.
 * ---
 */

import type { PlayerColor } from '../game/player-colors';
import React, { useContext, useEffect, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { Faction } from '../game/players';
import { PlayerRoster } from './PlayerIdentity';
import type { CharacterId } from '../game/characters';
import { nativeDriver, useAmbientMotion } from './use-ambient-motion';
import { AppChromeContext } from './app-chrome';

export type OperationSection = 'asset' | 'orders' | 'units' | 'signals' | 'intel' | 'settings';
type Panel = { title: string; content: React.ReactNode; footer?: React.ReactNode };
type Props = {
  chart: React.ReactNode; timeline: React.ReactNode; status: React.ReactNode;
  player?: Faction;
  portraits?: readonly CharacterId[];
  colors?: readonly PlayerColor[];
  section: OperationSection | null; onSection: (section: OperationSection | null) => void;
  panels: Record<OperationSection, Panel>; hint?: React.ReactNode;
  panelScrollRef?: React.RefObject<ScrollView | null>; onPanelResize?: () => void;
};
const navigation = [
  [null, 'Chart', '◎'], ['orders', 'Orders', '↗'], ['units', 'Specialists', '◈'],
  ['signals', 'Signals', '≋'], ['intel', 'Intel', '▥'], ['settings', 'Setup', '⋯'],
] as const;
const COMPACT_OPERATION_HEIGHT = 360;
const COMPACT_SIDEBAR_WIDTH = 640;
const MIN_SHEET_HEIGHT = 148;
const MIN_DRAWER_BODY_HEIGHT = 96;
const PANEL_CONTENT_PADDING = 14;

export function OperationShell({ chart, timeline, status, player = 'you', portraits, colors, section, onSection, panels, hint, panelScrollRef, onPanelResize }: Props) {
  const { width, height } = useWindowDimensions();
  const [availableHeight, setAvailableHeight] = useState<number>();
  const [stageHeight, setStageHeight] = useState<number>();
  const [headingHeight, setHeadingHeight] = useState(44);
  const [footerHeight, setFooterHeight] = useState<number>();
  const compact = (availableHeight ?? height) < COMPACT_OPERATION_HEIGHT;
  const wide = width >= 1000 || (compact && width >= COMPACT_SIDEBAR_WIDTH);
  const sheetHeight = stageHeight === undefined ? undefined : Math.min(stageHeight, Math.max(MIN_SHEET_HEIGHT, stageHeight * (section === 'intel' ? 0.9 : 0.55)));
  const panel = section && panels[section];
  const hideTimeline = compact && !!panel;
  const drawerHeight = wide ? stageHeight : sheetHeight;
  const scrollFooter = compact || footerHeight === undefined || drawerHeight === undefined || Math.max(0, drawerHeight - headingHeight - footerHeight) < MIN_DRAWER_BODY_HEIGHT;
  const footer = panel && panel.footer && <View onLayout={event => setFooterHeight(event.nativeEvent.layout.height)} style={[s.footer, scrollFooter && s.scrolledFooter]}>{panel.footer}</View>;
  const { animate } = useAmbientMotion();
  const chrome = useContext(AppChromeContext);
  const { claim } = chrome;
  useEffect(() => claim(), [claim]);
  const [entrance] = useState(() => new Animated.Value(1));
  useEffect(() => {
    entrance.setValue(1);
    if (!animate || !section) return;
    entrance.setValue(0);
    const reveal = Animated.timing(entrance, {
      toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver, isInteraction: false,
    });
    reveal.start();
    return () => reveal.stop();
  }, [animate, section, wide, entrance]);
  return <PlayerRoster portraits={portraits} colors={colors}><KeyboardAvoidingView style={s.shell} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={s.shell} onLayout={event => setAvailableHeight(event.nativeEvent.layout.height)}>
    {!!status && <View style={s.status}><ScrollView style={s.statusContent} contentContainerStyle={s.statusBody} keyboardShouldPersistTaps="handled">{status}</ScrollView></View>}
    <View style={[s.stage, compact && !!panel && s.compactStage, wide && s.wide]} onLayout={event => setStageHeight(event.nativeEvent.layout.height)}>
      <View style={s.chart}>{chart}{!!hint && <View pointerEvents="box-none" style={s.hint}>{hint}</View>}</View>
      {panel && <Animated.View testID="operation-drawer" style={[s.drawer, wide ? [s.sidebar, compact && { width: Math.min(370, width * 0.48) }] : [s.sheet, section === 'intel' && s.intelSheet, sheetHeight !== undefined && { maxHeight: sheetHeight }], {
        opacity: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] }),
        transform: [wide
          ? { translateX: entrance.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }
          : { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
      }]}>
        <View style={s.heading} onLayout={event => setHeadingHeight(event.nativeEvent.layout.height)}><Text accessibilityRole="header" style={s.title}>{panel.title}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Close ${panel.title}`} onPress={() => onSection(null)} style={({ pressed }) => [s.close, pressed && s.pressed, pressed && animate && s.pressScale]}><Text style={s.text}>×</Text></Pressable></View>
        <ScrollView key={section} ref={panelScrollRef} automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" onContentSizeChange={onPanelResize} contentContainerStyle={s.content}>
          {section === 'settings' && chrome.exits.length > 0 && <View style={s.chrome}>
            {chrome.exits.map(exit => <Pressable key={exit.label} accessibilityRole="button" accessibilityLabel={exit.label} onPress={exit.onPress} style={({ pressed }) => [s.exit, pressed && s.pressed]}><Text style={s.exitText}>{exit.label}</Text></Pressable>)}
            <View style={{ flex: 1 }} />{chrome.tools}
          </View>}
          {panel.content}{scrollFooter && footer}
        </ScrollView>
        {!scrollFooter && footer}
      </Animated.View>}
    </View>
    <ScrollView style={[s.timeline, hideTimeline && s.hiddenTimeline]} accessibilityElementsHidden={hideTimeline} importantForAccessibility={hideTimeline ? 'no-hide-descendants' : 'auto'} contentContainerStyle={{ flexGrow: 1 }} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">{timeline}</ScrollView>
    <View accessibilityRole="tablist" style={s.navigation}>{navigation.map(([key, label, glyph]) => {
      const selected = key === null ? section === null || section === 'asset' : section === key;
      return <Pressable key={label} accessibilityRole={Platform.OS === 'ios' ? 'button' : 'tab'} accessibilityLabel={label} accessibilityState={{ selected }} onPress={() => onSection(key)} style={({ pressed }) => [s.tab, selected && s.selected, pressed && s.pressed, pressed && animate && s.pressScale]}><Text style={[s.glyph, selected && s.active]}>{glyph}</Text><Text style={[s.label, selected && s.active]}>{label}</Text></Pressable>;
    })}</View>
    </View>
  </KeyboardAvoidingView></PlayerRoster>;
}
const s = StyleSheet.create({
  shell: { flex: 1, minHeight: 0, backgroundColor: '#101b21' }, status: { maxHeight: '35%', flexShrink: 1, paddingHorizontal: 14, paddingVertical: 4, borderBottomWidth: 1, borderColor: '#23363e', gap: 12, flexDirection: 'row', alignItems: 'center' }, statusContent: { flex: 1, minWidth: 0 }, statusBody: { gap: 6 },
  stage: { flex: 1, minHeight: 120, overflow: 'hidden' }, compactStage: { minHeight: 0 }, wide: { flexDirection: 'row' }, chart: { flex: 1, minWidth: 0 },
  drawer: { backgroundColor: '#14232b', borderTopWidth: 1, borderColor: '#30454c', minHeight: 0, overflow: 'hidden' }, sidebar: { width: 370 }, sheet: { maxHeight: '55%', borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  intelSheet: { maxHeight: '90%' },
  footer: { paddingVertical: 12, paddingHorizontal: PANEL_CONTENT_PADDING, borderTopWidth: 1, borderColor: '#30454c', backgroundColor: '#14232b' }, scrolledFooter: { marginHorizontal: -PANEL_CONTENT_PADDING },
  heading: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, borderBottomWidth: 1, borderColor: '#23363e' }, title: { flex: 1, color: '#e5eadc', fontSize: 15 }, close: { minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, text: { color: '#b8e986', fontSize: 22 }, content: { padding: PANEL_CONTENT_PADDING, gap: 14, paddingBottom: 24 },
  timeline: { maxHeight: '42%', flexGrow: 0, flexShrink: 1 }, hiddenTimeline: { display: 'none' },
  navigation: { flexDirection: 'row', borderTopWidth: 1, borderColor: '#23363e', backgroundColor: '#101b21' }, tab: { flex: 1, minWidth: 44, minHeight: 54, alignItems: 'center', justifyContent: 'center', gap: 3, borderTopWidth: 2, borderTopColor: 'transparent' }, selected: { borderTopColor: '#b8e986', backgroundColor: 'transparent' }, glyph: { color: '#8c9f85', fontSize: 17 }, label: { color: '#8c9f85', fontSize: 10 }, active: { color: '#b8e986' },
  hint: { position: 'absolute', top: 8, left: 10, right: 112, padding: 10, backgroundColor: '#18291f', borderWidth: 1, borderColor: '#405b36', borderRadius: 10 },
  chrome: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: -6, paddingBottom: 8, borderBottomWidth: 1, borderColor: '#23363e' },
  exit: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }, exitText: { color: '#b4c7ca', fontSize: 14 },
  pressed: { backgroundColor: '#24383c' }, pressScale: { transform: [{ scale: 0.96 }] },
});
